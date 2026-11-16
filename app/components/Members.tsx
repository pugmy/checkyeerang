"use client";

import { useEffect, useRef, useState } from "react";
import { LogoutButton, useAdmin } from "./admin";
import { Modal, useDialogs } from "./modal";
import { SchoolRules } from "./SchoolRules";
import { Choice, DAYS, errText, Loaded, msgClass, SHIFT, SHIFT_ORDER, TIME, useLoad, usePending, type Result } from "./shared";

type Member = {
  id: number; name: string; grade: number; day: number; shift: number; type: number;
  workCount: number; addCount: number; runCount: number;
};
type Form = { name: string; grade: number; day: number; shift: number };

function Stats({ m }: { m: Member }) {
  const rows: [string, number, string][] = [["출석", m.workCount, "ok-text"], ["보충", m.addCount, ""], ["결석", m.runCount, "bad-text"]];
  return (
    <dl className="stats">
      {rows.map(([label, value, cls]) => (
        <div key={label}><dt>{label}</dt><dd className={cls || undefined} style={cls ? undefined : { color: "var(--brand)" }}>{value}</dd></div>
      ))}
    </dl>
  );
}

function NameBlock({ m, sub }: { m: Member; sub: string }) {
  return (
    <div className="info">
      <p className="bold" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {m.name + " "}<span className="name-sub">{m.grade}학년</span>
      </p>
      <p className="muted" style={{ fontSize: ".9rem" }}>{sub}</p>
    </div>
  );
}

function RestoreButton({ m, label, onDone }: { m: Member; label: string; onDone: () => void }) {
  const { adminApi } = useAdmin();
  const { notify } = useDialogs();
  const [pending, track] = usePending();
  const restore = async () => {
    let r: Result;
    try { r = await track(() => adminApi<Result>("api_restore", m.id)); }
    catch (e) { r = { ok: false, message: errText(e) }; }
    if (r.ok) onDone(); else notify(r.message);
  };
  return <button type="button" className="btn ghost sm" disabled={pending} onClick={restore}>{pending ? "처리 중..." : label}</button>;
}

type Dialog =
  | { kind: "edit"; member: Member | null }
  | { kind: "delete" | "graduate"; member: Member }
  | { kind: "audit" | "promotion" | "rules" };

