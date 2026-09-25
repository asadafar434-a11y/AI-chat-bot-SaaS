import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

// Страницу входа видят все, кто открыл закрытую ссылку, — поисковикам её показывать незачем.
export const metadata: Metadata = {
  title: "Вход — Тендерный юрист",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginForm />;
}
