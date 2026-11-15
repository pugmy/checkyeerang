// 관리자 전용 인증. 모든 관리 API에서 서버 측으로 검증한다.
// 환경변수 ADMIN_PASSWORD_HASH는 "salt:sha256" 형식(scripts/create-admin-credential.mjs로 만든다).
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma.ts";
import { getSetting, setSetting } from "./settings.ts";

const SESSION_MS = 4 * 3600 * 1000;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 12;

export class AppError extends Error {}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function config() {
  const [salt, hash, ...rest] = (process.env.ADMIN_PASSWORD_HASH ?? "").trim().split(":");
  if (rest.length || !/^[0-9a-f]{32}$/.test(salt ?? "") || !/^[0-9a-f]{64}$/.test(hash ?? "")) return null;
  return { salt, hash };
}

export async function adminLogin(password: unknown) {
  const c = config();
  if (!c) return { ok: false, message: "관리자 비밀번호가 설정되지 않았습니다." };
  // 여러 사람이 공유하는 웹앱이므로 전역 속도 제한을 둔다. 실패가 누적되면 정상 관리자도 잠시 제한될 수 있다.
  const [count, until] = ((await getSetting(prisma, "ADMIN_FAILED")) ?? "0|0").split("|").map(Number);
  const failed = Date.now() < until ? count : 0;
  if (failed >= FAILURE_LIMIT) return { ok: false, message: "로그인 시도가 많습니다. 잠시 후 다시 시도하세요." };
  if (typeof password !== "string" || password.length > 256 || sha(c.salt + ":" + password) !== c.hash) {
    await setSetting(prisma, "ADMIN_FAILED", `${failed + 1}|${Date.now() + FAILURE_WINDOW_MS}`);
    return { ok: false, message: "비밀번호가 올바르지 않습니다." };
  }
  await setSetting(prisma, "ADMIN_FAILED", "0|0");
  // 브라우저에는 비밀번호 대신 짧은 수명의 불투명 토큰만 전달하고, DB에는 토큰의 해시만 둔다.
  const token = randomUUID() + randomUUID();
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.adminSession.create({ data: { tokenHash: sha(token), expiresAt: new Date(Date.now() + SESSION_MS) } });
  return { ok: true, token };
}

export async function requireAdmin(token: unknown) {
  if (!config() || typeof token !== "string" || token.length !== 72 || !/^[0-9a-f-]+$/i.test(token)) {
    throw new AppError("관리자 로그인이 필요합니다.");
  }
  const s = await prisma.adminSession.findUnique({ where: { tokenHash: sha(token) } });
  if (!s || s.expiresAt < new Date()) throw new AppError("관리자 로그인이 만료되었습니다. 다시 로그인하세요.");
}

export async function adminLogout(token: unknown) {
  if (typeof token === "string" && token.length === 72) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: sha(token) } });
  }
  return { ok: true, message: "로그아웃되었습니다." };
}
