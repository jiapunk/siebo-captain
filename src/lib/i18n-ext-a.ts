/**
 * i18n 擴充字典 A（前端組 A 專用）。
 * 新增的 key 只寫在這裡，不要改 i18n-dict.ts 主字典；合併時 ext 會覆蓋主字典同名 key。
 * 四個語系都要補齊（cn = 簡體中文）。
 */
import type { Locale } from "./i18n-dict";

export const EXT_A: Record<Locale, Record<string, string>> = {
  zh: {},
  cn: {},
  en: {},
  ja: {},
};
