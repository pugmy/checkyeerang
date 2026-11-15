// 서버가 켜져 있는 동안 1분마다 마감이 지난 미출석 당번을 결석으로 기록한다.
// (페이지를 열지 않아도 자동으로 처리되도록 하는 용도. 서버리스 환경에서는 동작하지 않으므로
//  그때는 외부 스케줄러가 /api/rpc로 api_home을 주기적으로 부르면 된다.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as { __absenceTimer?: ReturnType<typeof setInterval> };
  if (g.__absenceTimer) return; // 개발 중 재실행되어도 타이머가 중복되지 않게 한다

  const { recordAbsencesToday } = await import("./lib/absence");
  const { locked } = await import("./lib/prisma");
  const { ensureBaseline } = await import("./lib/roster");
  // 첫 실행에서 시간표 이력의 기준 시점을 봉인한다. DB가 아직 준비되지 않았어도 서버는 뜬다.
  await locked(ensureBaseline).catch((e) => console.error("시간표 기준 시점 설정 실패:", e));
  const { syncNeisSchedule } = await import("./lib/neis");
  // NEIS 일정을 하루에 한 번 가져온다(함수 안에서 횟수를 제한한다). 결석 기록 전에 해야 휴업일을 놓치지 않는다.
  const run = () => syncNeisSchedule().catch((e) => console.error("NEIS 일정 가져오기 실패:", e))
    .then(() => recordAbsencesToday()).catch((e) => console.error("결석 자동 기록 실패:", e));

  g.__absenceTimer = setInterval(run, 60 * 1000);
  g.__absenceTimer.unref?.();
  run();
}
