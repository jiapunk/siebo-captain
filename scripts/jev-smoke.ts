import "dotenv/config"; // 讀取 .env 的 JEV_API_KEY 等設定（已存在的環境變數優先，不會被覆寫）

/**
 * Jev 決策層煙霧測試（手動實打用；會讀 .env，已設定的環境變數優先）
 *   npx tsx scripts/jev-smoke.ts            # 用 .env 的 JEV_API_KEY（無 key → 規則層）
 *   npx tsx scripts/jev-smoke.ts --bad-key  # 故意用壞 key，驗證 fallback（未設 JEV_BASE_URL 時會真的打 Jev 拿 401）
 *   npx tsx scripts/jev-smoke.ts --report   # 另外跑一次完整報告合成
 * 輸出第一行附 jevBase=/llmBase=，讓呼叫端（tests/decision.spec.ts）確認這次是否指向本機黑洞、沒有連外。
 * 離線、可重現的逐情境驗證（逐題 fallback、覆蓋重試、斷路器、逾時）請用 scripts/verify-decision.ts。
 */
async function main() {
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
  if (process.argv.includes("--bad-key")) {
    process.env.JEV_API_KEY = "apikey_invalid_for_fallback";
    process.env.DECISION_PROVIDER = "auto";
  }

  const { decide, decisionChain } = await import("../src/lib/llm/decide");

  const questions = [
    {
      id: "goal_same",
      type: "choice" as const,
      instructions: "Do both people share the same hackathon goal?",
      criteria: { same: "Same goal", different: "Different goals" },
    },
    {
      id: "skill_fit",
      type: "score" as const,
      instructions:
        "How complementary are their skills for a hackathon team? Different roles cover each other.",
      criteria: ["None", "Weak", "Fair", "Good", "Ideal"],
    },
    {
      id: "full_time",
      type: "noul" as const,
      instructions: "Are both able to commit full-time for 48 hours?",
    },
  ];

  const state = {
    me: { role: "fullstack", skills: ["TypeScript", "React"], goal: "win", availability: "full-time" },
    them: { role: "design", skills: ["Figma", "UI/UX"], goal: "win", availability: "full-time" },
  };

  const t0 = Date.now();
  const res = await decide({
    state,
    questions,
    fallback: (q) =>
      q.type === "choice"
        ? { id: q.id, type: "choice", value: "same", confidence: 1, probabilities: {} }
        : q.type === "noul"
          ? { id: q.id, type: "noul", value: 0.9 }
          : { id: q.id, type: "score", value: 3, confidence: 1, probabilities: {} },
  });

  console.log("── decide() ──");
  console.log(
    `chain=[${decisionChain().join(">")}] source=${res.source} model=${res.model ?? "-"} note=${res.note ?? "-"} ms=${Date.now() - t0} inputTokens=${res.inputTokens ?? "-"} jevBase=${process.env.JEV_BASE_URL || "https://api.typesafe.ai/v1"} llmBase=${process.env.LLM_BASE_URL || "https://api.deepseek.com"}`,
  );
  console.log(JSON.stringify(res.answers, null, 2));

  if (process.argv.includes("--report")) {
    const { llm } = await import("../src/lib/llm");
    const me = (await import("../src/lib/personas")).DEMO_HACKER.profile;
    const them = (await import("../src/lib/personas")).HACK_PERSONAS[3].profile; // 霓霓（設計）
    const t1 = Date.now();
    const report = await llm.matchReport(me, them, "", "smoke-pair", undefined, "zh");
    console.log("── composed report ──");
    console.log(
      `score=${report.score} verdict=${report.verdict} ms=${Date.now() - t1}`,
    );
    console.log("summary:", report.summaryForUser.slice(0, 80));
    console.log("reasons:", report.reasons.slice(0, 2).join(" | ").slice(0, 120));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
