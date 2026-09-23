import { prisma } from "./db";

/**
 * Email 未驗證閘門：真人帳號需先驗證才能使用配對/組隊/聯絡。
 * - 有 email 但尚未驗證 → "email_unverified"
 * - 使用者不存在（例如帳號剛被刪除）→ "unauthorized"
 * - 示範身分（email 為 null）與已驗證帳號 → null（放行）
 * 呼叫端：`const g = await emailGate(uid); if (g) return NextResponse.json({ error: g }, { status: 403 });`
 */
export async function emailGate(
  uid: string,
): Promise<"email_unverified" | "unauthorized" | null> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user) return "unauthorized";
  if (user.email && !user.emailVerifiedAt) return "email_unverified";
  return null;
}
