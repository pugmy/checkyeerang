import type { Db } from "./prisma.ts";

export async function getSetting(db: Db | { setting: Db["setting"] }, key: string) {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
}

export async function setSetting(db: Db | { setting: Db["setting"] }, key: string, value: string) {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
