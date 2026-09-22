import { prisma } from "./db";

/** Email 未驗證閘門：真人帳號需先驗證才能使用配對/組隊/聯絡（demo cookie 用戶不受限） */
export async function emailGate(uid: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true, emailVerifiedAt: true },
  });
  if (user?.email && !user.emailVerifiedAt) return "email_unverified";
  return null;
}
