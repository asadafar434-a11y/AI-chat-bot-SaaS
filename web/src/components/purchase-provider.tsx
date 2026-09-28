"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { NewerDataError } from "@/lib/data-format";
import type { Purchase } from "@/lib/purchase";
import { deletePurchase, getDocuments, getPurchase, savePurchase, savePurchaseWithDocuments, scansOf } from "@/lib/purchase-store";
import type { SentDocument } from "@/lib/read-documents";
import { isStaleSample, SAMPLE_DOCUMENTS, upgradeSample } from "@/lib/sample-purchase";

type PurchaseContextValue = {
  purchase: Purchase;
  documents: SentDocument[];
  // Правки сохраняются с задержкой: набор текста в черновике не пишет в базу на каждую букву.
  update: (patch: Partial<Purchase>) => void;
  replaceDocuments: (documents: SentDocument[], patch: Partial<Purchase>) => Promise<void>;
  remove: () => Promise<void>;
};

const PurchaseContext = createContext<PurchaseContextValue | null>(null);

export function usePurchase() {
  const value = useContext(PurchaseContext);
  if (!value) throw new Error("usePurchase работает только внутри закупки");
  return value;
}

type Loaded =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed"; newer: boolean }
  | { status: "ready"; purchase: Purchase; documents: SentDocument[] };

const SAVE_DELAY = 400;

export function PurchaseProvider({ id, children }: { id: string; children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [saveError, setSaveError] = useState(false);
  const latest = useRef<Purchase | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPurchase(id), getDocuments(id)]).then(
      async ([saved, savedDocuments]) => {
        // Пример из старой версии приложения обновляется при открытии; не вышло — открывается как был.
        const upgraded = saved && isStaleSample(saved) ? await upgradeSample(saved).catch(() => null) : null;
        const stored = upgraded ?? saved;
        const documents = upgraded ? SAMPLE_DOCUMENTS : savedDocuments;
        if (cancelled) return;
        // Список сканов у старой закупки появится с первым же сохранением.
        const purchase = stored && { ...stored, scans: stored.scans ?? scansOf(documents) };
        latest.current = purchase ?? null;
        setLoaded(purchase ? { status: "ready", purchase, documents } : { status: "missing" });
      },
      (error) => !cancelled && setLoaded({ status: "failed", newer: error instanceof NewerDataError })
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    savePurchase(latest.current).then(
      () => setSaveError(false),
      () => setSaveError(true)
    );
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (patch: Partial<Purchase>) => {
      if (!latest.current) return;
      const purchase = { ...latest.current, ...patch };
      latest.current = purchase;
      setLoaded((s) => (s.status === "ready" ? { ...s, purchase } : s));
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush]
  );

  const replaceDocuments = useCallback(async (documents: SentDocument[], patch: Partial<Purchase>) => {
    if (!latest.current) return;
    const purchase = await savePurchaseWithDocuments({ ...latest.current, ...patch }, documents);
    latest.current = purchase;
    dirty.current = false;
    setLoaded({ status: "ready", purchase, documents });
  }, []);

  const remove = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    latest.current = null;
    await deletePurchase(id);
  }, [id]);

  if (loaded.status === "loading") return null;

  if (loaded.status !== "ready") {
    return (
      <div className="island grid max-w-[560px] justify-items-start gap-2 p-[var(--pad)]">
        <Link href="/purchases" className="link link-quiet t-body mb-2 inline-flex items-center gap-1.5 no-underline split:hidden">
          <ArrowLeftIcon aria-hidden className="size-4" />
          Все закупки
        </Link>
        <h2 className="t-title">{loaded.status === "missing" ? "Закупка не найдена" : "Не удалось открыть закупку"}</h2>
        <p className="t-body text-[var(--ink-2)]">
          {loaded.status === "missing"
            ? "Возможно, её удалили. Закупки хранятся в браузере — в другом браузере или на другом компьютере их не видно."
            : loaded.newer
              ? "Её сохранила более новая версия приложения — обновите страницу, и закупка откроется."
              : "Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные."}
        </p>
      </div>
    );
  }

  return (
    <PurchaseContext.Provider value={{ purchase: loaded.purchase, documents: loaded.documents, update, replaceDocuments, remove }}>
      {saveError && (
        <div className="flex-none pb-2">
          <Note tone="warn" icon={WarningIcon}>
            Не получилось сохранить изменения в браузере. Не закрывайте страницу и попробуйте ещё раз.
          </Note>
        </div>
      )}
      {children}
    </PurchaseContext.Provider>
  );
}
