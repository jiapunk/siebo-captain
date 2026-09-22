import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "賽博隊長 · 黑客松破冰組隊 | SIEBO CAPTAIN",
  description:
    "黑客松最難的不是寫 Code，是開場十分鐘沒人講話。你的專屬隊長先替你去破冰：技能互補、目標一致、投入時間對得上，才推薦成隊伍。 / Your AI Captain breaks the ice before you write a single line.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
