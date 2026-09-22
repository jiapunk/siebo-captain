/**
 * 破冰卡分享圖：以 Canvas 2D 繪製 1080 寬 PNG（作戰終端風格）。
 * 中文與 emoji 直接用系統字型渲染——不需要任何字型檔或額外套件。
 */

export interface ShareCardData {
  name: string;
  emoji: string;
  role: string;
  score: number;
  shared: string[];
  complement: string[];
  risk: string;
  openers: string[];
  labels?: {
    brief: string;
    subtitle: string;
    compat: string;
    openers: string;
    openersHint: string;
    ready: string;
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

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
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
  const openerLines = d.openers.map((o) => wrap(measure, o, W - PAD * 2 - 140));
  measure.font = `30px ${FONT}`;
  const sharedLines = d.shared.length
    ? wrap(measure, d.shared.join("、"), W - PAD * 2 - 210)
    : [];
  const compLines = d.complement.flatMap((c) =>
    wrap(measure, c, W - PAD * 2 - 210),
  );
  const riskLines = d.risk ? wrap(measure, d.risk, W - PAD * 2 - 210) : [];

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
  ctx.fillStyle = INK;
  ctx.font = `900 50px ${FONT}`;
  ctx.fillText("賽博隊長", PAD, y);
  const L = d.labels ?? {
    brief: "BREAK-ICE BRIEF",
    subtitle: "黑客松破冰雷達 // 破冰卡",
    compat: "COMPATIBILITY",
    openers: "開場三句",
    openersHint: "OPENERS // 照著念也可以",
    ready: "RADAR READY",
  };
  ctx.fillStyle = DIM;
  ctx.font = `24px ${MONO}`;
  ctx.fillText(L.brief, PAD + 240, y - 6);
  ctx.font = `22px ${MONO}`;
  ctx.fillText(L.subtitle, PAD + 240, y + 26);

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

  ctx.fillStyle = INK;
  ctx.font = `900 56px ${FONT}`;
  ctx.fillText(d.name, bx + 140, y + 6);

  // 角色框
  ctx.strokeStyle = LINE;
  ctx.font = `26px ${MONO}`;
  const roleText = ` ${d.role} `;
  const roleW = ctx.measureText(roleText).width + 16;
  ctx.strokeRect(bx + 140, y + 28, roleW, 42);
  ctx.fillStyle = "#c7d6e2";
  ctx.fillText(roleText, bx + 148, y + 59);

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
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText(L.openers, PAD, y);
  ctx.fillStyle = DIM;
  ctx.font = `22px ${MONO}`;
  ctx.fillText(L.openersHint, PAD + 180, y - 4);
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
  ctx.fillText(
    `siebo-captain // break-ice card // ${new Date().toLocaleDateString("zh-TW")}`,
    PAD,
    y,
  );
  // 印章
  ctx.save();
  ctx.translate(W - PAD - 60, y - 18);
  ctx.rotate(-0.08);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  ctx.strokeRect(-62, -24, 124, 38);
  ctx.fillStyle = GREEN;
  ctx.font = `700 20px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(L.ready, 0, 3);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

/** 下載或分享 PNG */
export async function shareCardPng(data: ShareCardData, fileName: string) {
  const blob = await renderShareCard(data);
  const file = new File([blob], fileName, { type: "image/png" });
  if (
    typeof navigator !== "undefined" &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: "我的破冰卡" });
      return;
    } catch {
      // 使用者取消分享 → 改走下載
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ============================================================
// 選手數據卡（自我介紹用）
// ============================================================
export interface PlayerCardData {
  name: string;
  emoji: string;
  role: string;
  skills: string[];
  goal: string;
  availability: string;
  workingStyle: string;
  vibe: string;
  bio: string;
  verified?: { repos: number; langs: string } | null;
  labels: {
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
  const skillLines = wrap(measure, d.skills.join(" / "), W - PAD * 2 - 200);
  const bioLines = wrap(measure, d.bio, W - PAD * 2 - 40);
  const vibeLines = wrap(measure, d.vibe, W - PAD * 2 - 200);

  let h = 210; // header
  h += 230; // identity
  h += 30 + skillLines.length * 44 + 46;
  h += vibeLines.length * 44 + 46;
  h += 3 * 60 + 40; // 三個資訊列
  h += bioLines.length * 44 + 90;
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
  ctx.fillStyle = INK;
  ctx.font = `900 50px ${FONT}`;
  ctx.fillText("賽博隊長", PAD, y);
  ctx.fillStyle = DIM;
  ctx.font = `24px ${MONO}`;
  ctx.fillText(d.labels.title, PAD + 240, y - 6);
  ctx.font = `22px ${MONO}`;
  ctx.fillText(d.labels.subtitle, PAD + 240, y + 26);
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

  ctx.fillStyle = INK;
  ctx.font = `900 66px ${FONT}`;
  ctx.fillText(d.name, PAD + 180, y - 8);
  ctx.strokeStyle = LINE;
  ctx.font = `28px ${MONO}`;
  const roleText = ` ${d.role} `;
  const roleW = ctx.measureText(roleText).width + 18;
  ctx.strokeRect(PAD + 182, y + 20, roleW, 46);
  ctx.fillStyle = "#c7d6e2";
  ctx.fillText(roleText, PAD + 192, y + 53);

  y += 140;

  const row = (label: string, lines: string[], color: string) => {
    ctx.fillStyle = color;
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(label, PAD, y);
    ctx.fillStyle = "#dce7ef";
    ctx.font = `30px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, PAD + 200, y + i * 44));
    y += lines.length * 44 + 46;
  };

  row(d.labels.skills, skillLines, AMBER);
  row(d.labels.goal, [d.goal], GREEN);
  row(d.labels.avail, [d.availability], CYAN);
  row(d.labels.style, [d.workingStyle], ACCENT);
  row("VIBE", vibeLines, GREEN);

  // Bio 區塊
  y += 6;
  ctx.fillStyle = "#ffffff";
  chamfer(ctx, PAD, y - 8, W - PAD * 2, bioLines.length * 44 + 56, 14);
  ctx.fill();
  ctx.fillStyle = "#101b2c";
  ctx.font = `30px ${FONT}`;
  bioLines.forEach((l, i) => ctx.fillText(l, PAD + 32, y + 42 + i * 44));
  y += bioLines.length * 44 + 130;

  // 驗證印章（右上，寬度依文字量測）
  if (d.verified) {
    const stampText = `${d.labels.verified} · ${d.verified.repos} repos`;
    ctx.font = `700 24px ${MONO}`;
    const tw = ctx.measureText(stampText).width + 44;
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
  ctx.fillText(d.labels.footer, PAD, y + 10);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

export async function sharePlayerCardPng(d: PlayerCardData, fileName: string) {
  const blob = await renderPlayerCard(d);
  const file = new File([blob], fileName, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: d.labels.title });
      return;
    } catch {}
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
