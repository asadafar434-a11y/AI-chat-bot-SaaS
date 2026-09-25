import type { Metadata } from "next";
import { JetBrains_Mono, Montserrat } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Один шрифт на заголовки и интерфейс. Знак ₽ лежит в наборе latin-ext: он скачивается вместе
// с остальными и подгружается, когда встречается, а заранее грузятся только латиница и кириллица.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "cyrillic"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Тендерный юрист",
  description: "ИИ-ассистент по 44-ФЗ и 223-ФЗ: загрузите документы и задайте вопрос",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${montserrat.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
