import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, SID_COOKIE } from "@/lib/auth";
import { UID_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  const sid = store.get(SID_COOKIE)?.value;
  if (sid) await destroySession(sid);
  store.delete(SID_COOKIE);
  store.delete(UID_COOKIE);
  return NextResponse.json({ ok: true });
}
