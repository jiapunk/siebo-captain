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
      {LOCALES.map((l) => (
        <button
          key={l.id}
          onClick={(e) => {
            e.stopPropagation();
            setLocale(l.id);
          }}
          className={`mono px-2 py-1 text-[10px] tracking-wider transition ${
            locale === l.id
              ? "bg-phos text-[#04211a]"
              : "text-muted hover:text-phos"
          } ${compact ? "" : "px-2.5"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
