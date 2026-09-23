import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import { translate } from "@/lib/i18n-dict";
import { htmlLangOf, resolveServerLocale } from "@/lib/locale";

// 語系由伺服器依 sc_lang cookie（沒有時依 Accept-Language）決定：
// SSR 直接輸出正確的 <html lang> 與文字，不會先閃一下繁中；也讓每頁都是動態渲染。
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await resolveServerLocale();
  return {
    title: translate(locale, "b.meta.title"),
    description: translate(locale, "b.meta.desc"),
  };
}

// 不用 Next 產生的全域 LayoutProps：乾淨 clone 在 next typegen/build 之前直接跑 tsc 也能通過
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await resolveServerLocale();
  return (
    <html lang={htmlLangOf(locale)} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
