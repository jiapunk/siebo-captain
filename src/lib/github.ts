/**
 * GitHub 技能驗證：防「人人都說自己會」——用公開數據交叉檢查技能主張。
 * 注意：這只比對「該 GitHub 帳號的公開資料」，不證明帳號屬於填寫者（ownershipVerified 永遠是 false）。
 */

export interface GithubVerification {
  username: string;
  verifiedAt: string;
  source: "github-api" | "mock";
  publicRepos: number;
  accountAgeYears: number;
  topLanguages: { lang: string; count: number }[];
  matchedSkills: string[];
  unmatchedSkills: string[];
  unverifiableSkills: string[];
  note: string;
  /** 只比對公開資料，不證明帳號所有權（UI 應標註）；舊資料沒有此欄位時也視為 false */
  ownershipVerified?: false;
}

export type GithubVerifyErrorCode = "not_found" | "rate_limited" | "fetch_failed";

export class GithubVerifyError extends Error {
  code: GithubVerifyErrorCode;
  /** rate_limited 時建議的重試秒數（取自 Retry-After / X-RateLimit-Reset） */
  retryAfterSec?: number;
  constructor(code: GithubVerifyErrorCode, retryAfterSec?: number) {
    super(code);
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * 正規化使用者輸入的帳號名：去掉前後空白、開頭 @、https://github.com/ 前綴與結尾 /。
 * 格式不合法（GitHub 規則：1-39 字元英數與 -）回 null。
 */
export function normalizeGithubUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const clean = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  return /^[a-zA-Z0-9-]{1,39}$/.test(clean) ? clean : null;
}

// 技能 → GitHub 主要語言的對應（無法對應者列為「無法由此驗證」）
const SKILL_TO_LANGS: Array<[RegExp, string[]]> = [
  [/react|next|vue|typescript|javascript|tailwind|vite|node/i, ["TypeScript", "JavaScript"]],
  [/python|fastapi|django|pytorch|pandas|\bdata\b|資料/i, ["Python", "Jupyter Notebook"]],
  [/flutter|dart/i, ["Dart"]],
  [/swift/i, ["Swift"]],
  [/kotlin/i, ["Kotlin"]],
  [/rust/i, ["Rust"]],
  [/go\b|golang/i, ["Go"]],
  [/solidity|web3/i, ["Solidity"]],
  [/llm|agent|prompt|\bai\b/i, ["Python", "TypeScript", "JavaScript", "Jupyter Notebook"]],
  [/c\+\+|c#|unity/i, ["C++", "C#"]],
];

export function skillToLangs(skill: string): string[] {
  for (const [re, langs] of SKILL_TO_LANGS) if (re.test(skill)) return langs;
  return [];
}

/** 語言統計：只算使用者自己的 repo（排除 fork，避免 fork 熱門專案灌水） */
function langCounts(
  repos: { language: string | null; fork?: boolean }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (r.fork || !r.language) continue;
    counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  return counts;
}

function buildVerdict(
  skills: string[],
  counts: Map<string, number>,
  base: Omit<GithubVerification, "matchedSkills" | "unmatchedSkills" | "unverifiableSkills" | "note" | "topLanguages">,
): GithubVerification {
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => ({ lang, count }));

  const matchedSkills: string[] = [];
  const unmatchedSkills: string[] = [];
  const unverifiableSkills: string[] = [];
  const topLangs = new Set(top.slice(0, 3).map((t) => t.lang));

  for (const s of skills) {
    const langs = skillToLangs(s);
    if (langs.length === 0) {
      unverifiableSkills.push(s);
      continue;
    }
    if (langs.some((l) => topLangs.has(l))) matchedSkills.push(s);
    else unmatchedSkills.push(s);
  }

  const noteParts: string[] = [];
  noteParts.push(
    base.publicRepos > 0
      ? `GitHub 上有 ${base.publicRepos} 個公開專案，主要語言：${
          top.map((t) => `${t.lang}（${t.count}）`).join("、") || "未標註"
        }。`
      : "GitHub 上沒有公開專案。",
  );
  if (matchedSkills.length)
    noteParts.push(`技能主張相符：${matchedSkills.slice(0, 4).join("、")}。`);
  if (unmatchedSkills.length)
    noteParts.push(
      `在主要語言中找不到對應：${unmatchedSkills.slice(0, 4).join("、")}——建議面談時確認。`,
    );
  if (unverifiableSkills.length)
    noteParts.push(
      `${unverifiableSkills.slice(0, 4).join("、")} 無法由 GitHub 驗證（非程式語言技能）。`,
    );

  return {
    ...base,
    topLanguages: top,
    matchedSkills,
    unmatchedSkills,
    unverifiableSkills,
    note: noteParts.join(""),
    ownershipVerified: false,
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 測試/離線環境的確定性驗證結果（GITHUB_VERIFY=mock；Playwright 設定會開啟） */
function mockVerify(username: string, skills: string[]): GithubVerification {
  const h = hashStr(username.toLowerCase());
  const repos = 4 + (h % 30);
  const counts = new Map<string, number>();
  // 讓可對應的技能都出現在 top languages，模擬「驗證通過」的正常情境
  for (const s of skills) {
    for (const lang of skillToLangs(s)) counts.set(lang, (counts.get(lang) ?? 0) + 3 + (h % 5));
  }
  if (counts.size === 0) counts.set("TypeScript", 5);
  return buildVerdict(skills, counts, {
    username,
    verifiedAt: new Date().toISOString(),
    source: "mock",
    publicRepos: repos,
    accountAgeYears: 2 + (h % 8),
  });
}

// ---------- 真 GitHub API ----------
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 原始 GitHub 資料（與技能無關）；以小寫 username 快取 10 分鐘，技能比對每次重算 */
interface GithubRaw {
  username: string;
  publicRepos: number;
  createdAt: string;
  langs: [string, number][];
  fetchedAt: number;
}
const gc = globalThis as unknown as { __ghCache?: Map<string, GithubRaw> };
const rawCache: Map<string, GithubRaw> = gc.__ghCache ?? (gc.__ghCache = new Map());

function cacheGet(key: string): GithubRaw | null {
  const hit = rawCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
    rawCache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key: string, raw: GithubRaw) {
  // 順手清掉過期項目，避免 Map 無限成長
  if (rawCache.size > 500)
    for (const [k, v] of rawCache)
      if (Date.now() - v.fetchedAt > CACHE_TTL_MS) rawCache.delete(k);
  rawCache.set(key, raw);
}

/** 把 GitHub 的限流標頭換算成秒數（Retry-After 優先，其次 X-RateLimit-Reset） */
function retryAfterFrom(res: Response): number | undefined {
  const ra = Number(res.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return Math.ceil(ra);
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0)
    return Math.max(1, Math.ceil(reset - Date.now() / 1000));
  return undefined;
}

/**
 * 兩個請求共用的回應分類：
 * 404 → not_found；429，或 403 且 X-RateLimit-Remaining=0（或帶 Retry-After）→ rate_limited；其他非 2xx → fetch_failed
 */
function classify(res: Response): GithubVerifyError | null {
  if (res.ok) return null;
  if (res.status === 404) return new GithubVerifyError("not_found");
  if (
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))
  )
    return new GithubVerifyError("rate_limited", retryAfterFrom(res));
  return new GithubVerifyError("fetch_failed");
}

async function fetchGithubRaw(username: string, signal?: AbortSignal): Promise<GithubRaw> {
  const headers: Record<string, string> = {
    "User-Agent": "siebo-captain/1.0",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // 有 GITHUB_TOKEN（不需任何權限的 fine-grained PAT 即可）→ 額度從每 IP 60 次/小時變成每 token 5000 次/小時
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const init: RequestInit = { headers, cache: "no-store", signal: sig };
  const base = `https://api.github.com/users/${encodeURIComponent(username)}`;

  try {
    const uRes = await fetch(base, init);
    const uErr = classify(uRes);
    if (uErr) throw uErr;
    const u = (await uRes.json()) as { login?: string; public_repos?: number; created_at?: string };

    const rRes = await fetch(`${base}/repos?per_page=100&sort=pushed&type=owner`, init);
    const rErr = classify(rRes);
    if (rErr) throw rErr;
    const repos = (await rRes.json()) as { language: string | null; fork?: boolean }[];
    if (!Array.isArray(repos)) throw new GithubVerifyError("fetch_failed");

    return {
      username: typeof u.login === "string" ? u.login : username,
      publicRepos: typeof u.public_repos === "number" ? u.public_repos : 0,
      createdAt: typeof u.created_at === "string" ? u.created_at : new Date().toISOString(),
      langs: Array.from(langCounts(repos).entries()),
      fetchedAt: Date.now(),
    };
  } catch (e) {
    if (e instanceof GithubVerifyError) throw e;
    // 逾時（TimeoutError/AbortError）、網路錯誤（TypeError: fetch failed）、JSON 解析失敗都歸為 fetch_failed，
    // 不讓未預期的例外變成 500
    throw new GithubVerifyError("fetch_failed");
  }
}

/**
 * 驗證 GitHub 技能主張。
 * - GITHUB_VERIFY=mock：確定性假資料（測試/離線）
 * - 其他：打公開 GitHub API（有 GITHUB_TOKEN 就帶上），每個請求 8 秒逾時，可再傳入 signal（例如 req.signal）
 * - 原始資料以小寫 username 快取 10 分鐘；失敗一律丟 GithubVerifyError（not_found / rate_limited / fetch_failed）
 */
export async function verifyGithub(
  username: string,
  skills: string[],
  signal?: AbortSignal,
): Promise<GithubVerification> {
  if (process.env.GITHUB_VERIFY === "mock") {
    // mock 模式下的錯誤觸發帳號（給測試與前端文案驗證用）
    const lower = username.toLowerCase();
    if (lower === "notfound-demo") throw new GithubVerifyError("not_found");
    if (lower === "ratelimit-demo") throw new GithubVerifyError("rate_limited", 60);
    if (lower === "fail-demo") throw new GithubVerifyError("fetch_failed");
    return mockVerify(username, skills);
  }

  const key = username.toLowerCase();
  const raw = cacheGet(key) ?? (await fetchGithubRaw(username, signal));
  cacheSet(key, raw);

  const ageYears = Math.max(
    0,
    Math.floor((Date.now() - new Date(raw.createdAt).getTime()) / (365.25 * 24 * 3600 * 1000)),
  );
  return buildVerdict(skills, new Map(raw.langs), {
    username: raw.username,
    verifiedAt: new Date().toISOString(),
    source: "github-api",
    publicRepos: raw.publicRepos,
    accountAgeYears: ageYears,
  });
}
