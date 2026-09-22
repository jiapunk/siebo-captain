import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./i18n-dict";

/** 從 cookie 取得當前語系（伺服器端；動態內容生成用） */
export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return raw === "cn" || raw === "en" || raw === "ja" || raw === "zh"
    ? raw
    : "zh";
}
