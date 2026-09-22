import type { HackathonProfile, VisibilityMap } from "./types";

export type PublicProfile = HackathonProfile; // 隱藏欄位以「未公開」呈現

const REDACTED = "未公開";

/** 依分享權限把選手卡投影成可給對方隊長看的版本 */
export function publicProfile(
  compiled: HackathonProfile,
  visibility: VisibilityMap | null,
): PublicProfile {
  const v = visibility ?? {};
  const p = { ...compiled };
  const hide = (k: keyof HackathonProfile) => {
    if (v[k] === false) (p as unknown as Record<string, unknown>)[k] = REDACTED;
  };
  if (v.skills === false) p.skills = [];
  if (v.dealbreakers === false) p.dealbreakers = [];
  hide("role");
  hide("timezone");
  hide("availability");
  hide("goal");
  hide("workingStyle");
  return p;
}
