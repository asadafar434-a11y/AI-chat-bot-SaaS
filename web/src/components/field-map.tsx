"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useApplicationFiles } from "@/components/application-files";
import { Badge } from "@/components/badge";
import { CheckIcon, CrossIcon, EditIcon, HelpCircleIcon } from "@/components/icons";
import { usePurchase } from "@/components/purchase-provider";
import { applyField, completeness, fieldQueue, fieldsOf, fieldSummary, type ApplicationField } from "@/lib/fields";
import { plural } from "@/lib/plural";
import { EMPTY_PROFILE } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import { isOwnField } from "@/lib/steps";

// Шаг «Проверка»: карта полей заявки (lib/fields.ts), как в прототипе. Сверху — сводка «Заполнение заявки» с видами
// полей, ниже — что осталось, по очереди мастера: ошибки, непонятное, вписать, подтвердить. Заполненное — по нажатию.
// Вписанное сразу уходит в документы: жёлтое место ТП, строка анкеты, подтверждение. Реквизиты общие для всех
// закупок — одной строкой со ссылкой на «Реквизиты», исполнители — на странице ТП, цена — на шаге «Цена».

type Filter = "left" | "invalid" | "manual" | "confirm" | "unknown" | "done";

const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

// Жёлтое место в тексте ТП: сам текст с выделенным местом, которое сейчас вписывают.
function holeText(p: Purchase, key: string): { text: string; hole: number } | null {
  const [kind, what, index, hole] = key.split(":");
  if (kind !== "tp" || !p.tp || hole === "done") return null;
  if (what === "item" && p.tp.items[Number(index)]) return { text: p.tp.items[Number(index)].offer, hole: Number(hole) };
  if (what === "good" && p.tp.goods[Number(index)]) return { text: p.tp.goods[Number(index)].characteristics, hole: Number(hole) };
  if (what === "consent" && index !== undefined) return { text: p.tp.form.consent, hole: Number(index) };
  return null;
}

const HOLE = /^\[[^\]]+\]$/;

function Snippet({ text, hole }: { text: string; hole: number }) {
  const parts = text.split(/(\[[^\]]+\])/).filter(Boolean);
  // Номер жёлтого места для каждого куска текста; у обычного текста — −1.
  const holes = parts.reduce<number[]>((acc, part) => [...acc, HOLE.test(part) ? acc.filter((x) => x >= 0).length : -1], []);
  return (
    <p className="t-body max-w-[80ch] whitespace-pre-wrap rounded-[var(--r-card)] bg-[var(--paper-2)] px-3 py-2 text-[var(--ink-2)]">
      {parts.map((part, i) =>
        holes[i] < 0 ? (
          <span key={i}>{part}</span>
        ) : (
          <mark
            key={i}
            className={`rounded-sm px-0.5 font-medium bg-[var(--warn-tint)] text-[var(--warn)] ${holes[i] === hole ? "ring-1 ring-[var(--warn)]" : ""}`}
          >
            {part}
          </mark>
        )
      )}
    </p>
  );
}

function StatusIcon({ field }: { field: ApplicationField }) {
  const base = "grid size-6 flex-none place-items-center rounded-full";
  if (field.status === "invalid") return <span aria-hidden className={`${base} bg-[var(--danger-tint)] text-[var(--danger)]`}><CrossIcon className="size-3.5" /></span>;
  if (field.kind === "unknown") return <span aria-hidden className={`${base} bg-[var(--paper-2)] text-[var(--ink-3)]`}><HelpCircleIcon className="size-3.5" /></span>;
  if (field.status === "filled") return <span aria-hidden className={`${base} bg-[var(--ok-tint)] text-[var(--ok)]`}><CheckIcon className="size-3.5" /></span>;
  if (field.status === "needs_confirmation") return <span aria-hidden className={`${base} bg-[var(--warn-tint)] text-[var(--warn)]`}><CheckIcon className="size-3.5" /></span>;
  return <span aria-hidden className={`${base} bg-[var(--warn-tint)] text-[var(--warn)]`}><EditIcon className="size-3.5" /></span>;
}

// Вписать значение на месте: жёлтое место ТП или строка анкеты заказчика.
function FillForm({ field, onSave }: { field: ApplicationField; onSave: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={field.label}
        aria-label={`${field.label}${field.context ? ` — ${field.context}` : ""}`}
        autoComplete="off"
        className="field min-w-0 max-w-[48ch] flex-1"
      />
      <button type="submit" disabled={!value.trim()} className="btn btn-xs">
        Вписать
      </button>
    </form>
  );
}