export default function Members({ onRulesChanged }: { onRulesChanged: () => void }) {
  const { adminApi } = useAdmin();
  const state = useLoad(() => adminApi<Member[]>("api_members"), []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const close = () => setDialog(null);
  const changed = () => { setDialog(null); state.reload(); };

  return (
    <>
      <Loaded state={state}>{(all) => {
        const members = all.filter((m) => m.type === 1);
        const alumni = all.filter((m) => m.type === 0);
        const archived = all.filter((m) => m.type === -1);
        const q = query.trim().toLocaleLowerCase("ko-KR");
        const shown = members.filter((m) => m.name.toLocaleLowerCase("ko-KR").includes(q));

        return (
          <div className="stack">
            <div className="between" style={{ marginBottom: "1rem" }}>
              <h1 className="title" style={{ margin: 0 }}>부원 관리</h1>
              <div className="row wrap">
                <LogoutButton />
                <button type="button" className="btn ghost sm" aria-expanded={scheduleOpen} aria-controls="schedule-board"
                  onClick={() => setScheduleOpen(!scheduleOpen)}>{scheduleOpen ? "시간표 접기" : "시간표 펼치기"}</button>
                <button type="button" className="btn ghost sm" onClick={() => setDialog({ kind: "audit" })}>이력 점검</button>
                <button type="button" className="btn ghost sm" onClick={() => setDialog({ kind: "promotion" })}>학년도 정리</button>
                <button type="button" className="btn primary" onClick={() => setDialog({ kind: "edit", member: null })}>+ 부원 추가</button>
              </div>
            </div>
            <p className="muted" style={{ margin: ".5rem 0 1rem" }}>
              {"재학생 " + members.length + "명 · " + [1, 2, 3].map((g) => g + "학년 " + members.filter((m) => m.grade === g).length + "명").join(" · ")}
            </p>

            {/* 현재 당번을 한눈에 확인하는 5일 × 3시간대 시간표. 이름을 누르면 기존 수정 창을 연다. */}
            <section id="schedule-board" className="schedule-section" aria-labelledby="schedule-heading" hidden={!scheduleOpen}>
              <div className="between schedule-heading">
                <div>
                  <h2 id="schedule-heading" className="sub">주간 당번 시간표</h2>
                  <p className="muted">이름을 누르면 요일과 당번 시간을 바로 수정할 수 있습니다.</p>
                </div>
                <button type="button" className="btn ghost sm" onClick={() => setDialog({ kind: "rules" })}>일정 관리</button>
              </div>
              <div className="schedule-scroll" tabIndex={0} role="region" aria-label="주간 당번 시간표, 가로 스크롤 가능">
                <table className="schedule-table" aria-label="도서부 주간 당번 시간표">
                  <thead>
                    <tr><th scope="col">시간</th>{DAYS.map((day) => <th key={day} scope="col">{day}요일</th>)}</tr>
                  </thead>
                  <tbody>
                    {SHIFT_ORDER.map((shift) => (
                      <tr key={shift}>
                        <th scope="row"><span>{SHIFT[shift]}</span><small className="schedule-time">{TIME[shift]}</small></th>
                        {DAYS.map((day, index) => {
                          const assigned = members.filter((m) => m.day === index + 1 && m.shift === shift);
                          return (
                            <td key={day} className="schedule-cell">
                              {assigned.length ? assigned.map((m) => (
                                <button key={m.id} type="button" className="schedule-person"
                                  aria-label={m.name + " · " + day + "요일 " + SHIFT[shift] + " 당번 수정"}
                                  onClick={() => setDialog({ kind: "edit", member: m })}>
                                  {m.name}<small>{m.grade}학년</small>
                                </button>
                              )) : <span className="schedule-empty">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <input type="search" className="field" placeholder="부원 이름 검색" aria-label="부원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <p className="muted" role="status" aria-live="polite" style={{ fontSize: ".875rem" }}>{q ? "검색 결과 " + shown.length + "명" : ""}</p>
            {members.length === 0 ? (
              <div className="card big">
                <p className="bold">등록된 부원이 없습니다.</p>
                <p className="muted" style={{ fontSize: ".9rem" }}>오른쪽 위 “부원 추가”로 시작해 보세요.</p>
              </div>
            ) : (
              <ul className="member-roster">
                {shown.map((m) => (
                  <li key={m.id} className="card member">
                    <NameBlock m={m} sub={DAYS[m.day - 1] + "요일 · " + SHIFT[m.shift]} />
                    <Stats m={m} />
                    <div className="row">
                      <button type="button" className="btn ghost sm" onClick={() => setDialog({ kind: "edit", member: m })}>수정</button>
                      <button type="button" className="btn ghost sm" onClick={() => setDialog({ kind: "graduate", member: m })}>졸업</button>
                      <button type="button" className="btn danger sm" onClick={() => setDialog({ kind: "delete", member: m })}>명단 제외</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="search-empty" role="status" hidden={!q || shown.length !== 0 || !members.length}>검색 결과가 없습니다. 이름을 다시 확인해 주세요.</p>

            {alumni.length > 0 && (
              <details className="mt8">
                <summary className="bold" style={{ cursor: "pointer", padding: ".5rem 0" }}>졸업생 ({alumni.length}명)</summary>
                <ul className="col mt3" style={{ gap: ".5rem" }}>
                  {alumni.map((m) => (
                    <li key={m.id} className="card member">
                      <NameBlock m={m} sub="졸업" />
                      <Stats m={m} />
                      <div className="row">
                        <RestoreButton m={m} label="복귀" onDone={state.reload} />
                        <button type="button" className="btn danger sm" onClick={() => setDialog({ kind: "delete", member: m })}>명단 제외</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {archived.length > 0 && (
              <details className="mt8">
                <summary className="bold" style={{ cursor: "pointer", padding: ".5rem 0" }}>명단에서 제외된 부원 ({archived.length}명)</summary>
                <p className="muted mt2">실수로 제외한 부원은 여기서 복귀시킬 수 있습니다. 이전 시간표 기록은 유지됩니다.</p>
                <ul className="col mt3">
                  {archived.map((m) => (
                    <li key={m.id} className="card member">
                      <NameBlock m={m} sub="명단 제외" />
                      <div className="row"><RestoreButton m={m} label="명단에 복귀" onDone={state.reload} /></div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      }}</Loaded>
      {dialog?.kind === "edit" && <MemberModal member={dialog.member} onClose={close} onSaved={changed} />}
      {dialog?.kind === "delete" && (
        <ConfirmAction member={dialog.member} label="부원 삭제 확인" fn="api_deleteMember" danger
          title={dialog.member.name + " 부원을 명단에서 제외할까요?"}
          note="출석 기록이 없는 부원만 명단에서 제외할 수 있습니다. 이전 시간표 기록은 보존됩니다."
          action="명단에서 제외" busyText="삭제 중..." onClose={close} onDone={changed} />
      )}
      {dialog?.kind === "graduate" && (
        <ConfirmAction member={dialog.member} label="졸업 처리 확인" fn="api_graduate"
          title={dialog.member.name + " 부원을 졸업 처리할까요?"}
          note="졸업생 명단으로 이동합니다. 학년과 관계없이 같은 방식으로 처리되며, 출석 및 시간표 기록은 유지됩니다."
          action="졸업 처리" busyText="처리 중..." onClose={close} onDone={changed} />
      )}
      {dialog?.kind === "audit" && <RosterAudit onClose={close} />}
      {dialog?.kind === "promotion" && <Promotion onClose={close} onDone={changed} />}
      {dialog?.kind === "rules" && <SchoolRules defaultDate="" onChanged={onRulesChanged} onClose={close} />}
    </>
  );
}

function MemberModal({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const { adminApi } = useAdmin();
  const [form, setForm] = useState<Form>(member ? { name: member.name, grade: member.grade, day: member.day, shift: member.shift } : { name: "", grade: 1, day: 1, shift: 1 });
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState<Form | null>(null);
  const [pending, track] = usePending();
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    const data = { ...form, name: form.name.trim() };
    if (!data.name) { setMsg("이름을 입력해 주세요."); nameRef.current?.focus(); return; }
    if (member && (["name", "grade", "day", "shift"] as const).every((k) => member[k] === data[k])) { setMsg("변경된 내용이 없습니다."); return; }
    setConfirming(data);
  };
  const send = async (data: Form) => {
    let r: Result;
    try { r = await track(() => member ? adminApi<Result>("api_updateMember", member.id, data) : adminApi<Result>("api_addMember", data)); }
    catch (e) { r = { ok: false, message: errText(e) }; }
    setConfirming(null);
    if (!r.ok) { setMsg(r.message); return; }
    onSaved();
  };

  return (
    <>
      <Modal label={member ? "부원 수정" : "부원 추가"} onClose={onClose}>
        <h2>{member ? "부원 수정" : "부원 추가"}</h2>
        <div className="col">
          <label className="label">이름<input ref={nameRef} className="field" aria-label="이름" value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <Choice label="학년" options={[1, 2, 3].map((g) => ({ value: g, label: g + "학년" }))} value={form.grade} onChange={(grade) => set({ grade })} />
          <Choice label="요일" options={DAYS.map((d, i) => ({ value: i + 1, label: d }))} value={form.day} onChange={(day) => set({ day })} />
          <Choice label="시간" options={SHIFT_ORDER.map((s) => ({ value: s, label: SHIFT[s] }))} value={form.shift} onChange={(shift) => set({ shift })} />
        </div>
        <p className="msg bad-text" role="status">{msg}</p>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn primary" onClick={save}>{member ? "저장" : "추가"}</button>
        </div>
      </Modal>
      {confirming && (
        <Modal label="부원 정보 확인" alert narrow canClose={() => !pending} onClose={() => setConfirming(null)}>
          <h3>{member ? "변경할 부원 정보를 확인해 주세요." : "새 부원을 등록할까요?"}</h3>
          <p className="detail">{confirming.name + " · " + confirming.grade + "학년 · " + DAYS[confirming.day - 1] + "요일 · " + SHIFT[confirming.shift]}</p>
          <div className="actions">
            <button type="button" className="btn ghost" disabled={pending} onClick={() => setConfirming(null)}>다시 확인</button>
            <button type="button" className="btn primary" disabled={pending} onClick={() => send(confirming)}>
              {pending ? "저장 중..." : member ? "수정 확정" : "등록 확정"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// 명단 제외·졸업처럼 한 번 확인하고 서버 함수 하나를 부르는 창.
function ConfirmAction({ member, label, fn, title, note, action, busyText, danger, onClose, onDone }: {
  member: Member; label: string; fn: string; title: string; note: string; action: string; busyText: string;
  danger?: boolean; onClose: () => void; onDone: () => void;
}) {
  const { adminApi } = useAdmin();
  const { notify } = useDialogs();
  const [pending, track] = usePending();
  const run = async () => {
    let result: Result;
    try { result = await track(() => adminApi<Result>(fn, member.id)); }
    catch (e) { result = { ok: false, message: errText(e) }; }
    if (!result.ok) { notify(result.message); return; }
    onDone();
  };
  return (
    <Modal label={label} alert narrow canClose={() => !pending} onClose={onClose}>
      <h3>{title}</h3>
      <p className="muted" style={{ fontSize: ".9rem" }}>{note}</p>
      <div className="actions">
        <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>취소</button>
        <button type="button" className={danger ? "btn danger-solid" : "btn primary"} disabled={pending} onClick={run}>{pending ? busyText : action}</button>
      </div>
    </Modal>
  );
}

const ROSTER_AUDIT_LABEL: Record<string, string> = {
  MISSING_BASELINE: "시간표 기준 기록이 없습니다",
  INVALID_USER_ID: "부원 식별자가 올바르지 않습니다",
  INVALID_EVENT: "시간표 변경 기록의 형식이 잘못됐습니다",
  DUPLICATE_EVENT_ID: "변경 기록 번호가 중복됩니다",
  INVALID_PATCH: "시간표 변경 내용이 올바르지 않습니다",
  ORPHAN_EVENT: "존재하지 않는 부원을 참조하는 기록입니다",
  MISSING_HISTORY: "부원의 최초 시간표 기록이 없습니다",
  BEFORE_BASELINE: "기준 시점보다 이전의 변경 기록입니다",
  FUTURE_EVENT: "미래 시각의 변경 기록입니다",
  CURRENT_MISMATCH: "현재 시간표와 변경 기록이 일치하지 않습니다",
};
type Audit = { ok: boolean; members?: number; events?: number; errors: { code: string; userId?: number; id?: number }[] };

// 시간표 이력을 수정하지 않는 읽기 전용 점검.
function RosterAudit({ onClose }: { onClose: () => void }) {
  const { adminApi } = useAdmin();
  const [result, setResult] = useState<Audit | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { adminApi<Audit>("api_rosterAudit").then(setResult, setError); }, [adminApi]);

  const message = error ? errText(error) : !result ? "현재 시간표와 변경 기록을 확인하고 있습니다."
    : result.ok ? "문제가 발견되지 않았습니다. 부원 " + result.members + "명, 변경 기록 " + result.events + "건을 확인했습니다."
    : "확인이 필요한 항목 " + result.errors.length + "건이 있습니다.";
  return (
    <Modal label="시간표 이력 점검" onClose={onClose}>
      <h2>시간표 이력 점검</h2>
      <p className={error || result ? msgClass({ ok: !error && !!result?.ok }) : "muted"} role="status">{message}</p>
      <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>닫기</button></div>
      {result && !result.ok && (
        <>
          <ul className="col mt3">
            {result.errors.slice(0, 30).map((e, i) => (
              <li key={i} className="detail">
                {(ROSTER_AUDIT_LABEL[e.code] || "시간표 이력을 확인해 주세요") + " · 부원 ID " + (e.userId || "-") + (e.id ? " · 기록 ID " + e.id : "")}
              </li>
            ))}
          </ul>
          {result.errors.length > 30 && <p className="muted">나머지 항목은 원본 시트에서 확인해 주세요.</p>}
        </>
      )}
    </Modal>
  );
}

type Preview = {
  ok: boolean; message?: string; done?: boolean; reviewRequired?: boolean; year: number;
  members: { id: number; name: string; fromGrade: number; action: string }[];
};

// 관리자가 명단을 확인한 뒤 진급을 실행한다. 학생 출석에는 영향이 없다.
function Promotion({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { adminApi } = useAdmin();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, track] = usePending();

  useEffect(() => {
    adminApi<Preview>("api_promotionPreview").then((p) => {
      setPreview(p);
      if (p.ok) setSelected(Object.fromEntries(p.members.map((m) => [m.id, m.action])));
    }, setError);
  }, [adminApi]);

  const apply = async (p: Preview) => {
    const expected = p.members.map((m) => m.id + ":" + m.fromGrade);
    const decisions = p.members.map((m) => ({ id: m.id, action: selected[m.id] }));
    let result: Result;
    try { result = await track(() => adminApi<Result>("api_applyPromotion", p.year, expected, decisions)); }
    catch (e) { result = { ok: false, message: errText(e) }; }
    if (result.ok) { onDone(); return; }
    setStatus(result.message);
    setConfirmed(false);
  };

  const body = () => {
    if (error) return <p className="bad-text">{errText(error)}</p>;
    if (!preview) return <p className="muted" role="status">명단을 불러오는 중입니다.</p>;
    if (!preview.ok) return <p className="bad-text">{preview.message}</p>;
    if (preview.done) return <p>{preview.year}학년도 명단 정리를 마쳤습니다.</p>;
    if (preview.reviewRequired) {
      return (
        <>
          <p className="bad-text bold">이전 작업의 처리 결과를 먼저 확인해 주세요.</p>
          <p className="muted">중복 적용을 막기 위해 정리를 중단했습니다. 이력 점검 후 담당자가 원본 명단을 확인해야 합니다.</p>
        </>
      );
    }
    const counts: Record<string, number> = { promote: 0, graduate: 0, exclude: 0, keep: 0 };
    Object.values(selected).forEach((action) => { counts[action]++; });
    return (
      <>
        <p className="muted">{preview.year}학년도 · 기존 재학생 {preview.members.length}명</p>
        <p>학생별 처리 방법을 확인해 주세요.</p>
        <p className="muted">졸업은 학년과 관계없이 같은 항목에서 처리합니다. 명단 제외·진급 유예는 아래에서, 신입생 등록은 부원 관리에서 선택하세요.</p>
        <ul className="promotion-list">
          {preview.members.map((m) => {
            const options = ([
              ["promote", "진급 → " + (m.fromGrade + 1) + "학년"],
              ["graduate", "졸업 처리"],
              ["exclude", "명단 제외"],
              ["keep", "현 상태 유지"],
            ] as const).filter(([action]) => action !== "promote" || m.fromGrade < 3);
            return (
              <li key={m.id} className="promotion-row">
                <div className="promotion-person"><span className="bold">{m.name}</span><span className="name-sub">현재 {m.fromGrade}학년</span></div>
                <label className="promotion-choice">
                  <span className="sr-only">{m.name} 처리 방법</span>
                  <select className="field promotion-select" aria-label={m.name + " 처리 방법"} value={selected[m.id]}
                    onChange={(e) => { setSelected((s) => ({ ...s, [m.id]: e.target.value })); setConfirmed(false); setStatus(""); }}>
                    {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="promotion-summary" role="status" aria-live="polite">
          {"진급 " + counts.promote + "명 · 졸업 " + counts.graduate + "명 · 명단 제외 " + counts.exclude + "명 · 유지 " + counts.keep + "명"}
        </p>
        <label className="row wrap promotion-confirm">
          <input type="checkbox" aria-label="명단 정리 내용 확인" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          위 내용을 확인했습니다.
        </label>
        <p role="alert" className="msg bad-text">{status}</p>
        <button type="button" className="btn primary" disabled={!confirmed || !preview.members.length || pending} onClick={() => apply(preview)}>
          {pending ? "반영 중..." : "변경 사항 적용"}
        </button>
      </>
    );
  };

  return (
    <Modal label="학년도 명단 정리" className="promotion-dialog" onClose={onClose}>
      <h2>학년도 명단 정리</h2>
      <div className="col">{body()}</div>
      <div className="actions"><button className="btn ghost" type="button" onClick={onClose}>닫기</button></div>
    </Modal>
  );
}
