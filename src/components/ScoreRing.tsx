"use client";

/** 訊號強度計：分段 LED + 等寬數字（GITS HUD 風格） */
export default function ScoreRing({
  score,
  size = 64,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const segs = 12;
  const filled = Math.max(1, Math.round((score / 100) * segs));
  const color =
    score >= 70 ? "#ff5c38" : score >= 55 ? "#ffb454" : "#6d848a";
  const numSize = size >= 64 ? 30 : size >= 50 ? 24 : 20;
  const segW = size >= 64 ? 9 : 6;
  const segH = size >= 64 ? 8 : 6;

  return (
    <div className="inline-flex flex-col items-end gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <span
          className="mono font-bold leading-none"
          style={{ fontSize: numSize, color, textShadow: `0 0 10px ${color}44` }}
        >
          {score}
        </span>
        {label && <span className="tag">{label}</span>}
      </div>
      <div className="flex" style={{ gap: 3 }}>
        {Array.from({ length: segs }).map((_, i) => (
          <span
            key={i}
            style={{
              width: segW,
              height: segH,
              background: i < filled ? color : "#26353b",
            }}
          />
        ))}
      </div>
    </div>
  );
}
