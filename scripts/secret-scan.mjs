// 機密掃描：拿本機 .env* 裡的「全部」機密值，逐一比對會進版控的檔案與整個 git 歷史
//   npm run secret-scan                         # 預設掃 repo 根目錄所有 .env*（.env.example 除外，例如 .env、.env.live）
//   npm run secret-scan -- --env .env.live      # 只掃指定的 env 檔（可重複）
//
// - 比對範圍
//   1. 工作樹：git ls-files --cached --others --exclude-standard（已追蹤＋未被忽略的新檔，也就是 git add -A 會收進去的）
//   2. git 歷史：git rev-list --all --objects 的每個物件原文（每個版本的 blob，含二進位檔、commit 訊息、tree）
// - 全值比對（位元組子字串），值只留在記憶體；輸出只有「檔名:變數名 → 命中數」，不印值、不印長度、不印前綴
// - 變數名含 KEY／SECRET／TOKEN／PASSWORD／PRIVATE／CREDENTIAL／COOKIE，或值是帶帳密的 URL，視為機密：
//   命中即失敗（exit 1）。其他設定值（模型名、活動名…）只列參考命中數，不影響結果
// - 追蹤中的 .env* 除了 .env.example 以外一律視為失敗
// - 太短的值（< 8 字元）不掃：比對沒有意義，會列為略過
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIN_LEN = 8;
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|COOKIE/i;
const URL_WITH_CREDENTIALS = /:\/\/[^/\s:@]+:[^@\s]+@/;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 });
}

function envFiles() {
  const picked = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env") {
      if (!argv[i + 1]) fail("--env 後面要接檔案路徑");
      picked.push(resolve(process.cwd(), argv[++i]));
    } else fail(`不認得的參數：${argv[i]}`);
  }
  if (picked.length) {
    for (const f of picked) if (!existsSync(f)) fail(`找不到 env 檔：${f}`);
    return picked;
  }
  return readdirSync(ROOT)
    .filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example")
    .sort()
    .map((f) => resolve(ROOT, f));
}

function fail(msg) {
  console.error(`[secret-scan] ✗ ${msg}`);
  process.exit(2);
}

/** 工作樹：已追蹤＋未被忽略的新檔（符號連結略過） */
function scanWorktree(targets) {
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const hits = new Map(targets.map((t) => [t.value, 0]));
  let scanned = 0;
  for (const rel of files) {
    const abs = resolve(ROOT, rel);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // 已刪除但還在 index 的檔案
    }
    if (!st.isFile()) continue;
    const buf = readFileSync(abs);
    scanned++;
    for (const t of targets) if (buf.includes(t.bytes)) hits.set(t.value, hits.get(t.value) + 1);
  }
  return { scanned, hits };
}

