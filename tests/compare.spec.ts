import { test, expect } from "@playwright/test";
import { resetDemo, shotPath } from "./helpers";

// 每次測試前重置 demo 資料，確保流程可重現
test.beforeAll(() => {
  resetDemo();
});

const DIM_KEYS = ["interests", "values", "lifestyle", "communication", "intent"] as const;

interface Side {
  source: string;
  latencyMs: number | null;
  calls: number;
  retries: number;
  score: number;
  verdict: string;
  dimensions: Record<(typeof DIM_KEYS)[number], number>;
  reasons: number;
  redFlags: number;
  fieldsFilled: number;
  fieldsExpected: number;
  extra: Record<string, unknown>;
}

const isScore = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

function expectSaneSide(s: Side, label: string) {
  expect(isScore(s.score), `${label}.score=${s.score}`).toBe(true);
  expect(["recommend", "cautious", "pass"], `${label}.verdict`).toContain(s.verdict);
  for (const k of DIM_KEYS)
    expect(isScore(s.dimensions?.[k]), `${label}.dimensions.${k}=${s.dimensions?.[k]}`).toBe(true);
  expect(s.fieldsExpected, `${label}.fieldsExpected`).toBe(10);
  expect(s.fieldsFilled, `${label}.fieldsFilled`).toBeGreaterThan(0);
  expect(s.fieldsFilled, `${label}.fieldsFilled`).toBeLessThanOrEqual(s.fieldsExpected);
  expect(s.calls, `${label}.calls`).toBeGreaterThanOrEqual(1);
  expect(s.retries, `${label}.retries`).toBeGreaterThanOrEqual(0);
  expect(s.reasons, `${label}.reasons`).toBeGreaterThan(0);
  if (s.latencyMs !== null) expect(s.latencyMs, `${label}.latencyMs`).toBeGreaterThanOrEqual(0);
}

/**
 * 單體 vs 蜂群對照（SECTION 9 賽道要求：質量/速度/成本取捨可量化）
 * 除了畫面標題，也驗 API 回傳的數值合理、一致性指標算得對、畫面顯示的就是這些數字。
 */
test("單體 vs 蜂群對照：跑一次單體 baseline 並顯示取捨表", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");

  // 先跑一輪蜂群（mock 模式 ~10s）
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(page.getByText(/對談進行中/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /產生隊伍提案/ })).toBeVisible({
    timeout: 60_000,
  });

  // 進入對照頁
  await page.goto("/compare");
  await expect(page.getByText("單體 vs 蜂群對照")).toBeVisible();
  await expect(page.getByText("蜂群").first()).toBeVisible({ timeout: 10_000 });

  // 執行單體 baseline，攔下 API 回應檢查數值
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/compare") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /執行單體對照/ }).click();
  const res = await posted;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    comparison: { runId: string; swarm: Side; solo: Side; agreement: { scoreDiff: number; dimAvgDiff: number } };
    perspective: string;
    viewerSide: string;
  };
  const { swarm, solo, agreement, runId } = body.comparison;
  expect(body.perspective).toBe("A");
  expect(body.viewerSide).toBe("A"); // 隊長出發的一方就是 A

  expectSaneSide(swarm, "swarm");
  expectSaneSide(solo, "solo");
  // 蜂群：6 個 Part 全部完成，每個 Part 至少一次嘗試；單體：恰好 1 次呼叫（mock 模式不外送）
  expect(swarm.extra.done).toBe(6);
  expect(swarm.extra.failed).toBe(0);
  expect(swarm.calls).toBeGreaterThanOrEqual(6);
  expect(solo.calls).toBe(1);
  expect(solo.source).toBe("mock-single");
  // 一致性指標與兩側分數一致
  expect(agreement.scoreDiff).toBe(Math.abs(swarm.score - solo.score));
  const dimAvg =
    Math.round(
      (DIM_KEYS.reduce((a, k) => a + Math.abs(swarm.dimensions[k] - solo.dimensions[k]), 0) /
        DIM_KEYS.length) *
        10,
    ) / 10;
  expect(agreement.dimAvgDiff).toBe(dimAvg);
  // 蜂群分數就是該 run 的隊長報告分數
  const { runs } = (await page.request.get("/api/agent/runs").then((r) => r.json())) as {
    runs: { id: string; myReport: { score: number } | null }[];
  };
  expect(runs.find((r) => r.id === runId)?.myReport?.score).toBe(swarm.score);

  // 畫面：取捨表、五維對照，且顯示的就是上面的數字
  await expect(page.getByText("取捨對照表")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/牆鐘/).first()).toBeVisible();
  await expect(page.getByText("報告欄位完整度")).toBeVisible();
  await expect(page.getByText(/兩者一致性：分數差/)).toBeVisible();
  await expect(page.getByText("五維對照")).toBeVisible();
  const scoreRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "分數", exact: true }) });
  await expect(scoreRow).toContainText(String(swarm.score));
  await expect(scoreRow).toContainText(String(solo.score));
  for (const k of DIM_KEYS)
    await expect(
      page.getByText(`${swarm.dimensions[k]} vs ${solo.dimensions[k]}`).first(),
    ).toBeVisible();

  // 兩側卡片都在
  const cards = page.locator(".card.cut");
  await expect(cards.filter({ hasText: "蜂群" }).first()).toBeVisible();
  await expect(cards.filter({ hasText: "單體" }).first()).toBeVisible();

  await page.screenshot({ path: shotPath("24-compare-solo-vs-swarm.png"), fullPage: true });
});
