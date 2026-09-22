/** GitHub 技能驗證：防「人人都說自己會」——用公開數據交叉檢查技能主張 */

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
}

export class GithubVerifyError extends Error {
  code: "not_found" | "rate_limited" | "fetch_failed";
  constructor(code: GithubVerifyError["code"]) {
    super(code);
    this.code = code;
  }
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

function langCounts(repos: { language: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (!r.language) continue;
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
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 測試/離線環境的確定性驗證結果（PLAYWRIGHT / GITHUB_VERIFY=mock） */
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

export async function verifyGithub(
  username: string,
  skills: string[],
): Promise<GithubVerification> {
  if (process.env.GITHUB_VERIFY === "mock") return mockVerify(username, skills);

  const headers = {
    "User-Agent": "siebo-captain/1.0",
    Accept: "application/vnd.github+json",
  };
  const uRes = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}`,
    { headers, cache: "no-store" },
  );
  if (uRes.status === 404) throw new GithubVerifyError("not_found");
  if (!uRes.ok) throw new GithubVerifyError("fetch_failed");
  const u = (await uRes.json()) as {
    public_repos: number;
    created_at: string;
  };

  const rRes = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`,
    { headers, cache: "no-store" },
  );
  if (rRes.status === 403) throw new GithubVerifyError("rate_limited");
  if (!rRes.ok) throw new GithubVerifyError("fetch_failed");
  const repos = (await rRes.json()) as { language: string | null }[];

  const ageYears = Math.max(
    0,
    Math.floor((Date.now() - new Date(u.created_at).getTime()) / (365.25 * 24 * 3600 * 1000)),
  );

  return buildVerdict(skills, langCounts(repos), {
    username,
    verifiedAt: new Date().toISOString(),
    source: "github-api",
    publicRepos: u.public_repos,
    accountAgeYears: ageYears,
  });
}
