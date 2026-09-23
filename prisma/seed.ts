import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  HACK_PERSONAS,
  DEMO_HACKER,
  EVENT_SEED,
} from "../src/lib/personas";
import { HACK_VISIBILITY } from "../src/lib/types";
import { absoluteDatabaseUrl } from "./db-path";
import { ORPHAN_RULES, orphanDeleteSql } from "./orphans";

/**
 * 種子資料（冪等）：重建活動場次，種子使用者（seed- 開頭）以 upsert 重設檔案。
 *   npm run db:seed
 *
 * - 先驗證 EVENT_* 再動資料；格式錯誤直接中止，不會清空任何東西
 * - 全部在同一個交易內完成，中途失敗整批回滾
 * - 不刪真帳號及其資料：真帳號原本的活動資格會轉到新活動，他們的互盤／隊伍也會掛到新活動
 * - 只清掉「純種子」衍生資料（雙方都是種子的互盤、全員都是種子的隊伍、種子的帳本與連線）
 */

const SEED_PREFIX = "seed-";

function fail(msg: string): never {
  console.error(`[seed] ✗ ${msg}（未變更任何資料）`);
  process.exit(1);
}

function parseDate(name: string, fallback: Date): Date {
  const raw = process.env[name];
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()))
    fail(`${name}="${raw}" 不是有效日期，請用 ISO 8601，例如 2026-09-21T09:00:00+08:00`);
  return d;
}

/** 在碰 DB 之前把活動設定全部驗證完 */
function eventConfig() {
  const name = (process.env.EVENT_NAME || EVENT_SEED.name).trim();
  const code = (process.env.EVENT_CODE || EVENT_SEED.code).trim().toUpperCase();
  if (!name) fail("EVENT_NAME 不可為空白");
  if (!/^\S{2,64}$/.test(code))
    fail(`EVENT_CODE="${code}" 格式不符（2–64 個字元、不可含空白）`);
  const startsAt = parseDate("EVENT_STARTS_AT", EVENT_SEED.startsAt);
  const endsAt = parseDate("EVENT_ENDS_AT", EVENT_SEED.endsAt);
  if (endsAt.getTime() <= startsAt.getTime())
    fail(`EVENT_ENDS_AT（${endsAt.toISOString()}）必須晚於 EVENT_STARTS_AT（${startsAt.toISOString()}）`);
  return { name, code, startsAt, endsAt };
}

const cfg = eventConfig();
// 未設定 DATABASE_URL 時與 prisma.config.ts 一樣退回 file:./dev.db；用絕對路徑（相對 prisma/）開檔
const prisma = new PrismaClient({ datasourceUrl: absoluteDatabaseUrl() });

