"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, CrossIcon, PlusIcon, WarningIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { SourceQuote } from "@/components/purchase-bits";
import { castCheck, castHints, castNote, needLine, rowsOf, spreadCast, titleHints, type CastHint, type CastRow, type TpCast } from "@/lib/cast";
import { plural } from "@/lib/plural";

type Hint = { value: string; sub?: string; title?: string };

// Поле с подсказками: стрелки выбирают, Enter подставляет, Escape закрывает. Выбор мышью не уводит фокус из поля.
function HintField({ id, value, placeholder, label, hints, openOnFocus = false, onChange, onPick }: {
  id: string;
  value: string;
  placeholder: string;
  label: string;
  hints: Hint[];
  openOnFocus?: boolean;
  onChange: (value: string) => void;
  onPick: (hint: Hint) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = `${id}-hints`;
  const shown = open ? hints : [];
  const current = active >= 0 && active < shown.length ? active : -1;

  useEffect(() => {
    if (current >= 0) document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  const pick = (hint: Hint) => {
    setOpen(false);
    setActive(-1);
    onPick(hint);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hints.length) return;
      e.preventDefault();
      setOpen(true);
      const n = hints.length;
      setActive(e.key === "ArrowDown" ? (current + 1) % n : current <= 0 ? n - 1 : current - 1);
    } else if (e.key === "Enter" && current >= 0) {
      e.preventDefault();
      pick(shown[current]);
    } else if (e.key === "Escape" && shown.length) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => openOnFocus && setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={shown.length > 0 ? listId : undefined}
        aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
        autoComplete="off"
        className="field"
      />
      {shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-[calc(100%+4px)] z-20 grid max-h-66 w-max min-w-full max-w-[min(360px,80vw)] gap-0.5 overflow-y-auto rounded-[var(--r-surface)] bg-card p-1 shadow-[var(--float)]"
        >
          {shown.map((hint, i) => (
            <li
              key={hint.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(hint)}
              className={`grid cursor-pointer rounded-[var(--r-ctl)] px-2 py-1.5 hover:bg-[var(--hover)] ${i === current ? "bg-[var(--hover)]" : ""}`}
            >
              <span className="t-label">{hint.value}</span>
              {hint.sub && <span className="t-caption text-[var(--ink-3)]">{hint.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Status = { ok: boolean; text: string } | null;

// Состав исполнителей: кто нужен — из ТЗ, людей участник вписывает под эту закупку. Справочника нет:
// состав от закупки к закупке свой, а подсказки при наборе фамилии — люди из составов других закупок.
export function CastPanel({ cast, onChange, history, sample, open, onToggle }: {
  cast: TpCast;
  onChange: (cast: TpCast) => void;
  history: CastHint[];
  // Пример списка для «Вставить пример» — только в примере закупки.
  sample?: string;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  // null — поле списка закрыто.
  const [paste, setPaste] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // Куда перевести фокус после перерисовки: в новую строку, на «Добавить…», в поле списка.
  const focusNext = useRef<string | null>(null);
  const checks = castCheck(cast);
  const todo = checks.some((c) => !c.ok);

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const change = (next: TpCast) => {
    setStatus(null);
    onChange(next);
  };
  const setRow = (id: string, patch: Partial<CastRow>) => change({ ...cast, rows: cast.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRow = (group: string) => {
    const id = crypto.randomUUID();
    focusNext.current = `cast-name-${id}`;
    change({ ...cast, rows: [...cast.rows, { id, group, name: "", title: "" }] });
  };
  const removeRow = (row: CastRow) => {
    focusNext.current = `cast-add-${row.group}`;
    change({ ...cast, rows: cast.rows.filter((r) => r.id !== row.id) });
  };
  const togglePaste = () => {
    focusNext.current = paste === null ? "cast-paste" : "cast-paste-open";
    setPaste(paste === null ? "" : null);
    setStatus(null);
  };
  const split = () => {
    const text = paste ?? "";
    const { cast: next, added } = spreadCast(cast, text, () => crypto.randomUUID());
    if (!added) {
      focusNext.current = "cast-paste";
      setStatus({ ok: false, text: text.trim() ? "Все из списка уже в составе." : "Вставьте список — по человеку в строке." });
      return;
    }
    focusNext.current = "cast-paste-open";
    onChange(next);
    setPaste(null);
    setStatus({ ok: true, text: `Добавил из списка: ${added} ${plural(added, "человек", "человека", "человек")}. Проверьте, кто куда попал.` });
  };

  return (
    <Island
      id="tp-cast"
      level={3}
      title={
        <>
          Состав исполнителей
          {todo && <span className="t-tag text-[var(--warn)]">впишите исполнителей</span>}
        </>
      }
      sub="Кто выступит в этот раз, знаете только вы. ИИ фамилий не видит и не придумывает."
      action={
        <button id="cast-paste-open" type="button" aria-expanded={paste !== null} onClick={togglePaste} className="btn btn-line btn-xs">
          Вставить списком
        </button>
      }
    >
      <div className="@container grid gap-3 px-[var(--pad)] pb-[var(--pad)]">
        <div className="grid gap-1">
          <p className="text-[var(--ink-3)]">
            В ТЗ{cast.clause ? `, п. ${cast.clause}` : ""}: {cast.requirement}
          </p>
          <SourceQuote source="цитата из ТЗ" quote={cast.quote} verified={cast.verified} what="состав" open={open === "cast"} onToggle={() => onToggle("cast")} />
        </div>

        {paste !== null && (
          <div className="grid gap-2 rounded-[var(--r-surface)] bg-[var(--paper-2)] p-3">
            <label htmlFor="cast-paste" className="t-strong">
              Список исполнителей: по человеку в строке — ФИО, через запятую роль и звание
            </label>
            <textarea
              id="cast-paste"
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Соколова Мария Андреевна, вокал, заслуженная артистка России"
              className="field field-sizing-content h-auto max-h-80 min-h-28 resize-none py-1.5"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" onClick={split} className="btn btn-xs">
                Разложить по строкам
              </button>
              <button type="button" onClick={togglePaste} className="btn btn-line btn-xs">
                Отмена
              </button>
              {sample && (
                <button type="button" onClick={() => setPaste(sample)} className="link link-quiet">
                  Вставить пример
                </button>
              )}
            </div>
          </div>
        )}
        {status && (
          <p role="status" className={`t-strong ${status.ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>
            {status.text}
          </p>
        )}

        <ul aria-label="Сверка с ТЗ" className="grid gap-1">
          {checks.map((c, i) => (
            <li key={cast.groups[i].key} className={`t-strong flex items-start gap-1.5 ${c.ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>
              {c.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> : <WarningIcon className="mt-0.5 size-4 shrink-0" />}
              <span>{c.text}</span>
            </li>
          ))}
        </ul>

        {cast.groups.map((g, gi) => (
          <div key={g.key} role="group" aria-labelledby={`cast-${g.key}`} className="grid gap-2 border-t border-[var(--line)] pt-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h4 id={`cast-${g.key}`} className="t-section">
                {g.title}
              </h4>
              <span className="text-[var(--ink-3)]">{needLine(g)}</span>
            </div>
            {rowsOf(cast, g.key).length > 0 && (
              <ol className="grid gap-2">
                {rowsOf(cast, g.key).map((row, i) => {
                  const who = `${g.one} ${i + 1}`;
                  const note = castNote(g, row, checks[gi].rankFail);
                  return (
                    <li key={row.id} className="grid grid-cols-[16px_minmax(0,1fr)_28px] items-start gap-x-2 gap-y-1.5">
                      <span aria-hidden className="t-num pt-2 text-right text-[var(--ink-3)]">
                        {i + 1}
                      </span>
                      <div className="grid min-w-0 gap-1.5 @min-[520px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                        <HintField
                          id={`cast-name-${row.id}`}
                          value={row.name}
                          placeholder="Фамилия, имя, отчество"
                          label={`${who}: фамилия, имя, отчество`}
                          hints={castHints(history, cast, row.name).map((h) => ({
                            value: h.name,
                            title: h.title,
                            sub: [h.title, `из закупки «${h.from}»`].filter(Boolean).join(" · "),
                          }))}
                          onChange={(name) => setRow(row.id, { name })}
                          // Человек из прошлой закупки — вместе со званием, если звание ещё не вписано.
                          onPick={(h) => setRow(row.id, { name: h.value, ...(h.title && !row.title.trim() ? { title: h.title } : {}) })}
                        />
                        <HintField
                          id={`cast-title-${row.id}`}
                          value={row.title}
                          placeholder={g.rank !== "none" ? "Почётное звание" : "Звание, если есть"}
                          label={`${who}: почётное звание`}
                          hints={titleHints(row.title).map((value) => ({ value }))}
                          openOnFocus={g.rank !== "none" && !row.title.trim()}
                          onChange={(title) => setRow(row.id, { title })}
                          onPick={(h) => setRow(row.id, { title: h.value })}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(row)}
                        aria-label={`Убрать: ${who.toLowerCase()}`}
                        className="icon-btn mt-0.5 size-7 text-[var(--ink-3)]"
                      >
                        <CrossIcon className="size-4" />
                      </button>
                      {note && (
                        <p className="t-tag col-span-2 col-start-2 flex items-start gap-1.5 text-[var(--warn)]">
                          <WarningIcon className="mt-px size-3.5 shrink-0" />
                          {note}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <button
              id={`cast-add-${g.key}`}
              type="button"
              onClick={() => addRow(g.key)}
              className="link t-strong ml-6 inline-flex items-center gap-1 justify-self-start no-underline"
            >
              <PlusIcon className="size-4" />
              Добавить {g.acc}
            </button>
          </div>
        ))}

        {cast.replace.rule && (
          <div className="grid gap-1 border-t border-[var(--line)] pt-3">
            <p className="text-[var(--ink-2)]">Состав поменяется после подачи? {cast.replace.rule}</p>
            <SourceQuote
              source={cast.replace.source || "цитата из проекта контракта"}
              quote={cast.replace.quote}
              verified={cast.replace.verified}
              what="условие"
              open={open === "cast-replace"}
              onToggle={() => onToggle("cast-replace")}
            />
          </div>
        )}
      </div>
    </Island>
  );
}
