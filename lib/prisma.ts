import { PrismaClient, Prisma } from "../app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = Prisma.TransactionClient;

// 쓰기 작업은 전부 이 함수 안에서 한다. DB 전체 락으로 직렬화해서(구글 스크립트의 LockService 대응),
// 확인 후 쓰기(check-then-insert) 사이에 다른 요청이 끼어들지 못하게 하고, 실패하면 통째로 롤백된다.
export function locked<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
      return fn(tx);
    },
    { timeout: 20000, maxWait: 20000 },
  );
}