function Row({ field, children }: { field: ApplicationField; children?: ReactNode }) {
  const where = [field.doc, field.context, field.source && field.source !== field.doc ? field.source : ""].filter(Boolean).join(" · ");
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 py-3">
      <StatusIcon field={field} />
      <div className="grid min-w-0 gap-1.5">
        <div className="grid gap-0.5">
          <p className="t-strong">{field.label}</p>
          {where && <p className="t-caption text-[var(--ink-3)]">{where}</p>}
          {field.problem && <p className={`t-caption ${field.status === "invalid" ? "text-destructive" : "text-[var(--warn)]"}`}>{field.problem}</p>}
          {field.status === "filled" && field.value && <p className="t-body truncate text-[var(--ink-2)]">{field.value}</p>}
        </div>
        {children}
      </div>
    </li>
  );
}

export function FieldMap() {
  const { purchase, update } = usePurchase();
  const files = useApplicationFiles();
  const [filter, setFilter] = useState<Filter>("left");
  const base = `/p/${purchase.id}`;

  if (!files.meReady) return <div className="island px-[var(--pad)] py-3 text-[var(--ink-3)]">Сверяю документы с реквизитами…</div>;

  const fields = fieldsOf({
    purchase,
    profile: files.profile ?? EMPTY_PROFILE,
    evidence: {
      experience: files.myDocs.filter((d) => d.kinds.includes("experience")).length,
      staff: files.myDocs.filter((d) => d.kinds.includes("staff")).length,
    },
  });
  const summary = fieldSummary(fields);
  const final = completeness(purchase, fields);
  const queue = fieldQueue(fields);
  const save = (key: string, value: string) => {
    const patch = applyField(purchase, key, value);
    if (patch) update(patch);
  };

  // Реквизиты — одной строкой: их вписывают один раз, в «Реквизитах», для всех закупок. Туда же — подписант, если его нет.
  const isProfile = (f: ApplicationField) => f.key.startsWith("profile:") || (f.key === "confirm:signer" && f.status === "needs_input");
  const profileLeft = queue.filter(isProfile);
  const profileEmpty = profileLeft.filter((f) => f.status !== "invalid").length;
  const profileBad = profileLeft.length - profileEmpty;
  const shown = (() => {
    const own = queue.filter((f) => !isProfile(f));
    if (filter === "done") return fields.filter((f) => f.status === "filled" && f.kind !== "sign");
    if (filter === "invalid") return own.filter((f) => f.status === "invalid");
    if (filter === "manual") return own.filter((f) => isOwnField(f.key) && f.status === "needs_input");
    if (filter === "confirm") return own.filter((f) => f.status === "needs_confirmation");
    if (filter === "unknown") return own.filter((f) => f.kind === "unknown");
    return own;
  })();
  const showProfile = profileLeft.length > 0 && (filter === "left" || (filter === "invalid" && profileBad > 0));

  // «Вписать» — тем же счётом, что у шага «Проверка» в шапке: только поля этой закупки.
  const ownEmpty = fields.filter((f) => isOwnField(f.key) && f.status === "needs_input").length;
  const chips: { key: Filter; label: string; n: number | null }[] = [
    { key: "left", label: "Что осталось", n: null },
    { key: "invalid", label: "Ошибки", n: summary.invalid },
    { key: "manual", label: "Вписать", n: ownEmpty },
    { key: "confirm", label: "Подтвердить", n: summary.confirm },
    { key: "unknown", label: "Не определено", n: summary.unknown },
    { key: "done", label: "Заполнено", n: summary.done },
  ];

  const control = (f: ApplicationField) => {
    if (f.key.startsWith("anketa:") || (holeText(purchase, f.key) && f.status === "needs_input")) {
      const snippet = holeText(purchase, f.key);
      return (
        <>
          {snippet && <Snippet {...snippet} />}
          {/* Вписали одно место — следующее в том же тексте получает тот же ключ: форма пересоздаётся по тексту и очищается. */}
          <FillForm key={`${f.key}:${snippet?.text ?? ""}`} field={f} onSave={(value) => save(f.key, value)} />
        </>
      );
    }
    if (f.key === "confirm:price") {
      return (
        <Link href={`${base}/price`} className="link justify-self-start">
          {f.value ? "Изменить цену на шаге «Цена»" : "Выбрать цену на шаге «Цена»"}
        </Link>
      );
    }
    if (f.status === "needs_confirmation") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {f.value && <span className="t-body text-[var(--ink-2)]">{f.value}</span>}
          <button type="button" onClick={() => save(f.key, "")} className="btn btn-xs">
            <CheckIcon />
            Подтверждаю
          </button>
        </div>
      );
    }
    if (f.key === "confirm:signer") {
      return (
        <Link href="/me/profile" className="link justify-self-start">
          Вписать подписанта в «Реквизитах»
        </Link>
      );
    }
    if (f.key === "confirm:experience" || f.key === "confirm:staff") {
      return (
        <Link href="/me/documents" className="link justify-self-start">
          Загрузить в «Образцы и реквизиты»
        </Link>
      );
    }
    if (f.key.startsWith("cast:") || f.key.includes(":done:")) {
      return (
        <Link href={`${base}/tp`} className="link justify-self-start">
          {f.key.startsWith("cast:") ? "Вписать исполнителей в ТП" : "Исправить в ТП"}
        </Link>
      );
    }
    if (f.key.startsWith("file:")) {
      return (
        <Link href={`${base}/files`} className="link justify-self-start">
          Пересохранить и добавить заново
        </Link>
      );
    }
    return null;
  };

  return (
    <>
      <section aria-labelledby="fill-title" className="island grid gap-3 px-[var(--pad)] pb-4 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="fill-title" className="t-title">
            Заполнение заявки
          </h3>
          <span className="t-num text-[var(--ink-2)]">
            {summary.done} из {summary.total} · {Math.round(summary.share * 100)} %
          </span>
        </div>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[var(--paper-2)]">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(summary.share * 100)}%` }} />
        </div>
        <p className={final.ready ? "text-[var(--ok)]" : "text-[var(--ink-2)]"}>{final.text}</p>
        <div role="group" aria-label="Показать поля" className="flex flex-wrap gap-1.5">
          {chips
            .filter((c) => c.n === null || c.key === "done" || c.n > 0)
            .map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={`t-label inline-flex min-h-8 items-center gap-1.5 rounded-[var(--r-pill)] px-3 ${
                  filter === c.key ? "bg-primary text-primary-foreground" : "bg-[var(--paper-2)] text-[var(--ink-2)] hover:bg-[var(--paper-3)]"
                }`}
              >
                {c.label}
                {c.n !== null && <span className="t-num">{c.n}</span>}
              </button>
            ))}
        </div>
      </section>

      <section aria-label="Поля заявки" className="island px-[var(--pad)]">
        <ul className="divide-y divide-[var(--line)]">
          {/* Ошибки — первыми, как в очереди мастера; реквизиты — после них одной строкой. */}
          {shown
            .filter((f) => f.status === "invalid")
            .map((f) => (
              <Row key={f.key} field={f}>
                {control(f)}
              </Row>
            ))}
          {showProfile && (
            <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 py-3">
              <span aria-hidden className="grid size-6 place-items-center rounded-full bg-[var(--warn-tint)] text-[var(--warn)]">
                <EditIcon className="size-3.5" />
              </span>
              <div className="grid min-w-0 gap-1">
                <p className="t-strong">
                  Реквизиты:{" "}
                  {[
                    profileEmpty && `не хватает ${count(profileEmpty, "поля", "полей", "полей")}`,
                    profileBad && `с ошибкой ${count(profileBad, "поле", "поля", "полей")}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="t-caption text-[var(--ink-3)]">
                  {profileLeft
                    .slice(0, 4)
                    .map((f) => f.label)
                    .join(", ")}
                  {profileLeft.length > 4 ? ` и ещё ${profileLeft.length - 4}` : ""} · в анкету, декларацию и цену
                </p>
                <Link href="/me/profile" className="link justify-self-start">
                  Вписать в «Реквизитах»
                </Link>
              </div>
            </li>
          )}
          {shown
            .filter((f) => f.status !== "invalid")
            .map((f) => (
              <Row key={f.key} field={f}>
                {f.status !== "filled" && control(f)}
              </Row>
            ))}
          {!showProfile && shown.length === 0 && (
            <li className="flex items-center gap-2.5 py-3">
              <Badge tone="ok" text={filter === "left" ? "всё заполнено" : "здесь пусто"} icon="check" />
              {filter === "left" && <span className="text-[var(--ink-2)]">Осталось подписать заявку электронной подписью и подать на площадке.</span>}
            </li>
          )}
        </ul>
      </section>

      <p className="px-[var(--pad)] py-1 text-[var(--ink-3)]">
        Весь текст технического предложения — в документе:{" "}
        <Link href={`${base}/tp`} className="link link-quiet">
          открыть ТП
        </Link>
        {summary.sign > 0 && " · подпись ставите вы, на площадке — сервис её не ставит"}.
      </p>
    </>
  );
}
