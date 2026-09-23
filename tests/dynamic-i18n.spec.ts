import { test, expect } from "@playwright/test";

/**
 * 動態內容（隊長訪談回覆）需隨語系 cookie 變化。
 * 互盤報告與 /compare 頁的語系檢查在 i18n-content.spec.ts（EN 逐字稿）與 i18n-compare.spec.ts（简中／EN）。
 * 每個語系建一個臨時示範身分（沒有 email／密碼），測完用 DELETE /api/me 刪掉，不留在活動名單裡。
 */
test("動態內容四語系：隊長訪談回覆隨語系切換", async ({ page, context, baseURL }) => {
  expect(baseURL, "playwright.config.ts 應提供 baseURL").toBeTruthy();

  const cases = [
    { lang: "zh", expect: /筆記/, forbid: /noted|记下来|メモ/ },
    { lang: "cn", expect: /——笔记。/, forbid: /筆記|noted|メモ/ },
    { lang: "en", expect: /noted/i, forbid: /筆記|记下来|メモ/ },
    { lang: "ja", expect: /メモしました/, forbid: /筆記|记下来|noted/i },
  ];

  const created: string[] = [];
  try {
    for (const cs of cases) {
      await context.addCookies([{ name: "sc_lang", value: cs.lang, url: baseURL! }]);
      const made = await page.request.post("/api/users", {
        data: { name: `T-${cs.lang}`, emoji: "🧪" },
      });
      expect(made.status(), await made.text()).toBe(200);
      const uid = ((await made.json()) as { id: string }).id;
      created.push(uid);
      const sw = await page.request.post("/api/session", { data: { userId: uid } });
      expect(sw.status(), await sw.text()).toBe(200);

      // 新訪談的第一輪要帶隱私告知同意（consent: true）
      const res = await page.request.post("/api/onboarding/message", {
        data: { content: "TypeScript React 全程投入 想拿獎", consent: true },
      });
      expect(res.status(), await res.text()).toBe(200);
      const { reply } = (await res.json()) as { reply: string };
      expect(reply, `locale=${cs.lang} 應使用對應語言`).toMatch(cs.expect);
      expect(reply).not.toMatch(cs.forbid);
    }
  } finally {
    // 清掉臨時身分：切到該身分後自刪（示範身分可刪、種子角色不可刪）
    for (const uid of created) {
      await page.request.post("/api/session", { data: { userId: uid } });
      const del = await page.request.delete("/api/me");
      expect(del.status(), `刪除臨時身分 ${uid}`).toBe(200);
    }
  }
});
