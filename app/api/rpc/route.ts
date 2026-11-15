import { AppError } from "../../../lib/admin.ts";
import { handlers } from "../../../lib/api.ts";

// 화면의 모든 서버 호출이 지나가는 단일 입구. {fn, args}를 받아 lib/api.ts의 함수를 부른다.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const fn = body?.fn;
  const handler = typeof fn === "string" && Object.hasOwn(handlers, fn) ? handlers[fn] : null;
  if (!handler) return Response.json({ error: "알 수 없는 요청입니다." }, { status: 404 });
  try {
    return Response.json({ result: await handler(...(Array.isArray(body.args) ? body.args : [])) });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: 401 });
    console.error(fn, e);
    return Response.json({ error: "서버 오류" }, { status: 500 });
  }
}
