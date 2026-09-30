import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Шрифты стиля Figma Make: Geist — заголовки, интерфейс и текст, Geist Mono — числа, номера, реквизиты.
// Знак ₽ лежит в наборе latin-ext: он скачивается вместе с остальными и подгружается, когда встречается,
// а заранее грузятся только латиница и кириллица.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Тендерный юрист",
  description: "ИИ-ассистент по 44-ФЗ и 223-ФЗ: загрузите документы и задайте вопрос",
};

// Тема ставится до первой отрисовки: сохранённый выбор, иначе системная. Так страница не мигает светлой тёмной.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="overflow-hidden">
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TooltipProvider>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
