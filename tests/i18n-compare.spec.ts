import { test, expect, type Page } from "@playwright/test";
import { LOCALES } from "../src/lib/i18n-dict";
import { enterAsDemo, launchAndWait, resetDemo, shotPath } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

/**
 * 繁體專用字（簡體寫法不同）：简中模式下 UI 出現任何一個就是繁中殘留。
 * 已核對：這些字都不出現在 i18n-dict 的 cn 字典裡；人名常用的滿／綠／飛／歐／吳刻意不列（人名另外剔除）。
 */
const TRAD_ONLY =
  "體對單隊長執報維數據與這個們會時間應開關點選擇資訊變讓說請認證網聯發現過還進運動優勢態雙邊義價質實際較準確結構績計論總費歷紀錄類處顯測試從來為東車門問題無專業習學覺視設語話讀寫聽難錯誤條規則標參備註項圍場層級狀連線斷獲評審員組織團賽環節階隱輸載儲檔刪編輯複製導覽頁觸樣預啟異號傳廣頻圖統協風譜興觀溝鐘遲積欄韌兩鈕盤揮擊離驗碼帳戶冊訪談達絡側麼嗎屬於後裡並將當衝夥臉詳細閱擁簡歸";
const TRAD_RE = new RegExp(`[${TRAD_ONLY}]`, "gu");
/** 漢字、假名與全形標點（EN 模式下都不該出現在 UI 上） */
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff01-\uff60]/gu;

/** 取頁面文字並剔除「資料」：使用者名稱、語系切換鈕的原生語言名稱 */
async function uiText(page: Page, names: string[]): Promise<string> {
  let text = await page.locator("body").innerText();
  const strip = [...names, ...LOCALES.map((l) => l.label)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const s of strip) text = text.split(s).join(" ");
  return text;
}

/** 列出命中的字與前後文，失敗訊息直接指出殘留在哪 */
function offenders(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    out.push(`「${m[0]}」…${text.slice(Math.max(0, i - 8), i + 8).replace(/\s+/g, " ")}…`);
    if (out.length >= 15) break;
  }
  return out;
}

async function openCompare(page: Page) {
  const loaded = page.waitForResponse(
    (r) => r.url().includes("/api/compare?runId=") && r.request().method() === "GET",
  );
  await page.goto("/compare");
  const res = await loaded;
  expect(res.status()).toBe(200);
  expect((await res.json()).comparison, "應載入已快取的對照").toBeTruthy();
  // 對照已完整渲染（取捨表出現）才取文字
  await expect(page.locator("main table").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("/compare 在简中與 EN 模式下沒有繁中殘留", async ({ page, context, baseURL }) => {
  // 以简中出發：互盤與單體 baseline 都在 cn 語系下產生
  await context.addCookies([{ name: "sc_lang", value: "cn", url: baseURL! }]);
  await enterAsDemo(page.request, "Demo阿飛");
  const runs = await launchAndWait(page.request);

  // /compare 預設選「最新一場已完成」：對同一場先跑單體 baseline（之後 GET 會回快取的完整對照）
  const { runs: listed } = (await page.request.get("/api/agent/runs").then((r) => r.json())) as {
    runs: { id: string; status: string; other: { name: string } }[];
  };
  const target = listed.find((r) => r.status === "completed");
  expect(target, "沒有已完成的對盤").toBeTruthy();
  const solo = await page.request.post("/api/compare", { data: { runId: target!.id } });
  expect(solo.status(), await solo.text()).toBe(200);

  const me = (await page.request.get("/api/me").then((r) => r.json())) as { user: { name: string } };
  const names = [me.user.name, ...runs.map((r) => r.other.name), ...listed.map((r) => r.other.name)];

  // ---- 简中 ----
  await openCompare(page);
  const cnText = await uiText(page, names);
  expect(cnText, "简中模式應有簡體 UI（導覽『对比』）").toContain("对比");
  const cnHits = offenders(cnText, TRAD_RE);
  await page.screenshot({ path: shotPath("30-compare-cn.png"), fullPage: true });
  expect(cnHits, `简中 /compare 有繁中殘留：\n${cnHits.join("\n")}`).toEqual([]);

  // ---- EN ----
  await context.addCookies([{ name: "sc_lang", value: "en", url: baseURL! }]);
  await openCompare(page);
  const enText = await uiText(page, names);
  expect(enText, "EN 模式應有英文 UI（導覽『Compare』）").toContain("Compare");
  const enHits = offenders(enText, CJK_RE);
  await page.screenshot({ path: shotPath("31-compare-en.png"), fullPage: true });
  expect(enHits, `EN /compare 有中日文殘留：\n${enHits.join("\n")}`).toEqual([]);
});
