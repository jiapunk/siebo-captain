/**
 * 破冰卡分享圖：以 Canvas 2D 繪製 1080 寬 PNG（作戰終端風格）。
 * 中文與 emoji 直接用系統字型渲染——不需要任何字型檔或額外套件。
 * 所有文字都會換行或加省略號，不會超出畫布；分享標題與日期依語系。
 */
import type { Locale } from "./i18n-dict";

export interface ShareCardData {
  name: string;
  emoji: string;
  role: string;
  score: number;
  shared: string[];
  complement: string[];
  risk: string;
  openers: string[];
  /** 日期格式用；沒給就讀 <html lang>（LocaleProvider 會同步） */
  locale?: Locale;
  labels?: {
    brief: string;
    subtitle: string;
    compat: string;
    openers: string;
    openersHint: string;
    ready: string;
    /** 左上品牌字（預設「賽博隊長」；建議傳 t("brand.name")） */
    brand?: string;
    /** navigator.share 的標題（預設用 subtitle） */
    shareTitle?: string;
  };
}

const W = 1080;
const PAD = 72;
const BG = "#070c0f";
const SOFT = "#131c20";
const GRID = "rgba(91,227,167,0.06)";
const INK = "#dbe8e5";
const DIM = "#6d848a";
const LINE = "#26353b";
const ACCENT = "#ff5c38";
const AMBER = "#ffb454";
const GREEN = "#5be3a7";
const CYAN = "#54c7ec";
const FONT =
  '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

const INTL_LOCALE: Record<Locale, string> = { zh: "zh-TW", cn: "zh-CN", en: "en-US", ja: "ja-JP" };

/** 日期字串：依 locale；沒給就用 <html lang>（瀏覽器預設格式） */
function dateText(locale?: Locale): string {
  const tag =
    (locale && INTL_LOCALE[locale]) ||
    (typeof document !== "undefined" ? document.documentElement.lang : "") ||
    undefined;
  try {
    return new Date().toLocaleDateString(tag);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** 超過寬度就截斷加「…」 */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && ctx.measureText(chars.join("") + "…").width > maxWidth)
    chars.pop();
  return chars.join("") + "…";
}

/**
 * 依寬度換行：CJK 逐字、英文等以單字為單位（單字本身太長才逐字切）。
 * maxLines 有給時，超過的部分收在最後一行並加「…」。
 */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = Infinity,
): string[] {
  const tokens =
    (text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]+\s*|\s+/g) ?? [];
  const lines: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) lines.push(cur.trimEnd());
    cur = "";
  };
  for (const tok of tokens) {
    const test = cur + tok;
    if (ctx.measureText(test.trimEnd()).width <= maxWidth) {
      cur = test;
      continue;
    }
    if (cur) push();
    const word = tok.trimStart();
    if (ctx.measureText(word.trimEnd()).width <= maxWidth) {
      cur = word;
      continue;
    }
    // 單一 token 比整行還寬：逐字切
    for (const ch of word) {
      if (ctx.measureText(cur + ch).width > maxWidth && cur) push();
      cur += ch;
    }
  }
  push();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(ctx, `${kept[maxLines - 1]}…`, maxWidth);
    return kept;
  }
  return lines;
}

/** 從 font 大小往下縮到放得下（最小 minPx），仍放不下就截斷；回傳實際 font 與文字 */
function fitLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: (px: number) => string,
  px: number,
  minPx: number,
): { font: string; text: string } {
  for (let size = px; size >= minPx; size -= 2) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= maxWidth) return { font: ctx.font, text };
  }
  ctx.font = font(minPx);
  return { font: ctx.font, text: ellipsize(ctx, text, maxWidth) };
}

/** 下載 PNG */
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * 能分享檔案就用 Web Share；使用者自己取消（AbortError）就結束，不強制下載。
 * 其他錯誤（NotAllowedError：手勢過期、權限等）才退回下載。
 */
async function shareOrDownload(blob: Blob, fileName: string, title: string) {
  const file = new File([blob], fileName, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
    }
  }
  download(blob, fileName);
}

