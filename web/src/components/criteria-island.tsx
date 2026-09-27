"use client";

import { Island } from "@/components/island";
import { WarningIcon } from "@/components/icons";
import { SourceQuote } from "@/components/purchase-bits";
import { groupCriteria, isPrice, pointsText, weightsAddUp, type Criteria, type ScoredRow } from "@/lib/criteria";

// Сколько решает цена и сколько — всё остальное: первое, что поставщику нужно знать о конкурсе.
function summary(criteria: Criteria): string {
  if (criteria.howWins === "price") return "Побеждает наименьшая цена — баллов нет.";
  const groups = groupCriteria(criteria.rows);
  if (!weightsAddUp(groups)) return "Побеждает больше баллов. Значимости критериев — в строках ниже.";
  const price = groups.filter((g) => isPrice(g.name)).reduce((sum, g) => sum + (g.weight ?? 0), 0);
  if (price === 0) return "Побеждает больше баллов из 100. Цена баллов не даёт — решают критерии ниже.";
  if (price === 100) return "Побеждает больше баллов из 100 — и все они за цену.";
  return `Побеждает больше баллов из 100: цена — до ${pointsText(price)}, остальное — до ${pointsText(100 - price)}.`;
}

// Бейдж «до 15 баллов»: сколько итоговых баллов из 100 даёт строка. Доли нет — значимость как в документе.
function Points({ row }: { row: ScoredRow }) {
  const text =
    row.share !== null
      ? `до ${pointsText(row.share)}`
      : [row.indicatorWeight, row.detailWeight].filter((w) => w.trim()).join(" · ") || "значимость не указана";
  return (
    <span className="t-tag inline-flex h-6 flex-none items-center whitespace-nowrap rounded-[var(--r-pill)] bg-[var(--brand-tint)] px-2.5 text-primary">
      {text}
    </span>
  );
}

// Число и его единица — на одной строке: «20 %», «3 000 000 ₽», «100 баллов», «5 лет».
const glue = (text: string) =>
  text
    .replace(/(\d) (?=\d{3}(?!\d))/g, "$1\u00a0")
    .replace(/(\d) (?=%|₽|руб|балл|лет|год|дн|раз|специалист|договор|контракт)/g, "$1\u00a0");

function Fact({ label, children }: { label: string; children: string }) {
  if (!children.trim()) return null;
  return (
    <p className="t-read">
      <span className="text-[var(--ink-3)]">{label}: </span>
      {glue(children)}
    </p>
  );
}

// Строка, за которую дают баллы: название, сколько баллов, как считают, что приложить, форма и цитата.
function Row({ id, title, sub = "", row, open, onToggle }: {
  id: string;
  title: string;
  sub?: string;
  row: ScoredRow;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <li className="grid gap-1 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="t-strong">{title}</span>
          {sub && <span className="t-caption text-[var(--ink-3)]">{sub}</span>}
        </div>
        <Points row={row} />
      </div>
      <Fact label="Как считают">{row.scoring}</Fact>
      <Fact label="Что приложить">{row.proof}</Fact>
      <Fact label="Форма">{row.form}</Fact>
      <SourceQuote
        source={row.source || "цитата"}
        quote={row.quote}
        verified={row.verified}
        what="строку"
        open={open === id}
        onToggle={() => onToggle(id)}
      />
    </li>
  );
}

// Шаг 1 «Требования»: как оценят заявку. По строке на каждый пункт, за который дают баллы: сколько баллов из 100,
// как их считают, что приложить и по какой форме, и точная цитата из порядка оценки.
export function CriteriaIsland({ criteria, open, onToggle }: {
  criteria: Criteria | undefined;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  // Закупки, выписанные до появления критериев, и документы без способа определения победителя — без острова.
  if (!criteria || (criteria.howWins === "unknown" && criteria.rows.length === 0)) return null;
  const groups = groupCriteria(criteria.rows);
  const addsUp = weightsAddUp(groups);
  const quotes = { open, onToggle };

  return (
    <Island id="req-criteria" level={3} title="Как оценят заявку" sub={summary(criteria)}>
      {criteria.howWins === "points" && groups.length === 0 && (
        <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">
          Порядок оценки заявок не нашёл. Обычно он отдельным файлом к извещению — добавьте его, и я выпишу, за что дают баллы.
        </p>
      )}
      {groups.length > 0 && (
        <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
          {groups.map((group, g) => {
            // Критерий без показателей, как цена, — одной строкой; с показателями — подпись и строки показателей.
            const single = group.rows.length === 1 && !group.rows[0].indicator.trim();
            if (single) {
              return (
                <Row key={group.name} id={`criteria-${g}-0`} title={group.name} row={{ ...group.rows[0], share: group.weight }} {...quotes} />
              );
            }
            return (
              <li key={group.name} className="grid pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="t-over text-[var(--ink-3)]">{group.name}</span>
                  {group.weight !== null && <span className="t-caption text-[var(--ink-3)]">всего до {pointsText(group.weight)}</span>}
                </div>
                <ul className="divide-y divide-[var(--line)]">
                  {group.rows.map((row, r) => (
                    <Row
                      key={r}
                      id={`criteria-${g}-${r}`}
                      title={row.detail.trim() || row.indicator.trim()}
                      sub={row.detail.trim() ? row.indicator : ""}
                      row={row}
                      {...quotes}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {criteria.howWins === "points" && groups.length > 0 && !addsUp && (
        <p className="t-caption flex items-center gap-2 px-[var(--pad)] pb-3 text-[var(--warn)]">
          <WarningIcon className="size-4 shrink-0" />
          Значимости критериев в сумме не 100 % — сверьте с порядком оценки: что-то могло не выписаться.
        </p>
      )}
    </Island>
  );
}
