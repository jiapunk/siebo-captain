import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { LOCALES } from "../src/lib/i18n-dict";

/** 測試截圖／下載檔的統一輸出目錄（已被 .gitignore 的 test-results/ 涵蓋，不會弄髒 repo） */
export const SHOTS_DIR = join("test-results", "shots");

/**
 * 截圖路徑：shotPath("10-hack-landing.png") → "test-results/shots/10-hack-landing.png"
 * 用法：await page.screenshot({ path: shotPath("10-hack-landing.png") })
 * 受版控的 shots/ 是展示素材，測試一律不寫入。
 */
export function shotPath(name: string): string {
  return join(SHOTS_DIR, name);
}

/** repo 根目錄（spec 內 execSync 的 cwd） */
export const ROOT = resolve(__dirname, "..");

/**
 * 清掉上一支 spec 留下的互盤／隊伍／聯絡資料。
 * env 明確繼承 playwright.config.ts 寫進 process.env 的測試設定（DATABASE_URL=prisma/test-<port>.db），
 * reset-demo 本身也會拒絕碰 prisma/dev.db。
 */
export function resetDemo(): void {
  execSync("npx --no tsx prisma/reset-demo.ts", {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 不可達的本機位址：決策層子行程的所有外部端點都指到這裡 */
export const BLACKHOLE_URL = "http://127.0.0.1:9";

/**
 * 決策層子行程用的「最小且完全明確」的 env：不展開 process.env，
 * 所以開發者 shell 裡的 LLM/Jev 金鑰、DECISION_PROVIDER、base URL 都不會漏進來。
 * 金鑰設成空字串（而不是不設），scripts/jev-smoke.ts 的 dotenv 也不會用 .env 的值覆寫。
 */
export function hermeticDecisionEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const pick = (k: string) => (process.env[k] ? { [k]: process.env[k] as string } : {});
  return {
    ...pick("PATH"),
    ...pick("HOME"),
    ...pick("TMPDIR"),
    ...pick("SystemRoot"),
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "file:./test-hermetic.db",
    LLM_PROVIDER: "mock",
    LLM_API_KEY: "",
    LLM_BASE_URL: BLACKHOLE_URL,
    LLM_MODEL: "llm-offline",
    DECISION_PROVIDER: "auto",
    DECISION_FALLBACK: "auto",
    JEV_API_KEY: "",
    JEV_BASE_URL: BLACKHOLE_URL,
    JEV_MODEL: "jev-offline",
    JEV_TIMEOUT_MS: "3000",
    DECISION_LLM_TIMEOUT_MS: "3000",
    ...extra,
  };
}

/** 以名稱切換到某個示範身分（不走 UI；page.request 與頁面共用 cookie） */
export async function enterAsDemo(request: APIRequestContext, name: string): Promise<string> {
  const users = await request
    .get("/api/users")
    .then((r) => r.json() as Promise<{ users: { id: string; name: string }[] }>);
  const u = users.users.find((x) => x.name === name);
  expect(u, `示範名冊裡找不到 ${name}`).toBeTruthy();
  const res = await request.post("/api/session", { data: { userId: u!.id } });
  expect(res.status(), await res.text()).toBe(200);
  return u!.id;
}

export interface RunSummary {
  id: string;
  status: string;
  other: { name: string; emoji: string; isBot: boolean };
  myReport: { score: number } | null;
  parts: {
    expected: number;
    done: number;
    failed: number;
    pending: number;
    retries: number;
    /** 遠端失敗後改用本機腳本完成的 part 數（UI 的 LOCAL-FB） */
    fallbacks?: number;
    retainedPct: number | null;
  } | null;
  partRows: { id: string; kind: string; status: string; retries: number }[];
}

/** 以 API 派隊長出發，等所有 run 結束（mock 模式約 10 秒），回傳這一輪的 run */
export async function launchAndWait(
  request: APIRequestContext,
  body: Record<string, unknown> = {},
  timeoutMs = 90_000,
): Promise<RunSummary[]> {
  const res = await request.post("/api/matching/run", { data: body });
  expect(res.status(), await res.text()).toBe(200);
  const { runIds } = (await res.json()) as { runIds: string[] };
  expect(runIds.length).toBeGreaterThan(0);
  let mine: RunSummary[] = [];
  await expect
    .poll(
      async () => {
        const { runs } = (await request.get("/api/agent/runs").then((r) => r.json())) as {
          runs: RunSummary[];
        };
        mine = runs.filter((r) => runIds.includes(r.id));
        return mine.length === runIds.length && mine.every((r) => r.status !== "running");
      },
      { timeout: timeoutMs, intervals: [500, 1000] },
    )
    .toBe(true);
  return mine;
}

/** 頁面沒有水平捲動（手機寬度下的溢出檢查） */
export async function expectNoHorizontalScroll(page: Page, label = page.url()): Promise<void> {
  const dims = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(
    Math.max(dims.scroll, dims.body),
    `${label} 有水平捲動（scrollWidth ${dims.scroll}/${dims.body} > innerWidth ${dims.inner}）`,
  ).toBeLessThanOrEqual(dims.inner);
}

// ---------------- 語系殘留檢查（i18n-compare.spec／i18n-pages.spec 共用） ----------------
// 剔除規則：使用者輸入的自由文字（名字、簡介、技能、目標、投入時間、合作方式…）是資料、不翻譯；
// 系統的類別值（角色 fullstack/frontend/data…）有四語系顯示名（content.ts roleDisplay），不剔除、必須在地化。

/**
 * 繁體專用字（簡體寫法不同）：简中模式下 UI 出現任何一個就是繁中殘留。
 * 已核對：這些字都不出現在 i18n-dict 的 cn 字典裡；人名常用的滿／綠／飛／歐／吳刻意不列（人名另外剔除）。
 */
const TRAD_ONLY =
  "體對單隊長執報維數據與這個們會時間應開關點選擇資訊變讓說請認證網聯發現過還進運動優勢態雙邊義價質實際較準確結構績計論總費歷紀錄類處顯測試從來為東車門問題無專業習學覺視設語話讀寫聽難錯誤條規則標參備註項圍場層級狀連線斷獲評審員組織團賽環節階隱輸載儲檔刪編輯複製導覽頁觸樣預啟異號傳廣頻圖統協風譜興觀溝鐘遲積欄韌兩鈕盤揮擊離驗碼帳戶冊訪談達絡側麼嗎屬於後裡並將當衝夥臉詳細閱擁簡歸";
export const TRAD_RE = new RegExp(`[${TRAD_ONLY}]`, "gu");

/**
 * 簡體專用字（日文新字體不用這個寫法）：日本語模式下出現就是简中殘留。
 * 刻意排除日文也用的同形字（学号来当体会点数与双写条参状断制触属里将准）。
 */
const SIMP_ONLY =
  "这们个队长执报对单时间说请认证应开关选择资讯变让网联发现过还进运动优势态边义价质实际较确结构绩计论总费历纪录类处显测试从为东车门问题无专业习觉视设语话读听难错误规则标备项围场层级连线获评审员组织团赛环节阶隐输载储档删编辑复导览页样预启传广频图统协风谱兴观沟钟迟积栏韧两钮盘挥击离验码帐户册访谈达络侧么吗并冲伙脸详细阅拥简归";
export const SIMP_RE = new RegExp(`[${SIMP_ONLY}]`, "gu");

/**
 * 繁中專用、日文新字體不用的字（學→学、對→対、會→会、們／這／麼／嗎…）：日本語模式下出現就是繁中殘留。
 * 已核對：這些字都不出現在 i18n-dict 與 content.ts 的 ja 顯示文案（只有 canon 比對關鍵字「拿獎／邊做」，不會顯示）。
 * 日文也用的同形字（資料、全、端、隊、長…）刻意不列；角色等類別值的日文化由 EN 檢查兜底。
 */
const TRAD_NOT_JA =
  "產學獎體對會數與點單發變讓應關擇經驗實價據處顯從來專覺讀寫聽條參圍狀斷團隱覽觸樣號傳廣圖觀遲兩擊屬將當歸雙邊總歷錄們這麼嗎裡啟檔儲夥臉鈕碼說內";
/** 日本語模式禁用字：簡體專用字 ∪ 日文不用的繁體字 */
export const JA_FORBID_RE = new RegExp(`[${SIMP_ONLY}${TRAD_NOT_JA}]`, "gu");

/** 漢字、假名與全形標點（EN 模式下都不該出現在 UI 上） */
export const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff01-\uff60]/gu;

/** 平假名／片假名（日本語模式應該有） */
export const KANA_RE = /[\u3040-\u30ff]/u;

/** 取頁面文字並剔除「資料」：使用者名稱與其他使用者輸入、語系切換鈕的原生語言名稱 */
export async function uiText(page: Page, data: string[]): Promise<string> {
  let text = await page.locator("body").innerText();
  const strip = [...data, ...LOCALES.map((l) => l.label)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const s of strip) text = text.split(s).join(" ");
  return text;
}

/** 列出命中的字與前後文，失敗訊息直接指出殘留在哪 */
export function offenders(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    out.push(`「${m[0]}」…${text.slice(Math.max(0, i - 8), i + 8).replace(/\s+/g, " ")}…`);
    if (out.length >= 15) break;
  }
  return out;
}
