import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { verifyGithub, GithubVerifyError } from "@/lib/github";
import type { HackathonProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { username } = (await req.json()) as { username?: string };
  const clean = username?.trim().replace(/^@/, "");
  if (!clean || !/^[a-zA-Z0-9-]{1,39}$/.test(clean))
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });

  const profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
  const compiled = profile?.compiled as unknown as HackathonProfile | null;
  if (!profile || !compiled?.role)
    return NextResponse.json({ error: "profile_missing" }, { status: 400 });

  try {
    const result = await verifyGithub(clean, compiled.skills ?? []);
    await prisma.agentProfile.update({
      where: { userId: uid },
      data: { verification: result as unknown as object },
    });
    return NextResponse.json({ verification: result });
  } catch (e) {
    if (e instanceof GithubVerifyError) {
      const text =
        e.code === "not_found"
          ? "找不到這個 GitHub 帳號，確認一下拼字。"
          : e.code === "rate_limited"
            ? "GitHub 暫時限流，請過幾分鐘再試。"
            : "GitHub 查詢失敗，請稍後再試。";
      return NextResponse.json(
        { error: e.code, message: text },
        { status: e.code === "not_found" ? 404 : 502 },
      );
    }
    throw e;
  }
}
