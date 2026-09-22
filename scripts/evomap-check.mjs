#!/usr/bin/env node
/**
 * EvoMap bundle 自我檢查（作為 Gene/Capsule 的 validation 指令）：
 * 驗證 canonical JSON 與 sha256 內容定址可重現。
 * 用法：node scripts/evomap-check.mjs
 */
import { createHash } from "node:crypto";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

const sample = {
  type: "Gene",
  schema_version: "1.5.0",
  category: "innovate",
  signals_match: ["hackathon_teaming"],
  summary: "canonical-json self check",
  validation: ["node scripts/evomap-check.mjs"],
};
const id = `sha256:${createHash("sha256").update(canonicalJson(sample), "utf8").digest("hex")}`;

// 鍵順序不影響結果（canonical：所有層級排序）
const reordered = {
  validation: sample.validation,
  summary: sample.summary,
  signals_match: sample.signals_match,
  category: sample.category,
  schema_version: sample.schema_version,
  type: sample.type,
};
const id2 = `sha256:${createHash("sha256").update(canonicalJson(reordered), "utf8").digest("hex")}`;
if (id !== id2) {
  console.error("FAIL: canonical JSON is not order-independent");
  process.exit(1);
}
if (!/^sha256:[a-f0-9]{64}$/.test(id)) {
  console.error("FAIL: asset id format invalid");
  process.exit(1);
}
console.log(`OK canonical asset id ${id.slice(0, 23)}…`);
