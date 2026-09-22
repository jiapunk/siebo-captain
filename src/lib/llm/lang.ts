import type { Locale } from "../i18n-dict";

/** 給真 LLM 的輸出語言指令 */
export function langDirective(locale: Locale): string {
  const names: Record<Locale, string> = {
    zh: "繁體中文（台灣用語）",
    cn: "简体中文（中国大陆用语）",
    en: "English",
    ja: "日本語",
  };
  return `\n\n【輸出語言】一律使用${names[locale]}撰寫所有欄位與句子，不得混用其他語言（專有名詞如技術棧名稱可保留原文）。`;
}
