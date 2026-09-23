/**
 * 雙方門檻（pair gate）的單一來源。
 *
 * 一次互盤（MatchRun）會產生兩份隊長報告：
 *   - reportA：A 的隊長評估 B（A 視角的分數）
 *   - reportB：B 的隊長評估 A（B 視角的分數）
 * 雷達、破冰卡、組隊提案都必須看「雙方」分數，不能只看自己這一側。
 *
 * 純函式：只讀傳入的 run 物件，不碰 DB、不依賴 env。
 */
import { HACK_CANDIDATE_THRESHOLD } from "./types";

/** 進雷達（watch）的最低門檻：雙方都 ≥ 50 */
export const RADAR_MIN = 50;

/** 優先（priority）／組隊／破冰卡門檻：雙方都 ≥ 60（沿用 types.ts 的 HACK_CANDIDATE_THRESHOLD） */
export const PRIORITY_MIN = HACK_CANDIDATE_THRESHOLD;

/** 門檻計算需要的最小 MatchRun 形狀（Prisma 的 MatchRun 列可直接傳入） */
export interface PairRun {
  userAId: string;
  userBId: string;
  /** Prisma Json 欄位：MatchReport | null（只讀其中的 score） */
  reportA: unknown;
  reportB: unknown;
}

export interface PairScores {
  /** 我方隊長對對方的分數（缺報告或 uid 不在這場 run 時為 null） */
  mine: number | null;
  /** 對方隊長對我的分數（缺報告或 uid 不在這場 run 時為 null） */
  theirs: number | null;
  /** min(mine, theirs)；任一側為 null 時為 null */
  min: number | null;
}

export type RadarBand = "priority" | "watch";

/** 從 Json 報告取出有限數值的 score；格式不符回 null */
function reportScore(report: unknown): number | null {
  if (!report || typeof report !== "object") return null;
  const score = (report as { score?: unknown }).score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * 以 uid 的視角取出雙方分數。
 * - uid === userAId：mine = reportA.score、theirs = reportB.score
 * - uid === userBId：mine = reportB.score、theirs = reportA.score
 * - uid 不是這場 run 的任一方：三者皆為 null
 */
export function pairScores(run: PairRun, uid: string): PairScores {
  let mine: number | null = null;
  let theirs: number | null = null;
  if (run.userAId === uid) {
    mine = reportScore(run.reportA);
    theirs = reportScore(run.reportB);
  } else if (run.userBId === uid) {
    mine = reportScore(run.reportB);
    theirs = reportScore(run.reportA);
  }
  const min = mine !== null && theirs !== null ? Math.min(mine, theirs) : null;
  return { mine, theirs, min };
}

/**
 * 雷達分級（以雙方分數中較低者判斷）：
 * - 'priority'：雙方都 ≥ PRIORITY_MIN（60）
 * - 'watch'：雙方都 ≥ RADAR_MIN（50）但未達 priority
 * - null：任一側缺報告、低於 50，或 uid 不在這場 run
 */
export function radarBand(run: PairRun, uid: string): RadarBand | null {
  const { min } = pairScores(run, uid);
  if (min === null) return null;
  if (min >= PRIORITY_MIN) return "priority";
  if (min >= RADAR_MIN) return "watch";
  return null;
}

/** 雙方都 ≥ PRIORITY_MIN（60）才算通過；缺任一報告即為 false。與視角無關。 */
export function bothPass(run: PairRun): boolean {
  const a = reportScore(run.reportA);
  const b = reportScore(run.reportB);
  return a !== null && b !== null && a >= PRIORITY_MIN && b >= PRIORITY_MIN;
}

/**
 * 每位對象只取「最新一筆」run（不論分數），再交給 radarBand / bothPass 判斷。
 * 避免新評估判不合格時，舊的合格評估「復活」。
 * runs 可為任意順序；回傳 Map<對方 id, 最新 run>。uid 不在其中的 run 會被略過。
 */
export function latestRunPerPeer<T extends PairRun & { createdAt: Date | string | number }>(
  runs: T[],
  uid: string,
): Map<string, T> {
  const ts = (r: T) => new Date(r.createdAt).getTime();
  const out = new Map<string, T>();
  for (const r of runs) {
    if (r.userAId !== uid && r.userBId !== uid) continue;
    const other = r.userAId === uid ? r.userBId : r.userAId;
    if (other === uid) continue;
    const prev = out.get(other);
    if (!prev || ts(r) > ts(prev)) out.set(other, r);
  }
  return out;
}
