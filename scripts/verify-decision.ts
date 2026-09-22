/**
 * 決策層驗證：mock / Jev 壞 key fallback / Jev 實打
 * 執行：npx tsx scripts/verify-decision.ts
 */
import { decide, type DecideAnswer, type DecideQuestion } from "../src/lib/llm/decide";

const questions: DecideQuestion[] = [
  {
    id: "goal_diff",
    type: "noul",
    instructions: "The two participants' hackathon goals are clearly different.",
  },
  {
    id: "urgency",
    type: "score",
    instructions: "How urgent is the teammate search?",
    criteria: ["Not urgent", "This month", "This week", "Today"],
  },
];

const fallback = (q: DecideQuestion): DecideAnswer =>
  q.type === "noul"
    ? { id: q.id, type: "noul", value: 0.5 }
    : { id: q.id, type: "score", value: 1, confidence: 0.5, probabilities: {} };

const state =
  "小滿是前端，目標學習新東西，全程投入；我是全端工程師，目標拿獎，想在兩週內找到隊友。";

async function main() {
  // 1) mock provider
  const r1 = await decide({ state, questions, fallback, provider: "mock" });
  console.log("① mock:", r1.source, r1.answers.map((a) => `${a.id}=${a.type === "noul" ? a.value : a.type === "score" ? a.value : a.value}`).join(", "));
  if (r1.source !== "mock") throw new Error("mock provider failed");

  // 2) Jev 壞 key → 必須 fallback
  process.env.JEV_API_KEY = "apikey_invalid_for_fallback_test";
  process.env.DECISION_PROVIDER = "jev";
  process.env.JEV_TIMEOUT_MS = "3000";
  const r2 = await decide({ state, questions, fallback });
  console.log("② bad-key fallback:", r2.source, "note:", r2.note?.slice(0, 60));
  if (r2.source !== "mock" || !r2.note) throw new Error("fallback failed");

  // 3) 真 key（若提供 JEV_REAL_KEY）
  const realKey = process.env.JEV_REAL_KEY;
  if (realKey) {
    process.env.JEV_API_KEY = realKey;
    const r3 = await decide({ state, questions, fallback });
    console.log("③ real jev:", r3.source, "model:", r3.model, "tokens:", r3.inputTokens);
    console.log("   answers:", JSON.stringify(r3.answers, null, 2).slice(0, 600));
    if (r3.source !== "jev") throw new Error("real jev failed");
  } else {
    console.log("③ real jev: skipped（未提供 JEV_REAL_KEY）");
  }
  console.log("✅ verify-decision 全部通過");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
