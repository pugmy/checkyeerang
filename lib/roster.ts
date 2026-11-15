// 변경 시점만 저장하는 시간표 이력. 한 이벤트에는 바뀐 필드만 JSON으로 저장한다.
// 기준 시점(ROSTER_BASELINE_AT) 이전은 검증된 이력이 없으므로 현재 상태를 보여 주되 "미확인"으로 표시한다.
import type { Db } from "./prisma.ts";
import { getSetting, setSetting } from "./settings.ts";
import { atDeadline, endOfDay, parseDate, SHIFTS } from "./time.ts";

export const ROSTER_FIELDS = ["name", "grade", "day", "shift", "type"] as const;
export type Member = { id: number; name: string; grade: number; day: number; shift: number; type: number };
type Patch = Partial<Omit<Member, "id">>;
export type RosterEvent = { id: number; userId: number; effectiveAt: string; patch: unknown };
export type Roster = { index: Record<number, RosterEvent[]>; baseline: string | null };

export const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function rosterPatch(before: Member | null, after: Member): Patch {
  const delta: Record<string, unknown> = {};
  for (const f of ROSTER_FIELDS) if (!before || before[f] !== after[f]) delta[f] = after[f];
  return delta as Patch;
}

export async function writeEvents(db: Db, items: { userId: number; patch: Patch }[], stamp: string) {
  if (!items.length) return;
  await db.rosterHistory.createMany({
    data: items.map((i) => ({ userId: i.userId, effectiveAt: new Date(stamp), patch: i.patch })),
  });
}

export const getBaseline = (db: Db) => getSetting(db, "ROSTER_BASELINE_AT");

// 기존 부원 상태를 한 번 봉인한다. 이전 시점은 검증된 이력으로 간주하지 않는다. 여러 번 불러도 된다.
export async function ensureBaseline(db: Db) {
  if (await getBaseline(db)) return;
  // 이력이 이미 있는데 기준 시점만 없으면 부분 이전일 수 있으니 덮어쓰지 않는다.
  if ((await db.rosterHistory.count()) > 0) throw new Error("시간표 이력이 이미 있지만 기준 시점이 없습니다. 먼저 이력 테이블을 확인하세요.");
  const stamp = new Date().toISOString();
  const users = await db.user.findMany();
  await writeEvents(db, users.map((u) => ({ userId: u.id, patch: rosterPatch(null, u) })), stamp);
  await setSetting(db, "ROSTER_BASELINE_AT", stamp);
}

// 부원 변경 직후 호출: 바뀐 필드만 이력에 남긴다.
export async function logChange(db: Db, before: Member | null, after: Member, stamp = new Date().toISOString()) {
  const patch = rosterPatch(before, after);
  if (Object.keys(patch).length) await writeEvents(db, [{ userId: after.id, patch }], stamp);
}

export async function loadRoster(db: Db): Promise<Roster> {
  const index: Roster["index"] = {};
  const rows = await db.rosterHistory.findMany({ orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] });
  for (const r of rows) (index[r.userId] ||= []).push({ id: r.id, userId: r.userId, effectiveAt: r.effectiveAt.toISOString(), patch: r.patch });
  return { index, baseline: await getBaseline(db) };
}

// null: 대상 시점 이전에 관측된 상태 없음(기준선 전이거나, 기준선 이후 아직 추가되지 않은 부원)
export function stateAt(index: Roster["index"], userId: number, at: string): Member | null {
  let state: Member | null = null;
  for (const e of index[userId] || []) {
    if (e.effectiveAt > at) continue;
    state = Object.assign(state || ({ id: userId } as Member), e.patch);
  }
  return state;
}

export const covered = (r: Roster, at: string) => !!r.baseline && at >= r.baseline;

// 기준선 이전 시점은 현재 상태를 그대로 쓴다(UI/CSV에서 미확인 표시)
export function membersAt<T extends Member>(users: T[], r: Roster, at: string): Member[] {
  return users.map((u) => stateAt(r.index, u.id, at) || (!covered(r, at) ? u : null)).filter((u): u is Member => u !== null);
}

// 정규 당번 조회는 해당 시간대의 마감 직전 상태를 기준으로 한다.
export function slotMembers(users: Member[], r: Roster, date: string, shift: number, day: number) {
  return membersAt(users, r, atDeadline(date, shift)!).filter((u) => u.type === 1 && u.day === day && u.shift === shift);
}

