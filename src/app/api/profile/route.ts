import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { HACK_VISIBILITY, type HackathonProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireUser() {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  return prisma.user.findUnique({
    where: { id: uid },
    include: { profile: true },
  });
}

export async function GET() {
  const user = await requireUser();
  if (!user?.profile)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    profile: {
      status: user.profile.status,
      compiled: user.profile.compiled,
      visibility: user.profile.visibility ?? HACK_VISIBILITY,
      interview: user.profile.interview ?? [],
      verification: user.profile.verification ?? null,
    },
  });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (!user?.profile)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    compiled?: HackathonProfile;
    visibility?: Record<string, boolean>;
  };
  const data: Record<string, unknown> = {};
  if (body.compiled) data.compiled = body.compiled;
  if (body.visibility) data.visibility = body.visibility;
  await prisma.agentProfile.update({ where: { userId: user.id }, data });
  return NextResponse.json({ ok: true });
}
