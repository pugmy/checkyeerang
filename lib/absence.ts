import { locked } from "./prisma.ts";
import { isExempt } from "./rules.ts";
import { manualExemption, schoolExemption } from "./school.ts";
import { loadRoster, slotMembers } from "./roster.ts";
import { DEADLINE_MINUTE, parseDate, SHIFTS, today } from "./time.ts";

// 오늘 마감이 지난 당번 중 출석하지 않은 부원을 결석(absent)으로 기록하고 runCount를 1 올린다.
// 락 안에서 이미 기록됐는지 확인하므로 여러 번(동시에도) 불러도 한 번만 반영된다.
export async function recordAbsencesToday(now: Date = new Date()) {
  const date = today(now);
  const range = parseDate(date);
  if (!range || !range.day) return;

  const due = SHIFTS.filter((s) => now >= new Date(range.start.getTime() + DEADLINE_MINUTE[s] * 60000));
  if (!due.length) return; // 마감 전에는 DB를 건드리지 않는다

  // 학사일정을 못 읽으면 면제 여부를 모르므로 잘못된 결석을 남기지 않게 이번에는 건너뛴다(다음 실행에서 다시 시도)
  let exempt;
  try {
    exempt = await schoolExemption(date);
  } catch (e) {
    console.error("학사일정 조회 실패로 결석 기록을 건너뜁니다:", (e as Error).message);
    return;
  }

  await locked(async (tx) => {
    if ((await manualExemption(date, tx)).all) return;
    const users = await tx.user.findMany();
    const byId = new Map(users.map((u) => [u.id, u]));
    const roster = await loadRoster(tx);
    const records = await tx.choolsuck.findMany({ where: { date } });
    for (const shift of due) {
      const deadline = new Date(range.start.getTime() + DEADLINE_MINUTE[shift] * 60000);
      // 마감 시점의 시간표로 판단한다. 이후 수정된 배정으로 과거 결석을 만들지 않는다.
      for (const u of slotMembers(users, roster, date, shift, range.day)) {
        if (isExempt(exempt, u.grade)) continue;
        if (byId.get(u.id)!.createdAt >= range.start) continue; // 오늘 이전에 등록된 부원만
        if (records.some((r) => r.userId === u.id && r.shift === shift && ["duty", "absent", "excused"].includes(r.kind))) continue;
        await tx.choolsuck.create({ data: { userId: u.id, date, day: range.day, shift, kind: "absent", createdAt: deadline } });
        await tx.user.update({ where: { id: u.id }, data: { runCount: { increment: 1 } } });
      }
    }
  });
}
