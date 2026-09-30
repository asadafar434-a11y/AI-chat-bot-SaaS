import { redirect } from "next/navigation";

// Старый адрес списка закупок: список теперь на главной — «Мои закупки».
export default function PurchasesPage() {
  redirect("/");
}