/** 頁首：品牌字 + 右側兩行標籤（依品牌字寬度排版，不重疊、不出界） */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  y: number,
  brand: string,
  line1: string,
  line2: string,
) {
  ctx.fillStyle = INK;
  const b = fitLine(ctx, brand, 420, (px) => `900 ${px}px ${FONT}`, 50, 30);
  ctx.font = b.font;
  ctx.fillText(b.text, PAD, y);
  const x = Math.max(PAD + 240, PAD + ctx.measureText(b.text).width + 28);
  const room = W - PAD - x;
  ctx.fillStyle = DIM;
  ctx.font = `24px ${MONO}`;
  ctx.fillText(ellipsize(ctx, line1, room), x, y - 6);
  ctx.font = `22px ${MONO}`;
  ctx.fillText(ellipsize(ctx, line2, room), x, y + 26);
}

function chamfer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

export async function renderShareCard(d: ShareCardData): Promise<Blob> {
  // 量測
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `30px ${FONT}`;
  // 文字區從 PAD + 170 開始畫，所以可用寬度是 W - PAD*2 - 170（再留 10px）
  const openerLines = d.openers.map((o) => wrap(measure, o, W - PAD * 2 - 140, 6));
  const sharedLines = d.shared.length
    ? wrap(measure, d.shared.join("、"), W - PAD * 2 - 180, 6)
    : [];
  const compLines = d.complement.flatMap((c) =>
    wrap(measure, c, W - PAD * 2 - 180, 4),
  );
  const riskLines = d.risk ? wrap(measure, d.risk, W - PAD * 2 - 180, 4) : [];

  let h = 210; // header
  h += 190; // target block
  h += sharedLines.length ? sharedLines.length * 44 + 70 : 0;
  h += compLines.length ? compLines.length * 44 + 70 : 0;
  h += riskLines.length ? riskLines.length * 44 + 70 : 0;
  h += 96; // openers heading
  h += openerLines.reduce((acc, lines) => acc + lines.length * 46 + 84, 0);
  h += 120; // footer

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // 底 + 藍圖網格
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  let y = 0;

  // 頂部信號橘條
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 10);

  y = 108;
  const L: NonNullable<ShareCardData["labels"]> = d.labels ?? {
    brief: "BREAK-ICE BRIEF",
    subtitle: "黑客松破冰雷達 // 破冰卡",
    compat: "COMPATIBILITY",
    openers: "開場三句",
    openersHint: "OPENERS // 照著念也可以",
    ready: "RADAR READY",
  };
  drawHeader(ctx, y, L.brand ?? "賽博隊長", L.brief, L.subtitle);

  y += 40;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 84;

  // 目標區塊
  const bx = PAD;
  ctx.fillStyle = SOFT;
  chamfer(ctx, bx, y - 30, 108, 108, 12);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.stroke();
  ctx.font = `58px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(d.emoji, bx + 54, y + 26);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // 名字與角色的可用寬度：左邊頭像、右邊分數區（約 230px）之間
  const nameRoom = W - PAD - 250 - (bx + 140);
  ctx.fillStyle = INK;
  const nm = fitLine(ctx, d.name, nameRoom, (px) => `900 ${px}px ${FONT}`, 56, 34);
  ctx.font = nm.font;
  ctx.fillText(nm.text, bx + 140, y + 6);

  // 角色框
  if (d.role) {
    ctx.strokeStyle = LINE;
    ctx.font = `26px ${MONO}`;
    const roleText = ` ${ellipsize(ctx, d.role, nameRoom - 30)} `;
    const roleW = ctx.measureText(roleText).width + 16;
    ctx.strokeRect(bx + 140, y + 28, roleW, 42);
    ctx.fillStyle = "#c7d6e2";
    ctx.fillText(roleText, bx + 148, y + 59);
  }

  // 分數（右）
  ctx.textAlign = "right";
  ctx.fillStyle = ACCENT;
  ctx.font = `900 64px ${MONO}`;
  ctx.fillText(String(d.score), W - PAD, y + 8);
  ctx.fillStyle = DIM;
  ctx.font = `22px ${MONO}`;
  ctx.fillText(L.compat, W - PAD, y + 42);
  ctx.textAlign = "left";
  // 分數段條
  const segW = 14;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i < Math.round((d.score / 100) * 12) ? ACCENT : SOFT;
    ctx.fillRect(W - PAD - (12 - i) * (segW + 5), y + 56, segW, 10);
  }

  y += 150;

  const section = (label: string, color: string, lines: string[]) => {
    if (!lines.length) return;
    ctx.fillStyle = color;
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(label, PAD, y);
    ctx.fillStyle = "#dce7ef";
    ctx.font = `30px ${FONT}`;
    lines.forEach((l, i) => {
      ctx.fillText(l, PAD + 170, y + i * 44);
    });
    y += lines.length * 44 + 70;
  };

  section("SHARED", GREEN, sharedLines);
  section("COMPLEMENT", ACCENT, compLines);
  section("WATCH-OUT", AMBER, riskLines);

  // 開場三句
  ctx.fillStyle = INK;
  const op = fitLine(ctx, L.openers, 300, (px) => `900 ${px}px ${FONT}`, 34, 24);
  ctx.font = op.font;
  ctx.fillText(op.text, PAD, y);
  const hintX = Math.max(PAD + 180, PAD + ctx.measureText(op.text).width + 24);
  ctx.fillStyle = DIM;
  ctx.font = `22px ${MONO}`;
  ctx.fillText(ellipsize(ctx, L.openersHint, W - PAD - hintX), hintX, y - 4);
  y += 30;

  openerLines.forEach((lines, idx) => {
    const boxH = lines.length * 46 + 56;
    ctx.fillStyle = "#ffffff";
    chamfer(ctx, PAD, y, W - PAD * 2, boxH, 14);
    ctx.fill();
    ctx.fillStyle = ACCENT;
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(String(idx + 1).padStart(2, "0"), PAD + 28, y + 56);
    ctx.fillStyle = "#101b2c";
    ctx.font = `30px ${FONT}`;
    lines.forEach((l, i) => {
      ctx.fillText(l, PAD + 96, y + 56 + i * 46);
    });
    y += boxH + 22;
  });

  // Footer
  y += 46;
  ctx.fillStyle = DIM;
  ctx.font = `22px ${MONO}`;
  ctx.fillText(`siebo-captain // break-ice card // ${dateText(d.locale)}`, PAD, y);
  // 印章（框寬依文字量測，右緣對齊內容區）
  ctx.font = `700 20px ${MONO}`;
  const stamp = ellipsize(ctx, L.ready, 360);
  const sw = Math.max(124, ctx.measureText(stamp).width + 28);
  ctx.save();
  ctx.translate(W - PAD - sw / 2, y - 18);
  ctx.rotate(-0.08);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  ctx.strokeRect(-sw / 2, -24, sw, 38);
  ctx.fillStyle = GREEN;
  ctx.textAlign = "center";
  ctx.fillText(stamp, 0, 3);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

