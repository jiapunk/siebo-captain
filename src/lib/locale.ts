import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./i18n-dict";

const isLocale = (v: unknown): v is Locale =>
  v === "zh" || v === "cn" || v === "en" || v === "ja";

/** 單一語言標籤 → 本站語系（對不上回 null）；規則與前端 detectLocale 相同：zh-TW/HK/MO/Hant 為繁中，其他 zh 為簡中 */
function localeFromTag(tag: string): Locale | null {
  const t = tag.trim().toLowerCase();
  if (t.startsWith("ja")) return "ja";
  if (t.startsWith("en")) return "en";
  if (t === "zh" || t.startsWith("zh-"))
    return /^zh-(tw|hk|mo|hant)/.test(t) ? "zh" : "cn";
  return null;
}

/**
 * 解析 Accept-Language（依 q 值排序），回傳第一個對得上的語系；都對不上回 null。
 * 例：「zh-CN,zh;q=0.9,en;q=0.8」→ cn；「fr-FR,ja;q=0.5」→ ja。
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const qv = q ? Number(q.slice(2)) : 1;
      return { tag, q: Number.isFinite(qv) ? qv : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const hit = localeFromTag(tag);
    if (hit) return hit;
  }
  return null;
}

/**
 * 伺服器端決定語系：sc_lang cookie → Accept-Language → zh。
 * fromCookie=false 表示使用者還沒有 cookie（首次造訪）：前端 LocaleProvider 會把這個結果寫回 cookie，
 * 之後 API 產生的動態內容（訪談、逐字稿、破冰卡…）就跟介面語系一致。
 */
export async function resolveServerLocale(): Promise<{ locale: Locale; fromCookie: boolean }> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(raw)) return { locale: raw, fromCookie: true };
  const h = await headers();
  return {
    locale: localeFromAcceptLanguage(h.get("accept-language")) ?? "zh",
    fromCookie: false,
  };
}

/** 從 cookie 取得當前語系（伺服器端；動態內容生成用）；沒有 cookie 時依 Accept-Language，都沒有則 zh */
export async function getServerLocale(): Promise<Locale> {
  return (await resolveServerLocale()).locale;
}

/** 語系 → <html lang> 值（前端 LocaleProvider 切換語系時用同一組對應） */
export function htmlLangOf(locale: Locale): string {
  return locale === "zh" ? "zh-Hant" : locale === "cn" ? "zh-Hans" : locale;
}