async function main() {
  const personas = [DEMO_HACKER, ...HACK_PERSONAS];
  const personaIds = personas.map((p) => `${SEED_PREFIX}${p.name}`);

  const result = await prisma.$transaction(
    async (tx) => {
      const isSeed = { startsWith: SEED_PREFIX };

      // ---- 純種子衍生資料（雙方都是種子的互盤、全員都是種子的隊伍、種子之間的連線、種子帳本）----
      const seedRuns = await tx.matchRun.findMany({
        where: { userAId: isSeed, userBId: isSeed },
        select: { id: true },
      });
      const seedRunIds = seedRuns.map((r) => r.id);
      await tx.icebreaker.deleteMany({ where: { runId: { in: seedRunIds } } });
      await tx.swarmPart.deleteMany({ where: { runId: { in: seedRunIds } } });
      await tx.soloBaseline.deleteMany({ where: { runId: { in: seedRunIds } } });
      await tx.matchRun.deleteMany({ where: { id: { in: seedRunIds } } });

      // 有任何真帳號成員的隊伍保留（連同其中的種子隊友）
      const seedTeams = await tx.team.findMany({
        where: { members: { every: { userId: isSeed } } },
        select: { id: true },
      });
      const seedTeamIds = seedTeams.map((t) => t.id);
      await tx.team.deleteMany({ where: { id: { in: seedTeamIds } } }); // TeamMember / TeamMessage 串聯刪除
      // 種子視角的組隊假設 Part（teamId = h:<viewerId>）
      await tx.swarmPart.deleteMany({
        where: { runId: null, teamId: { startsWith: `h:${SEED_PREFIX}` } },
      });
      await tx.connection.deleteMany({ where: { userAId: isSeed, userBId: isSeed } }); // ConnectMessage 串聯刪除
      await tx.ledgerEvent.deleteMany({ where: { userId: isSeed } });
      // runId／teamId 沒有 FK：順手清掉指向已不存在互盤或 owner 的孤兒資料（規則見 prisma/orphans.ts）
      for (const rule of ORPHAN_RULES) await tx.$executeRawUnsafe(orphanDeleteSql(rule));

      // 已不在 personas 名單裡的舊種子使用者
      await tx.user.deleteMany({ where: { id: { startsWith: SEED_PREFIX, notIn: personaIds } } });

      // ---- 活動：記下真帳號的活動資格與掛在舊活動上的互盤/隊伍，重建後轉到新活動 ----
      const oldEventIds = (await tx.event.findMany({ select: { id: true } })).map((e) => e.id);
      const realMembers = await tx.eventMember.findMany({
        where: { eventId: { in: oldEventIds }, userId: { not: isSeed } },
        select: { userId: true },
      });
      const keptRunIds = (
        await tx.matchRun.findMany({ where: { eventId: { in: oldEventIds } }, select: { id: true } })
      ).map((r) => r.id);
      const keptTeamIds = (
        await tx.team.findMany({ where: { eventId: { in: oldEventIds } }, select: { id: true } })
      ).map((t) => t.id);
      await tx.event.deleteMany({ where: { id: { in: oldEventIds } } }); // EventMember 串聯刪除

      const event = await tx.event.create({ data: cfg });

      // ---- 種子使用者：upsert（保持 id 不變，真帳號與種子的互盤/隊伍不會斷）----
      for (const p of personas) {
        const id = `${SEED_PREFIX}${p.name}`;
        const base = { name: p.name, emoji: p.emoji, tagline: p.tagline, isBot: p.isBot };
        // 示範身分一律無 email／密碼（示範切換只允許這類帳號）
        await tx.user.upsert({
          where: { id },
          create: { id, ...base },
          update: { ...base, email: null, passwordHash: null, emailVerifiedAt: null },
        });
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.authToken.deleteMany({ where: { userId: id } });
        const profile = {
          status: "ready",
          compiled: p.profile as unknown as Prisma.InputJsonValue,
          visibility: { ...HACK_VISIBILITY } as unknown as Prisma.InputJsonValue,
          interview: [] as unknown as Prisma.InputJsonValue,
        };
        await tx.agentProfile.upsert({
          where: { userId: id },
          create: { userId: id, ...profile },
          update: { ...profile, verification: Prisma.DbNull },
        });
        await tx.eventMember.create({ data: { eventId: event.id, userId: id } });
      }

      const realIds = [...new Set(realMembers.map((m) => m.userId))];
      for (const userId of realIds) {
        await tx.eventMember.create({ data: { eventId: event.id, userId } });
      }
      await tx.matchRun.updateMany({
        where: { id: { in: keptRunIds } },
        data: { eventId: event.id },
      });
      await tx.team.updateMany({
        where: { id: { in: keptTeamIds } },
        data: { eventId: event.id },
      });

      return {
        event,
        realRejoined: realIds.length,
        removedRuns: seedRunIds.length,
        removedTeams: seedTeamIds.length,
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const count = await prisma.user.count();
  console.log(
    `Seeded event「${result.event.name}」(${result.event.code}). Seed participants: ${personas.length}, ` +
      `real accounts re-joined: ${result.realRejoined}, total users: ${count}, ` +
      `removed seed-only runs/teams: ${result.removedRuns}/${result.removedTeams}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
