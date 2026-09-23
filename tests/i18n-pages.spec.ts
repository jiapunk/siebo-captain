import { test, expect, type Page } from "@playwright/test";
import { DICTS, type Locale } from "../src/lib/i18n-dict";
import { DEMO_HACKER, HACK_PERSONAS } from "../src/lib/personas";
import {
  CJK_RE,
  enterAsDemo,
  JA_FORBID_RE,
  KANA_RE,
  launchAndWait,
  offenders,
  resetDemo,
  shotPath,
  TRAD_RE,
  uiText,
} from "./helpers";

/**
 * /agent（含展開的逐字稿與互盤報告）、/teams（含 SIGNAL SIMULATION 網絡面板）、/people 的語系殘留檢查：
 *   简中 → 不得有繁體專用字；EN → 不得有任何中日文；日本語 → 不得有簡體專用字與日文不用的繁體字、且要有假名。
 * 每個語系用不同的示範身分，在該語系下出發＋組隊（逐字稿、報告、隊伍理由都在該語系產生），
 * 也避開同一身分的出發節流（每人 10 次／10 分鐘，其他 spec 大量使用 Demo阿飛）。
 * 剔除的「資料」只有種子檔案裡使用者自己填的自由文字（見 helpers.ts 的剔除規則）：
 *   - 名字、暱稱、簡介、技能、地雷…
 *   - goal／availability／workingStyle：/profile 上是可自由編輯的文字欄，逐字稿（mock 模板
 *     "Goal: “{goal}”; availability: {availability}"）與隊伍理由（"Goals differ ({goals})"）是「引用」原文
 * 角色不剔除：它是有四語系顯示名的類別值（roleDisplay），在 /teams、/people 的角色標籤也必須在地化。
 */

const CASES: { lang: Locale; who: string; re: RegExp; what: string }[] = [
  { lang: "cn", who: "小滿", re: TRAD_RE, what: "繁中殘留" },
  { lang: "en", who: "阿哲", re: CJK_RE, what: "中日文殘留" },
  { lang: "ja", who: "Kiwi", re: JA_FORBID_RE, what: "简中／繁中殘留" },
];

/** 種子檔案裡的自由文字（使用者輸入，不翻譯） */
const PERSONA_DATA: string[] = [...HACK_PERSONAS, DEMO_HACKER].flatMap((p) => [
  p.name,
  p.tagline,
  p.profile.nickname,
  p.profile.vibe,
  p.profile.bio,
  ...p.profile.skills,
  ...p.profile.dealbreakers,
]);

/** 被引用的檔案原文（目標／投入時間／合作方式，見檔頭說明） */
const QUOTED_PROFILE: string[] = [...HACK_PERSONAS, DEMO_HACKER].flatMap((p) => [
  p.profile.goal,
  p.profile.availability,
  p.profile.workingStyle,
]);

async function check(
  page: Page,
  lang: Locale,
  re: RegExp,
  what: string,
  path: string,
  shot: string,
) {
  const text = await uiText(page, [...PERSONA_DATA, ...QUOTED_PROFILE]);
  await page.screenshot({ path: shotPath(shot), fullPage: true });
  const hits = offenders(text, re);
  // soft：一頁有殘留仍繼續驗後面的頁，一次列出全部殘留
  expect.soft(hits, `${lang} ${path} 有${what}：\n${hits.join("\n")}`).toEqual([]);
  if (lang === "ja") expect.soft(text, `ja ${path} 應有日文 UI（假名）`).toMatch(KANA_RE);
}

// 每個語系各自從乾淨的種子開始：/agent 會列出「對方發起、我是 B 方」的 run，
// 共用一份資料時後面的語系會看到前面語系的 run（數量對不上），且結果會隨 worker 是否重啟而不同
test.beforeEach(() => {
  resetDemo();
});

for (const cs of CASES) {
  test(`${cs.lang}：/agent、/teams、/people 沒有${cs.what}`, async ({ page, context, baseURL }) => {
    const dict = DICTS[cs.lang];
    await context.addCookies([{ name: "sc_lang", value: cs.lang, url: baseURL! }]);
    await enterAsDemo(page.request, cs.who);
    // 在這個語系下出發 + 組隊：逐字稿、報告、隊伍理由都以該語系產生
    const runs = await launchAndWait(page.request);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
    const asm = await page.request.post("/api/teams/assemble");
    expect(asm.status(), await asm.text()).toBe(200);

    // ---- /agent：run 列表 + 展開第一場（逐字稿與雙方報告）----
    await page.goto("/agent");
    await expect(page.getByText(/^PARTS 6\/6$/)).toHaveCount(runs.length, { timeout: 15_000 });
    // 導覽列是該語系（桌面／手機兩份導覽只會顯示一份，所以只驗存在）
    await expect(page.getByText(dict["nav.compare"], { exact: true }).first()).toBeAttached();
    const toggle = page.locator("main button[aria-expanded]").first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // 完成事件（▣）出現＝逐字稿與雙方報告都已經載入
    await expect(page.locator("main").getByText(/^▣ /).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(dict["rs.yourCaptain"], { exact: true }).first()).toBeVisible();
    await check(page, cs.lang, cs.re, cs.what, "/agent", `32-agent-${cs.lang}.png`);

    // ---- /teams：隊伍提案 + 網絡面板（SIGNAL SIMULATION 在組隊後才有）----
    await page.goto("/teams");
    await expect(page.getByText(/HYPOTHESES \d+/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/SIGNAL SIMULATION/)).toBeVisible({ timeout: 20_000 });
    await check(page, cs.lang, cs.re, cs.what, "/teams", `33-teams-${cs.lang}.png`);

    // ---- /people：破冰雷達 ----
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(dict["radar.title"]);
    await expect(page.getByText(/^TGT-01$/)).toBeVisible({ timeout: 15_000 });
    await check(page, cs.lang, cs.re, cs.what, "/people", `34-people-${cs.lang}.png`);
  });
}
