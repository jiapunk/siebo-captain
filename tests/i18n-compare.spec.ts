import { test, expect, type Page } from "@playwright/test";
import {
  CJK_RE,
  enterAsDemo,
  launchAndWait,
  offenders,
  resetDemo,
  shotPath,
  TRAD_RE,
  uiText,
} from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

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
