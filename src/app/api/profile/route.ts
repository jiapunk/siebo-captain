import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { readJsonBody } from "@/lib/auth";
import {
  HACK_VISIBILITY,
  HACK_VISIBILITY_FIELDS,
  type HackathonProfile,
} from "@/lib/types";

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

// ---------- PUT 的手寫 schema（型別、長度上限、陣列上限） ----------
/** 使用者可編輯的字串欄位與長度上限（字元數） */
const STRING_FIELDS: Record<string, number> = {
  nickname: 60,
  role: 60,
  timezone: 80,
  availability: 120,
  goal: 200,
  workingStyle: 200,
  vibe: 500,
  bio: 2000,
};
/** 使用者可編輯的字串陣列欄位：[最多幾項, 每項長度上限] */
const ARRAY_FIELDS: Record<string, [number, number]> = {
  skills: [30, 80],
  dealbreakers: [20, 300],
};

type Invalid = { invalid: string };

/** 與伺服器現值完全相同（客戶端只是把 GET 拿到的值原樣送回）→ 不視為修改，不做驗證 */
function unchanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 驗證 compiled：只收白名單欄位，型別/長度不符 → { invalid: 欄位名 }。
 * 不在白名單的欄位（包含 github）一律忽略——github 只能由 /api/profile/verify/github 寫入 verification。
 * 與現值相同的欄位直接略過（避免 LLM 編譯出的舊資料格式不合，讓使用者連存檔都存不了）。
 */
function parseCompiled(
  raw: unknown,
  current: Record<string, unknown>,
): Partial<HackathonProfile> | Invalid {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { invalid: "compiled" };
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(STRING_FIELDS)) {
    if (!(k in src) || src[k] === undefined || unchanged(src[k], current[k])) continue;
    const v = src[k];
    if (typeof v !== "string" || v.length > max) return { invalid: `compiled.${k}` };
    out[k] = v;
  }
  for (const [k, [maxItems, maxLen]] of Object.entries(ARRAY_FIELDS)) {
    if (!(k in src) || src[k] === undefined || unchanged(src[k], current[k])) continue;
    const v = src[k];
    if (
      !Array.isArray(v) ||
      v.length > maxItems ||
      v.some((x) => typeof x !== "string" || x.length > maxLen)
    )
      return { invalid: `compiled.${k}` };
    out[k] = v;
  }
  return out as Partial<HackathonProfile>;
}

/** 驗證 visibility：只收 HACK_VISIBILITY_FIELDS 的布林值；其他 key 忽略，值不是布林 → invalid */
function parseVisibility(raw: unknown): Record<string, boolean> | Invalid {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { invalid: "visibility" };
  const src = raw as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const k of HACK_VISIBILITY_FIELDS) {
    if (!(k in src) || src[k] === undefined) continue;
    if (typeof src[k] !== "boolean") return { invalid: `visibility.${k}` };
    out[k] = src[k] as boolean;
  }
  return out;
}

function isInvalid(v: unknown): v is Invalid {
  return Boolean(v && typeof v === "object" && "invalid" in v);
}

/**
 * 更新自己的檔案。
 * - body: { compiled?: Partial<HackathonProfile>, visibility?: Record<field, boolean> }
 * - 格式錯誤 → 400 { error: "invalid_profile", field }
 * - compiled 以「伺服器現有值 + 通過驗證的欄位」合併；github 永遠沿用伺服器端現值（客戶端送的會被忽略）
 * - verification（GitHub 驗證結果）不受 PUT 影響
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (!user?.profile)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(req);
  if (!body)
    return NextResponse.json({ error: "invalid_profile", field: "body" }, { status: 400 });

  const data: Record<string, unknown> = {};
  // null 視同沒帶（尚未編譯的草稿檔案，前端會送 compiled: null）
  if (body.compiled !== undefined && body.compiled !== null) {
    const current = (user.profile.compiled ?? {}) as Record<string, unknown>;
    const parsed = parseCompiled(body.compiled, current);
    if (isInvalid(parsed))
      return NextResponse.json(
        { error: "invalid_profile", field: parsed.invalid },
        { status: 400 },
      );
    const merged: Record<string, unknown> = { ...current, ...parsed };
    // github 只能由伺服器（verify 路由）決定：沿用現值，沒有就不帶
    if (current.github !== undefined) merged.github = current.github;
    else delete merged.github;
    data.compiled = merged;
  }
  if (body.visibility !== undefined && body.visibility !== null) {
    const parsed = parseVisibility(body.visibility);
    if (isInvalid(parsed))
      return NextResponse.json(
        { error: "invalid_profile", field: parsed.invalid },
        { status: 400 },
      );
    const current = (user.profile.visibility ?? HACK_VISIBILITY) as Record<string, boolean>;
    data.visibility = { ...current, ...parsed };
  }
  if (Object.keys(data).length > 0)
    await prisma.agentProfile.update({ where: { userId: user.id }, data });
  return NextResponse.json({ ok: true });
}
