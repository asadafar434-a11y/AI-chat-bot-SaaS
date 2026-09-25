import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage, Mail, Val } from "@/components/legal-page";
import { readOperator, type OperatorValue } from "@/lib/legal";

// Номера — моноширинным, как все данные в приложении.
const Num = ({ field }: { field: OperatorValue }) => (field.value ? <span className="font-mono">{field.value}</span> : <Val field={field} />);

export const metadata: Metadata = { title: "Контакты — Тендерный юрист" };

// Сведения о владельце сайта — ч. 2 ст. 10 149-ФЗ: наименование, адрес и почта для заявлений правообладателей.
export default async function ContactsPage() {
  await connection();
  const op = readOperator();
  const rows = [
    { label: "Владелец сервиса и оператор персональных данных", value: <Val field={op.name} /> },
    { label: "ИНН", value: <Num field={op.inn} /> },
    { label: "ОГРН (ОГРНИП)", value: <Num field={op.ogrn} /> },
    { label: "Адрес", value: <Val field={op.address} /> },
    { label: "Электронная почта", value: <Mail field={op.email} /> },
  ];
  return (
    <LegalPage title="Контакты" operator={op}>
      <dl className="grid divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 py-2.5 first:pt-0 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-[var(--ink-3)]">{row.label}</dt>
            <dd className="text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        На эту почту — вопросы о сервисе, запросы о персональных данных и заявления о нарушении авторских и смежных прав (статья 15.7
        Федерального закона от 27.07.2006 № 149-ФЗ «Об информации, информационных технологиях и о защите информации»).
      </p>
    </LegalPage>
  );
}
