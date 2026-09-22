import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import {
  base,
  buildTeamAssemblyAssets,
  enabled,
  fetchAssets,
  hubStats,
  linked,
  nodeId,
  publishBundle,
  validateBundle,
} from "@/lib/evomap";

export const dynamic = "force-dynamic";

function mask(id: string): string {
  return id.length > 10 ? `${id.slice(0, 9)}…` : id;
}

async function currentBundle() {
  const [run, teams] = await Promise.all([
    prisma.matchRun.findFirst({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.team.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const avgScore = teams.length
    ? teams.reduce((s, t) => s + t.score, 0) / teams.length
    : 0;
  const provider =
    ((run?.reportA as { decisionSource?: string } | null)?.decisionSource ??
      "unknown") as string;
  return {
    runId: run?.id ?? "no-run",
    teams: teams.length,
    avgScore,
    provider,
    assets: buildTeamAssemblyAssets({
      teams: teams.length,
      avgScore,
      provider,
      runId: run?.id ?? "no-run",
    }),
  };
}

/** EvoMap 連線狀態（opt-in） */
export async function GET() {
  if (!enabled()) {
    return NextResponse.json({
      enabled: false,
      linked: false,
      base: base(),
      note: "EVOMAP_ENABLED=1 才會連線（opt-in）",
    });
  }
  const stats = linked() ? await hubStats() : null;
  return NextResponse.json({
    enabled: true,
    linked: linked(),
    nodeId: mask(nodeId()),
    base: base(),
    hubStats: stats?.ok ? stats.data : null,
  });
}

export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

  const body = (await req.json()) as { action?: string };
  const bundle = await currentBundle();

  switch (body.action) {
    case "validate": {
      const res = await validateBundle(bundle.assets);
      return NextResponse.json({ ok: res.ok, action: "validate", result: res.data ?? res.error, runId: bundle.runId });
    }
    case "publish": {
      const res = await publishBundle(bundle.assets);
      return NextResponse.json({ ok: res.ok, action: "publish", result: res.data ?? res.error, runId: bundle.runId });
    }
    case "fetch": {
      const res = await fetchAssets(["hackathon_teaming", "team_formation"]);
      const assets = (res.data as { assets?: unknown[] } | undefined)?.assets ?? [];
      return NextResponse.json({
        ok: res.ok,
        action: "fetch",
        found: assets.length,
        result: res.data ?? res.error,
      });
    }
    default:
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }
}
