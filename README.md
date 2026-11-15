# 도서부 출석체크 (Next.js)

구글 스크립트 버전과 같은 화면·기능을 Next.js + Prisma(Postgres)로 옮긴 프로젝트입니다.
화면 코드는 `app/ui.ts`(옛 `Index.html`의 스크립트), 서버 로직은 `lib/`, 서버 호출 입구는 `app/api/rpc/route.ts` 하나입니다.

## 처음 설정

1. `npm install`
2. `.env.example`을 `.env`로 복사해 채웁니다.
   - `DATABASE_URL`, `DIRECT_URL`: Postgres 주소
   - `ADMIN_PASSWORD_HASH`: `node scripts/create-admin-credential.mjs`를 실행해 나온 **해시 줄**을 넣고, 같이 나온 비밀번호는 따로 보관합니다(관리자 로그인에 쓰는 것은 비밀번호입니다).
   - `NEIS_KEY`: NEIS 오픈API 인증키
3. `npx prisma migrate deploy` (테이블 생성)
4. `npm run build` 후 `npm start` (개발은 `npm run dev`)

## 동작 메모

- 결석 자동 기록: 서버가 켜져 있는 동안 1분마다 돌고(`instrumentation.ts`), 화면을 열 때도 한 번 확인합니다. 서버리스(Vercel 등)에서는 타이머가 돌지 않으니 외부 스케줄러가 `api_home`을 주기적으로 불러야 합니다.
- 시간표 이력의 기준 시점은 서버가 처음 켜질 때 한 번 정해지고, 그 전 날짜는 "미확인"으로 표시됩니다.
- 쓰기 작업은 DB 락 안의 트랜잭션이라 중간에 실패하면 통째로 취소됩니다.
- 테스트: `npm test` (시간·면제·시간표 이력 규칙. DB와 NEIS는 쓰지 않음)
