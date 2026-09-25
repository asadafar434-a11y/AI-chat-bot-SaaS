"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { upgradePurchase, type Purchase } from "@/lib/purchase";
import { deletePurchase, getDocuments, getPurchase, savePurchase, savePurchaseWithDocuments } from "@/lib/purchase-store";
import type { SentDocument } from "@/lib/read-documents";

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
  | { status: "failed" }
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
      ([stored, documents]) => {
        if (cancelled) return;
        const purchase = stored && upgradePurchase(stored);
        latest.current = purchase ?? null;
        setLoaded(purchase ? { status: "ready", purchase, documents } : { status: "missing" });
      },
      () => !cancelled && setLoaded({ status: "failed" })
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
    const purchase = { ...latest.current, ...patch };
    await savePurchaseWithDocuments(purchase, documents);
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
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/">Мои закупки</BackLink>
        <PageTitle className="mt-4">
          {loaded.status === "missing" ? "Закупка не найдена" : "Не удалось открыть закупку"}
        </PageTitle>
        <p className="mt-3 max-w-[46ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          {loaded.status === "missing"
            ? "Возможно, её удалили. Закупки хранятся в браузере — в другом браузере или на другом компьютере их не видно."
            : "Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные."}
        </p>
      </main>
    );
  }

  return (
    <PurchaseContext.Provider value={{ purchase: loaded.purchase, documents: loaded.documents, update, replaceDocuments, remove }}>
      {saveError && (
        <div className="mx-auto w-full max-w-[680px] px-4 pt-3">
          <Note tone="warn" icon={AlertTriangleIcon}>
            Не получилось сохранить изменения в браузере. Не закрывайте страницу и попробуйте ещё раз.
          </Note>
        </div>
      )}
      {children}
    </PurchaseContext.Provider>
  );
}