// 과거 날짜 조회는 시간대별 마감 직전의 배정 상태를 복원한다.
export function dayView(date: string, users: Member[], r: Roster, records: { userId: number }[]) {
  const range = parseDate(date)!;
  const historical = membersAt(users, r, endOfDay(date)).filter((u) => u.type === 1 || records.some((x) => x.userId === u.id));
  const shifts: Record<number, Member[]> = {};
  for (const s of SHIFTS) shifts[s] = slotMembers(users, r, date, s, range.day).sort(byName);
  const verified = SHIFTS.every((s) => covered(r, atDeadline(date, s)!));
  return { users: historical.sort(byName), shifts, verified };
}

// CSV는 기록 날짜에 해당하는 시간대 마감 시점의 학년·담당 요일·시간을 출력한다.
export function forRecord(r: Roster, rec: { userId: number; date: string; shift: number }, fallback: Member) {
  const at = rec.shift && atDeadline(rec.date, rec.shift) ? atDeadline(rec.date, rec.shift)! : endOfDay(rec.date);
  const historical = stateAt(r.index, rec.userId, at);
  return { user: historical || fallback, verified: covered(r, at) && !!historical };
}

// ---------- 읽기 전용 점검: 이력을 고치거나 빈 구간을 추정하지 않는다 ----------
export type AuditError = { code: string; userId?: number; id?: number };

export function auditData(users: Member[], events: RosterEvent[], baseline: string | null, at: string) {
  const errors: AuditError[] = [];
  const current: Record<number, Member> = {};
  const history: Record<number, RosterEvent[]> = {};
  const seen = new Set<number>();
  for (const u of users) {
    if (!Number.isSafeInteger(u.id) || u.id <= 0 || current[u.id]) errors.push({ code: "INVALID_USER_ID", userId: u.id });
    current[u.id] = u;
  }
  const ok: Record<string, (v: any) => boolean> = {
    name: (v) => typeof v === "string" && !!v.trim(),
    grade: (v) => [1, 2, 3].includes(v),
    day: (v) => [1, 2, 3, 4, 5].includes(v),
    shift: (v) => [1, 2, 3].includes(v),
    type: (v) => [-1, 0, 1].includes(v),
  };
  for (const e of events) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.effectiveAt) || Number.isNaN(Date.parse(e.effectiveAt))) {
      errors.push({ code: "INVALID_EVENT", id: e.id });
      continue;
    }
    if (seen.has(e.id)) {
      errors.push({ code: "DUPLICATE_EVENT_ID", id: e.id });
      continue;
    }
    seen.add(e.id);
    const p = e.patch as Record<string, unknown> | null;
    if (!p || Array.isArray(p) || typeof p !== "object" || !Object.keys(p).length || Object.keys(p).some((k) => !ok[k] || !ok[k](p[k]))) {
      errors.push({ code: "INVALID_PATCH", id: e.id });
      continue;
    }
    if (!current[e.userId]) {
      errors.push({ code: "ORPHAN_EVENT", id: e.id, userId: e.userId });
      continue;
    }
    (history[e.userId] ||= []).push(e);
  }
  for (const u of users) {
    const chrono = (history[u.id] || []).sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : a.id - b.id));
    if (!chrono.length) {
      errors.push({ code: "MISSING_HISTORY", userId: u.id });
      continue;
    }
    if (baseline && chrono[0].effectiveAt < baseline) errors.push({ code: "BEFORE_BASELINE", userId: u.id });
    if (chrono.some((e) => e.effectiveAt > at)) {
      errors.push({ code: "FUTURE_EVENT", userId: u.id });
      continue;
    }
    const state = stateAt({ [u.id]: chrono }, u.id, at);
    if (!state || ROSTER_FIELDS.some((f) => state[f] !== u[f])) errors.push({ code: "CURRENT_MISMATCH", userId: u.id });
  }
  return { ok: !!baseline && errors.length === 0, baseline, checkedAt: at, members: users.length, events: events.length, errors };
}

export async function audit(db: Db) {
  const baseline = await getBaseline(db);
  if (!baseline) return { ok: false, errors: [{ code: "MISSING_BASELINE" }] as AuditError[] };
  const r = await loadRoster(db);
  const events = Object.values(r.index).flat();
  return auditData(await db.user.findMany(), events, baseline, new Date().toISOString());
}

// 변경 전 시간표와 이력이 어긋나 있으면 새 변경을 막는다.
export async function assertConsistent(db: Db) {
  if (!(await audit(db)).ok) throw new Error("시간표 이력과 현재 부원 정보가 일치하지 않습니다. 관리자에게 기록 점검을 요청하세요.");
}
