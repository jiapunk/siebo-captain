import { test, expect, type APIRequestContext } from "@playwright/test";
import { resetDemo, type RunSummary } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

async function myRuns(request: APIRequestContext): Promise<RunSummary[]> {
  const { runs } = (await request.get("/api/agent/runs").then((r) => r.json())) as {
    runs: RunSummary[];
  };
  return runs;
}

/**
 * P0+P1 蜂群驗證：
 * - 每個互盤 run 都完整覆蓋 6 個 parts、0 失敗、0 重試（逐 run 檢查，不是只看第一個）
 * - 隊伍提案由「假設枚舉 → 隔離評估 → 程序匯合」產生：2–3 隊、每隊 3 人含我、隊友互不重疊
 */
test("蜂群 Part 覆蓋 + 假設評估式組隊", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(page.getByRole("button", { name: /產生隊伍提案/ })).toBeVisible({
    timeout: 60_000,
  });

  // P0：API 逐 run 檢查
  const runs = await myRuns(page.request);
  expect(runs.length).toBeGreaterThanOrEqual(2);
  for (const r of runs) {
    expect(r.status, `run ${r.id}`).toBe("completed");
    expect(r.parts, `run ${r.id} parts`).toMatchObject({
      expected: 6,
      done: 6,
      failed: 0,
      pending: 0,
      retries: 0,
    });
    expect(r.partRows.map((p) => p.status)).toEqual(Array(6).fill("done"));
    expect(r.myReport?.score).toBeGreaterThanOrEqual(0);
    expect(r.myReport?.score).toBeLessThanOrEqual(100);
  }
  // UI：每個 run 卡都顯示 PARTS 6/6 與 RETAIN（百分比或 slot 數）；正常出發沒有任何非 0 的 RETRY
  await expect(page.getByText(/PARTS 6\/6/)).toHaveCount(runs.length);
  await expect(page.getByText(/^RETAIN \d+(%|\/\d+)$/)).toHaveCount(runs.length);
  await expect(page.getByText(/RETRY [1-9]/)).toHaveCount(0);

  // 產出隊伍（P1）
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");
  await expect(page.getByText(/HYPOTHESES \d+/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("候選隊伍").first()).toBeVisible();
  // 匯合訊息：每隊都有 evidence 行
  await expect(page.getByText(/覆蓋 \d+/).first()).toBeVisible();

  // API：2–3 隊、每隊 3 人含我、隊友集合兩兩不相交
  const { teams, swarm } = (await page.request.get("/api/teams").then((r) => r.json())) as {
    teams: { id: string; status: string; members: { userId: string; isMe: boolean }[] }[];
    swarm: { hypotheses: number; selected: number; failed: number };
  };
  const proposals = teams.filter((t) => t.status === "proposed");
  expect(proposals.length).toBeGreaterThanOrEqual(2);
  expect(proposals.length).toBeLessThanOrEqual(3);
  expect(swarm.hypotheses).toBeGreaterThanOrEqual(proposals.length);
  expect(swarm.failed).toBe(0);
  const mates = proposals.map((t) => {
    expect(t.members).toHaveLength(3);
    expect(t.members.filter((m) => m.isMe)).toHaveLength(1);
    return t.members.filter((m) => !m.isMe).map((m) => m.userId);
  });
  const all = mates.flat();
  expect(new Set(all).size, `隊友重疊：${JSON.stringify(mates)}`).toBe(all.length);
});

/**
 * 故障演練：勾選後出發，每個 run 的提問 Part（a:<runId>:A）第一次嘗試強制失敗 →
 * 自動重試一次接力成功：run 顯示 RETRY 1、蜂群面板該 Part 標 R1，其餘 Part 不受影響。
 */
test("故障演練：Part 首次失敗 → R1 重試接力，run 仍完整 6/6", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  const before = new Set((await myRuns(page.request)).map((r) => r.id));

  const fault = page.getByRole("checkbox", { name: /故障演練/ });
  await fault.check();
  await expect(fault).toBeChecked();
  const launched = page.waitForResponse(
    (r) => r.url().endsWith("/api/matching/run") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /隊長出發/ }).click();
  const launchRes = await launched;
  expect(launchRes.request().postDataJSON()).toMatchObject({ faultInject: true });
  expect(launchRes.status()).toBe(200);
  const { runIds } = (await launchRes.json()) as { runIds: string[] };
  expect(runIds.length).toBeGreaterThan(0);
  // 注意：上一個測試的 run 已夠組隊，「產生隊伍提案」可能在新 run 結束前就可見 → 以 API 狀態為準
  // API：這一輪每個 run 都恰好 1 次重試，且就是被注入故障的 a:<runId>:A
  let runs: RunSummary[] = [];
  await expect
    .poll(
      async () => {
        runs = (await myRuns(page.request)).filter((r) => runIds.includes(r.id));
        return runs.length === runIds.length && runs.every((r) => r.status === "completed");
      },
      { timeout: 90_000, intervals: [500, 1000] },
    )
    .toBe(true);
  for (const r of runs) {
    expect(before.has(r.id)).toBe(false);
    expect(r.parts, `run ${r.id}`).toMatchObject({ expected: 6, done: 6, failed: 0, retries: 1 });
    const faulted = r.partRows.find((p) => p.id === `a:${r.id}:A`);
    expect(faulted, `run ${r.id} 找不到 a:<runId>:A`).toBeTruthy();
    expect(faulted!.status).toBe("done");
    expect(faulted!.retries).toBe(1);
    expect(r.partRows.filter((p) => p.id !== `a:${r.id}:A`).every((p) => p.retries === 0)).toBe(true);
  }

  // UI：run 卡顯示 RETRY 1；蜂群即時面板的該 Part 標 R1
  await expect(page.getByText(/^RETRY 1$/)).toHaveCount(runs.length, { timeout: 20_000 });
  await expect(page.getByText(/·\s*R1\b/).first()).toBeVisible({ timeout: 15_000 });
});
