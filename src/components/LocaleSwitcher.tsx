"use client";

import { LOCALES } from "@/lib/i18n-dict";
import { useI18n } from "@/lib/i18n";

export default function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className="flex items-center border border-line"
      role="group"
      aria-label={t("lang.title")}
    >
      {LOCALES.map((l) => {
        const active = locale === l.id;
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={active}
            onClick={(e) => {
              e.stopPropagation();
              setLocale(l.id);
            }}
            // 觸控目標至少 36px 高（原本約 24px）；目前語系除了顏色，也用 aria-pressed 告知輔助科技
            className={`mono flex min-h-9 items-center justify-center whitespace-nowrap text-[10px] tracking-wider transition ${
              active ? "bg-phos text-[#04211a]" : "text-muted hover:text-phos"
            } ${compact ? "px-1.5 sm:px-2" : "px-2.5"}`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
