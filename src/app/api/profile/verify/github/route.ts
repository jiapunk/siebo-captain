import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { readJsonBody } from "@/lib/auth";
import { checkLimits, clientKey } from "@/lib/rateLimit";
import {
  verifyGithub,
  normalizeGithubUsername,
  GithubVerifyError,
} from "@/lib/github";
import type { HackathonProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GitHub 公開資料比對。
 * 成功：{ verification, ownershipVerified: false }——只比對公開資料，不證明帳號屬於本人，UI 要標註。
 * 失敗（error 碼）：
 *   400 invalid_username（格式不合；已接受 @foo、github.com/foo、https://github.com/foo/）
 *   400 profile_missing（尚未完成訪談、沒有 compiled.role）
 *   404 not_found
 *   429 rate_limited（GitHub 限流，附 retryAfterSec）／429 too_many_attempts（本站節流，附 retryAfterSec）
 *   502 fetch_failed（逾時、網路錯誤、GitHub 回傳非預期內容）
 */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJsonBody(req);
  const clean = normalizeGithubUsername(body?.username);
  if (!clean)
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });

  const profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
  const compiled = profile?.compiled as unknown as HackathonProfile | null;
  if (!profile || !compiled?.role)
    return NextResponse.json({ error: "profile_missing" }, { status: 400 });

  // 每人 10 分鐘 5 次、每個來源 10 分鐘 30 次：保護伺服器共用的 GitHub API 額度
  const limited = checkLimits([
    [`gh-verify:user:${uid}`, 5, 10 * 60 * 1000],
    [`gh-verify:client:${clientKey(req)}`, 30, 10 * 60 * 1000],
  ]);
  if (limited) return limited;

  try {
    const skills = Array.isArray(compiled.skills)
      ? compiled.skills.filter((s): s is string => typeof s === "string")
      : [];
    const result = await verifyGithub(clean, skills, req.signal);
    await prisma.agentProfile.update({
      where: { userId: uid },
      data: { verification: result as unknown as object },
    });
    return NextResponse.json({ verification: result, ownershipVerified: false });
  } catch (e) {
    const err = e instanceof GithubVerifyError ? e : new GithubVerifyError("fetch_failed");
    if (!(e instanceof GithubVerifyError)) console.error("[github-verify]", e);
    const status =
      err.code === "not_found" ? 404 : err.code === "rate_limited" ? 429 : 502;
    return NextResponse.json(
      {
        error: err.code,
        ...(err.retryAfterSec ? { retryAfterSec: err.retryAfterSec } : {}),
      },
      {
        status,
        headers: err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined,
      },
    );
  }
}
