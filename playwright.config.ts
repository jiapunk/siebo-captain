// @ts-check
import { defineConfig } from "@playwright/test";

// 測試固定使用 mock 模式 + 獨立 port（3100），不干擾開發中的 real LLM server
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
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
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LLM_PROVIDER: "mock",
      LLM_API_KEY: "",
      GITHUB_VERIFY: "mock",
      JEV_API_KEY: "",
      EVOMAP_ENABLED: "0",
      DECISION_PROVIDER: "mock",
      NEXT_DIST_DIR: ".next-test",
    },
  },
});
