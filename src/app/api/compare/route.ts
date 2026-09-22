import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { cachedComparison, runSoloBaseline, swarmMetricsForRun } from "@/lib/compare";

export const dynamic = "force-dynamic";

/** GET ?runId= → 已快取的對照（沒有單體結果時只回蜂群） */
export async function GET(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const runId = new URL(req.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const cached = await cachedComparison(runId);
  if (cached) return NextResponse.json({ comparison: cached });
  const swarm = await swarmMetricsForRun(runId);
  if (!swarm) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ comparison: null, swarm });
}

/** POST { runId, force? } → 跑一次單體 baseline（1 次 LLM 呼叫）並回傳對照 */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { runId?: string; force?: boolean };
  if (!body.runId)
    return NextResponse.json({ error: "runId required" }, { status: 400 });

  const cmp = await runSoloBaseline(body.runId, { force: body.force });
  if (!cmp) return NextResponse.json({ error: "cannot_compare" }, { status: 404 });
  return NextResponse.json({ comparison: cmp });
}
