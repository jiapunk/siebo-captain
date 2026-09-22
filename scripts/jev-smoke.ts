/**
 * Jev 決策層煙霧測試
 *   npx tsx scripts/jev-smoke.ts            # 用 .env 的 JEV_API_KEY（無 key → 規則層）
 *   npx tsx scripts/jev-smoke.ts --bad-key  # 故意用壞 key，驗證 fallback
 *   npx tsx scripts/jev-smoke.ts --report   # 另外跑一次完整報告合成
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
    `chain=[${decisionChain().join(">")}] source=${res.source} model=${res.model ?? "-"} note=${res.note ?? "-"} ms=${Date.now() - t0} inputTokens=${res.inputTokens ?? "-"}`,
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
