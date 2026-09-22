import { test, expect } from "@playwright/test";

/** 動態內容（隊長生成）需隨語系 cookie 變化 */
test("動態內容四語系：訪談回覆與互盤報告", async ({ page, context }) => {
  const base = "http://localhost:3100";

  const cases = [
    { lang: "zh", expect: /筆記/, forbid: /noted|记下来|メモ/ },
    { lang: "cn", expect: /——笔记。/, forbid: /筆記|noted|メモ/ },
    { lang: "en", expect: /noted/i, forbid: /筆記|记下来|メモ/ },
    { lang: "ja", expect: /メモしました/, forbid: /筆記|记下来|noted/i },
  ];

  for (const cs of cases) {
    await context.addCookies([
      { name: "sc_lang", value: cs.lang, url: base },
    ]);
    const uid = await page.request
      .post("/api/users", { data: { name: `T-${cs.lang}`, emoji: "🧪" } })
      .then((r) => r.json())
      .then((d) => d.id);
    await page.request.post("/api/session", { data: { userId: uid } });
    const res = await page.request
      .post("/api/onboarding/message", {
        data: { content: "TypeScript React 全程投入 想拿獎" },
      })
      .then((r) => r.json());
    expect(res.reply, `locale=${cs.lang} 應使用對應語言`).toMatch(cs.expect);
    expect(res.reply).not.toMatch(cs.forbid);
  }
});
