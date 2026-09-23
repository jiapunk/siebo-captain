import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { getAuthMode, getCurrentUserId } from "@/lib/session";
import {
  base,
  buildTeamAssemblyAssets,
  collectAssemblyEvidence,
  enabled,
  fetchAssets,
  hubStatsCached,
  linked,
  nodeId,
  publishBundle,
  validateBundle,
  validationPassed,
} from "@/lib/evomap";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["validate", "publish", "fetch"]);

function mask(id: string): string {
  return id.length > 10 ? `${id.slice(0, 9)}…` : id;
}

/**
 * 只有「真帳號登入（sc_sid，非 demo 身分切換）＋ 有密碼 ＋ id 在 EVOMAP_ADMIN_USER_IDS」
 * 才能用團隊節點的 node_secret 對 Hub 動作；清單留空＝沒有人。
 */
async function evomapAdminId(): Promise<string | null> {
  const admins = (process.env.EVOMAP_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) return null;
  if ((await getAuthMode()) !== "session") return null;
  const uid = await getCurrentUserId();
  if (!uid || !admins.includes(uid)) return null;
  // 示範身分（seed-*）一律沒有密碼：就算被列進清單也不放行
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { passwordHash: true },
  });
  return user?.passwordHash ? uid : null;
}

/** EvoMap 連線狀態（opt-in；公開、不含任何秘密；Hub stats 快取 60 秒） */
export async function GET() {
  if (!enabled()) {
    return NextResponse.json({
      enabled: false,
      linked: false,
      base: base(),
      note: "EVOMAP_ENABLED=1 才會連線（opt-in）",
    });
  }
  const stats = linked() ? await hubStatsCached() : null;
  return NextResponse.json({
    enabled: true,
    linked: linked(),
    nodeId: mask(nodeId()),
    base: base(),
    hubStats: stats?.ok ? stats.data : null,
  });
}

/** 管理動作（validate / publish / fetch）：僅限 EvoMap 管理者；一般發佈請用 npm run evomap:release */
export async function POST(req: Request) {
  const admin = await evomapAdminId();
  if (!admin)
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rl = rateLimit(`evomap:${admin}`, 6, 60_000);
  if (!rl.ok)
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );

  if (!enabled())
    return NextResponse.json(
      { ok: false, error: "evomap_disabled", note: "設定 EVOMAP_ENABLED=1 啟用" },
      { status: 409 },
    );
  if (!linked())
    return NextResponse.json(
      { ok: false, error: "evomap_not_linked", note: "先執行 npm run evomap:register" },
      { status: 409 },
    );

  let action: string | undefined;
  try {
    action = ((await req.json()) as { action?: string } | null)?.action;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!action || !ACTIONS.has(action))
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });

  if (action === "fetch") {
    const res = await fetchAssets(["hackathon_teaming", "team_formation"]);
    const assets = (res.data as { assets?: unknown[] } | undefined)?.assets ?? [];
    return NextResponse.json({
      ok: res.ok,
      action,
      found: assets.length,
      result: res.data ?? res.error,
    });
  }

  const evidence = await collectAssemblyEvidence(prisma);
  // publish：沒有隊伍或 validate 沒過就不發佈（網頁端沒有 --force）
  if (action === "publish" && evidence.teams === 0)
    return NextResponse.json(
      { ok: false, action, error: "no_squads", cycleId: evidence.cycleId },
      { status: 409 },
    );
  const assets = buildTeamAssemblyAssets(evidence);
  const val = await validateBundle(assets);
  const passed = validationPassed(val);
  if (action === "validate")
    return NextResponse.json({
      ok: passed,
      action,
      result: val.data ?? val.error,
      cycleId: evidence.cycleId,
    });
  if (!passed)
    return NextResponse.json(
      { ok: false, action, error: "validate_failed", result: val.data ?? val.error, cycleId: evidence.cycleId },
      { status: 422 },
    );
  const res = await publishBundle(assets);
  return NextResponse.json({
    ok: res.ok,
    action,
    result: res.data ?? res.error,
    cycleId: evidence.cycleId,
  });
}
