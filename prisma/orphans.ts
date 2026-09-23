/**
 * 孤兒資料規則（seed.ts 與 scripts/db-prune-orphans.ts 共用）
 *
 * schema.prisma 裡 SwarmPart.runId／teamId、Icebreaker.runId、SoloBaseline.runId 都沒有 FK
 * （SQLite 補 FK 要重建資料表，黑客松期間不做），參照完整性由應用層維護：
 *   - src/lib/auth.ts deleteUserAndData：刪帳號時同一交易清掉他的 run、part、破冰卡、team_eval
 *   - prisma/seed.ts：重建種子時清掉純種子衍生資料，並套用下面的規則
 *   - scripts/db-prune-orphans.ts：對既有 DB（dev.db、demo 快照）套用下面的規則；demo:restore 會自動跑
 *
 * 每條規則都是「指向已不存在的 MatchRun／User」的列，讀取端本來就以 runId／h:<userId> 過濾，
 * 所以刪除不會改變任何畫面或 API 結果。
 */
export type OrphanRule = {
  /** 報表用名稱 */
  label: string;
  table: "SwarmPart" | "Icebreaker" | "SoloBaseline";
  /** WHERE 條件（不含 WHERE 關鍵字；只引用 table 本身與 MatchRun／User） */
  where: string;
};

export const ORPHAN_RULES: readonly OrphanRule[] = [
  {
    label: "SwarmPart：互盤 part（q:/a:/r:<runId>:A|B）的 MatchRun 已不存在",
    table: "SwarmPart",
    where: `"runId" IS NOT NULL AND "runId" NOT IN (SELECT "id" FROM "MatchRun")`,
  },
  {
    label: "Icebreaker：runId 指向的 MatchRun 已不存在",
    table: "Icebreaker",
    where: `"runId" NOT IN (SELECT "id" FROM "MatchRun")`,
  },
  {
    label: "SoloBaseline：runId 指向的 MatchRun 已不存在",
    table: "SoloBaseline",
    where: `"runId" NOT IN (SELECT "id" FROM "MatchRun")`,
  },
  {
    // teamId = h:<ownerId>（最新一輪）或 h:<ownerId>:prev（上一輪封存），見 src/lib/teamAssembler.ts
    label: "SwarmPart：組隊假設 part（teamId = h:<owner>[:prev]）的 owner 已不存在",
    table: "SwarmPart",
    where:
      `"runId" IS NULL AND "teamId" LIKE 'h:%' AND NOT EXISTS (` +
      `SELECT 1 FROM "User" u WHERE "SwarmPart"."teamId" = 'h:' || u."id" ` +
      `OR "SwarmPart"."teamId" = 'h:' || u."id" || ':prev')`,
  },
];

export const orphanCountSql = (r: OrphanRule) =>
  `SELECT COUNT(*) AS c FROM "${r.table}" WHERE ${r.where}`;

export const orphanDeleteSql = (r: OrphanRule) => `DELETE FROM "${r.table}" WHERE ${r.where}`;
