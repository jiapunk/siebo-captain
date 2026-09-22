import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

type Turn = { role: "agent" | "user"; content: string; ts: number };

export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locale = await getServerLocale();

  const { content } = (await req.json()) as { content?: string };
  if (!content?.trim())
    return NextResponse.json({ error: "content required" }, { status: 400 });

  let profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
  if (!profile)
    profile = await prisma.agentProfile.create({
      data: { userId: uid, status: "draft", interview: [] },
    });
  if (profile.status === "ready")
    return NextResponse.json({ error: "already_compiled" }, { status: 409 });

  const interview = ((profile.interview as unknown as Turn[]) ?? []).slice();

  // 使用者訊息入庫
  interview.push({ role: "user", content: content.trim(), ts: Date.now() });

  const { reply, done } = await llm.interviewTurn(
    interview.map((t) => ({ role: t.role, content: t.content })),
    uid,
    locale,
  );
  interview.push({ role: "agent", content: reply, ts: Date.now() });

  await prisma.agentProfile.update({
    where: { userId: uid },
    data: { interview: interview as unknown as object[] },
  });

  return NextResponse.json({ reply, done, interview });
}
