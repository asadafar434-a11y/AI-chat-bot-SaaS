import { redirect } from "next/navigation";

// «Мои данные» теперь разделы сайдбара: реквизиты и документы открываются сразу.
export default function MePage() {
  redirect("/me/profile");
}