/** git 歷史：所有 ref 可達的每個物件，用 cat-file --batch 串流讀原文 */
function scanHistory(targets) {
  const shas = [
    ...new Set(
      git(["rev-list", "--all", "--objects"])
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0]),
    ),
  ];
  const commits = Number(git(["rev-list", "--all", "--count"]).toString("utf8").trim());
  const hits = new Map(targets.map((t) => [t.value, 0]));
  let objects = 0;
  return new Promise((done, reject) => {
    const p = spawn("git", ["cat-file", "--batch"], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
    let head = Buffer.alloc(0); // 還沒讀完的 header 行
    let body = null; // { size, chunks, len }：正在讀的物件內容（後面多一個換行）
    const onObject = (buf) => {
      objects++;
      for (const t of targets) if (buf.includes(t.bytes)) hits.set(t.value, hits.get(t.value) + 1);
    };
    p.stdout.on("data", (chunk) => {
      let c = chunk;
      while (c.length) {
        if (!body) {
          const nl = c.indexOf(10);
          if (nl === -1) {
            head = Buffer.concat([head, c]);
            return;
          }
          const line = Buffer.concat([head, c.subarray(0, nl)]).toString("utf8");
          head = Buffer.alloc(0);
          c = c.subarray(nl + 1);
          const [, type, size] = line.split(" ");
          if (type === "missing" || size === undefined) continue;
          body = { size: Number(size), chunks: [], len: 0 };
        }
        const take = c.subarray(0, body.size + 1 - body.len);
        body.chunks.push(take);
        body.len += take.length;
        c = c.subarray(take.length);
        if (body.len === body.size + 1) {
          onObject(Buffer.concat(body.chunks).subarray(0, body.size));
          body = null;
        }
      }
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? done({ commits, objects, hits }) : reject(new Error(`git cat-file 結束碼 ${code}`)),
    );
    p.stdin.end(shas.join("\n") + "\n");
  });
}

async function main() {
  const files = envFiles();
  if (!files.length) fail("repo 根目錄沒有 .env*（.env.example 除外）可掃；用 --env 指定");

  // 每個 env 檔的每個變數；相同的值只比對一次
  const rows = [];
  const targets = new Map();
  for (const f of files) {
    const vars = dotenv.parse(readFileSync(f));
    for (const [name, raw] of Object.entries(vars)) {
      const value = raw.trim();
      const secret = SECRET_NAME.test(name) || URL_WITH_CREDENTIALS.test(value);
      const row = { file: basename(f), name, value, secret, skipped: null };
      if (!value) row.skipped = "空值";
      else if (value.length < MIN_LEN) row.skipped = `少於 ${MIN_LEN} 字元`;
      else if (!targets.has(value)) targets.set(value, { value, bytes: Buffer.from(value, "utf8") });
      rows.push(row);
    }
  }
  const list = [...targets.values()];

  const wt = scanWorktree(list);
  const hist = await scanHistory(list);
  const trackedEnv = git(["ls-files", "-z"])
    .toString("utf8")
    .split("\0")
    .filter((p) => /(^|\/)\.env(\..+)?$/.test(p));
  const badEnv = trackedEnv.filter((p) => basename(p) !== ".env.example");

  console.log(`[secret-scan] env 檔：${files.map((f) => basename(f)).join("、")}`);
  console.log(
    `[secret-scan] 範圍：工作樹 ${wt.scanned} 個檔（已追蹤＋未忽略的新檔）；` +
      `git 歷史 ${hist.commits} 個 commit、${hist.objects} 個物件（--all，含二進位 blob 與 commit 訊息）`,
  );
  let current = "";
  for (const r of rows) {
    if (r.file !== current) console.log(`## ${(current = r.file)}`);
    const tag = r.secret ? "機密" : "設定";
    if (r.skipped) {
      console.log(`  ${r.name}（${tag}）：略過（${r.skipped}）`);
      continue;
    }
    const w = wt.hits.get(r.value);
    const h = hist.hits.get(r.value);
    console.log(
      `  ${r.name}（${tag}）：工作樹 ${w}、歷史 ${h}` + (r.secret ? (w + h ? "  ✗" : "") : "  （設定值，僅供參考）"),
    );
  }
  console.log(`[secret-scan] 追蹤中的 .env*：${trackedEnv.join(", ") || "（無）"}`);

  const scannedSecrets = rows.filter((r) => r.secret && !r.skipped);
  const leaked = scannedSecrets.filter((r) => wt.hits.get(r.value) + hist.hits.get(r.value) > 0);
  const summary = [...new Set(scannedSecrets.map((r) => `${r.file}:${r.name}`))];
  if (!summary.length)
    console.warn("[secret-scan] ⚠ 沒有任何可掃的機密值（env 檔的機密都是空值？）——這次結果不代表任何保證");
  if (leaked.length || badEnv.length) {
    if (leaked.length) console.error(`[secret-scan] ✗ 機密值命中：${leaked.map((r) => `${r.file}:${r.name}`).join(", ")}`);
    if (badEnv.length) console.error(`[secret-scan] ✗ 追蹤了不該進版控的 env 檔：${badEnv.join(", ")}`);
    process.exit(1);
  }
  console.log(`[secret-scan] ✓ 機密值 ${summary.length} 個（${summary.join("、") || "無"}）：工作樹與 git 歷史命中 0`);
}

main().catch((e) => {
  console.error(`[secret-scan] ✗ ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
