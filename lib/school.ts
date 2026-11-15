import { prisma, type Db } from "./prisma.ts";
import { schoolRuleExemption, type Exemption } from "./rules.ts";

// 관리자가 직접 등록한 면제 일정만 본 결과 (NEIS를 못 읽을 때도 항상 적용된다)
export async function manualExemption(date: string, db: Pick<Db, "schoolDay"> = prisma) {
  return schoolRuleExemption(date, await db.schoolDay.findMany());
}

// 면제는 모두 일정 목록(NEIS에서 가져와 사람이 고칠 수 있는 DB)이 기준이다.
export async function schoolExemption(date: string): Promise<Exemption> {
  const manual = await manualExemption(date);
  return { ...manual, grades: manual.all ? { 1: true, 2: true, 3: true } : manual.grades };
}

// NEIS가 실패하면 수동 일정만으로 판단한다 (출석·보충 요청처럼 막히면 안 되는 곳)
export async function schoolExemptionOrManual(date: string) {
  try {
    return await schoolExemption(date);
  } catch {
    return manualExemption(date);
  }
}
