// @ts-check
import { defineConfig } from "@playwright/test";

/**
 * E2E 測試完全隔離：
 * - 獨立 port（E2E_PORT，預設 3100）與獨立 distDir（.next-test-<port>）
 * - 獨立資料庫 prisma/test-<port>.db（globalSetup 會 migrate deploy + seed），絕不碰 demo 用的 prisma/dev.db
 * - 全部 mock：LLM / 決策層 / GitHub / EvoMap；外部端點指向黑洞 127.0.0.1:9，就算誤設 key 也打不出去
 * 頂層 process.env 的設定會被 spec 裡 execSync({ env: { ...process.env } }) 的子程序繼承
 * （例如 prisma/reset-demo.ts、scripts/jev-smoke.ts），所以它們也連到測試 DB、不會外連。
 */
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://localhost:${port}`;

const testEnv: Record<string, string> = {
  DATABASE_URL: `file:./test-${port}.db`,
  NEXT_DIST_DIR: `.next-test-${port}`,
  LLM_PROVIDER: "mock",
  LLM_API_KEY: "",
  LLM_BASE_URL: "http://127.0.0.1:9",
  DECISION_PROVIDER: "mock",
  JEV_API_KEY: "",
  JEV_BASE_URL: "http://127.0.0.1:9",
  GITHUB_VERIFY: "mock",
  GITHUB_TOKEN: "",
  EVOMAP_ENABLED: "0",
  AUTH_DEV_LINKS: "on",
  AUTH_DEV_RESET_LINKS: "on",
  DEMO_SWITCH: "on",
  // 活動固定用種子預設值，測試不受開發者 .env 影響
  EVENT_NAME: "EvoTavern",
  EVENT_CODE: "EVOTAVERN",
  EVENT_STARTS_AT: "2026-09-21T09:00:00+08:00",
  EVENT_ENDS_AT: "2026-09-24T23:59:59+08:00",
};

// 讓 runner、worker 與 spec 內 execSync 的子程序都拿到同一組設定（.env 不會覆寫已存在的變數）
Object.assign(process.env, testEnv, { E2E_PORT: String(port), E2E_BASE_URL: baseURL });

export default defineConfig({
  testDir: "./tests",
  // 只收 Playwright spec；tests/unit/*.test.ts 由 npm run test:unit（node:test）執行
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/global-setup.ts",
  // next dev 會把 .next-test-<port>/types 自動加進 tsconfig.json 的 include，跑完還原，工作區保持乾淨
  globalTeardown: "./tests/global-teardown.ts",
  outputDir: "test-results/artifacts",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    // 測試固定繁中（避免瀏覽器 en-US 觸發自動語系切換）
    storageState: {
      cookies: [
        {
          name: "sc_lang",
          value: "zh",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: testEnv,
  },
});