/** 分享或下載 PNG（使用者取消分享時不下載） */
export async function shareCardPng(data: ShareCardData, fileName: string) {
  const blob = await renderShareCard(data);
  await shareOrDownload(
    blob,
    fileName,
    data.labels?.shareTitle ?? data.labels?.subtitle ?? "賽博隊長 // 破冰卡",
  );
}

// ============================================================
// 選手數據卡（自我介紹用）
// ============================================================
export interface PlayerCardData {
  name: string;
  emoji: string;
  /** 空字串／空陣列＝不畫（例如分享範圍關閉的欄位） */
  role: string;
  skills: string[];
  goal: string;
  availability: string;
  workingStyle: string;
  vibe: string;
  bio: string;
  verified?: { repos: number; langs: string } | null;
  /** 日期／格式用；沒給就讀 <html lang> */
  locale?: Locale;
  labels: {
    /** 左上品牌字（預設「賽博隊長」） */
    brand?: string;
    /** navigator.share 的標題（預設用 subtitle） */
    shareTitle?: string;
    title: string;
    subtitle: string;
    skills: string;
    goal: string;
    avail: string;
    style: string;
    verified: string;
    footer: string;
    scan: string;
  };
}

export async function renderPlayerCard(d: PlayerCardData): Promise<Blob> {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `30px ${FONT}`;
  // 資訊列的文字從 PAD + 200 開始畫：可用寬度 W - PAD*2 - 200（再留 10px）
  const rowW = W - PAD * 2 - 210;
  const skillLines = d.skills.length ? wrap(measure, d.skills.join(" / "), rowW, 4) : [];
  const goalLines = d.goal ? wrap(measure, d.goal, rowW, 3) : [];
  const availLines = d.availability ? wrap(measure, d.availability, rowW, 3) : [];
  const styleLines = d.workingStyle ? wrap(measure, d.workingStyle, rowW, 3) : [];
  const vibeLines = d.vibe ? wrap(measure, d.vibe, rowW, 3) : [];
  // bio 在白框內：左右各留 32px
  const bioLines = d.bio ? wrap(measure, d.bio, W - PAD * 2 - 64, 12) : [];
  const rows = [skillLines, goalLines, availLines, styleLines, vibeLines];

  let h = 210; // header
  h += 230; // identity
  h += rows.reduce((acc, l) => acc + (l.length ? l.length * 44 + 46 : 0), 0);
  h += 40;
  h += bioLines.length ? bioLines.length * 44 + 90 : 0;
  h += 130; // footer

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 10);

  let y = 108;
  drawHeader(ctx, y, d.labels.brand ?? "賽博隊長", d.labels.title, d.labels.subtitle);
  y += 40;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 96;

  // 頭像 + 名字
  ctx.fillStyle = SOFT;
  chamfer(ctx, PAD, y - 60, 140, 140, 16);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.stroke();
  ctx.font = `76px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(d.emoji, PAD + 70, y + 14);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // 暱稱：先縮字級，還放不下就截斷（可用寬度 = 頭像右側到右邊界）
  const nameRoom = W - PAD - (PAD + 180);
  ctx.fillStyle = INK;
  const nm = fitLine(ctx, d.name, nameRoom, (px) => `900 ${px}px ${FONT}`, 66, 40);
  ctx.font = nm.font;
  ctx.fillText(nm.text, PAD + 180, y - 8);
  if (d.role) {
    ctx.strokeStyle = LINE;
    ctx.font = `28px ${MONO}`;
    const roleText = ` ${ellipsize(ctx, d.role, nameRoom - 40)} `;
    const roleW = ctx.measureText(roleText).width + 18;
    ctx.strokeRect(PAD + 182, y + 20, roleW, 46);
    ctx.fillStyle = "#c7d6e2";
    ctx.fillText(roleText, PAD + 192, y + 53);
  }

  y += 140;

  const row = (label: string, lines: string[], color: string) => {
    if (!lines.length) return;
    ctx.fillStyle = color;
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(label, PAD, y);
    ctx.fillStyle = "#dce7ef";
    ctx.font = `30px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, PAD + 200, y + i * 44));
    y += lines.length * 44 + 46;
  };

  row(d.labels.skills, skillLines, AMBER);
  row(d.labels.goal, goalLines, GREEN);
  row(d.labels.avail, availLines, CYAN);
  row(d.labels.style, styleLines, ACCENT);
  row("VIBE", vibeLines, GREEN);

  // Bio 區塊
  y += 6;
  if (bioLines.length) {
    ctx.fillStyle = "#ffffff";
    chamfer(ctx, PAD, y - 8, W - PAD * 2, bioLines.length * 44 + 56, 14);
    ctx.fill();
    ctx.fillStyle = "#101b2c";
    ctx.font = `30px ${FONT}`;
    bioLines.forEach((l, i) => ctx.fillText(l, PAD + 32, y + 42 + i * 44));
    y += bioLines.length * 44 + 130;
  } else {
    y += 40;
  }

  // 驗證印章（右上，寬度依文字量測）；footer 只用印章左邊的空間
  let footerRoom = W - PAD * 2;
  if (d.verified) {
    ctx.font = `700 24px ${MONO}`;
    const stampText = ellipsize(ctx, `${d.labels.verified} · ${d.verified.repos} repos`, 560);
    const tw = ctx.measureText(stampText).width + 44;
    footerRoom = W - PAD - 20 - tw - PAD - 20;
    ctx.save();
    ctx.translate(W - PAD - 20, y - 20);
    ctx.rotate(-0.06);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-tw, -30, tw, 52);
    ctx.fillStyle = GREEN;
    ctx.textAlign = "center";
    ctx.fillText(stampText, -tw / 2, 4);
    ctx.restore();
    ctx.textAlign = "left";
  }
  ctx.fillStyle = DIM;
  ctx.font = `22px ${MONO}`;
  ctx.fillText(ellipsize(ctx, `${d.labels.footer} // ${dateText(d.locale)}`, footerRoom), PAD, y + 10);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

/** 分享或下載選手卡（使用者取消分享時不下載） */
export async function sharePlayerCardPng(d: PlayerCardData, fileName: string) {
  const blob = await renderPlayerCard(d);
  await shareOrDownload(blob, fileName, d.labels.shareTitle ?? d.labels.subtitle);
}
