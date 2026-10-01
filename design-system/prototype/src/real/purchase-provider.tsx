import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NewerDataError } from '@/lib/data-format';
import { stampsOf } from '@/lib/doc-changes';
import type { Purchase } from '@/lib/purchase';
import { deletePurchase, getDocuments, getPurchase, savePurchase, savePurchaseWithDocuments, scansOf } from '@/lib/purchase-store';
import type { SentDocument } from '@/lib/read-documents';
import { isStaleSample, SAMPLE_DOCUMENTS, upgradeSample } from '@/lib/sample-purchase';
import { setActivePurchase } from './active-purchase';

// Открытая закупка: хранится в браузере (IndexedDB), как в приложении web/src/components/purchase-provider.tsx.
// Правки пишутся с задержкой — набор текста в поле не сохраняет закупку на каждую букву.
type Value = {
  purchase: Purchase;
  documents: SentDocument[];
  update: (patch: Partial<Purchase>) => void;
  // Правка может быть функцией от закупки «на этот момент»: пока ИИ читал документы, участник мог что-то отметить или вписать.
  replaceDocuments: (documents: SentDocument[], patch: Partial<Purchase> | ((latest: Purchase) => Partial<Purchase>)) => Promise<void>;
  remove: () => Promise<void>;
  saveError: boolean;
};

const Ctx = createContext<Value | null>(null);

export function usePurchase() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePurchase работает только внутри закупки');
  return value;
}

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; newer: boolean }
  | { status: 'ready'; purchase: Purchase; documents: SentDocument[] };

const SAVE_DELAY = 400;

export function PurchaseProvider({ id, onMissing, children }: { id: string; onMissing: () => void; children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [saveError, setSaveError] = useState(false);
  const latest = useRef<Purchase | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPurchase(id), getDocuments(id)]).then(
      async ([saved, savedDocuments]) => {
        // Пример из старой версии обновляется при открытии; не вышло — открывается как был.
        const upgraded = saved && isStaleSample(saved) ? await upgradeSample(saved).catch(() => null) : null;
        const stored = upgraded ?? saved;
        const documents = upgraded ? SAMPLE_DOCUMENTS : savedDocuments;
        if (cancelled) return;
        // Закупка, сохранённая до пометки «требует проверки», узнаёт документы по самим документам; ТП считается составленным
        // по ним — что изменится дальше, будет видно (lib/doc-changes.ts).
        const docs = stored?.docs ?? stampsOf(documents);
        const purchase = stored && { ...stored, scans: stored.scans ?? scansOf(documents), docs, ...(stored.tp && !stored.tpDocs && { tpDocs: docs }) };
        latest.current = purchase ?? null;
        setLoaded(purchase ? { status: 'ready', purchase, documents } : { status: 'missing' });
      },
      (error) => !cancelled && setLoaded({ status: 'failed', newer: error instanceof NewerDataError }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (loaded.status === 'missing') onMissing();
  }, [loaded.status, onMissing]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    savePurchase(latest.current).then(
      () => setSaveError(false),
      () => setSaveError(true),
    );
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (patch: Partial<Purchase>) => {
      if (!latest.current) return;
      const purchase = { ...latest.current, ...patch };
      latest.current = purchase;
      setLoaded((s) => (s.status === 'ready' ? { ...s, purchase } : s));
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  const replaceDocuments = useCallback(async (documents: SentDocument[], patch: Partial<Purchase> | ((latest: Purchase) => Partial<Purchase>)) => {
    if (!latest.current) return;
    const changes = typeof patch === 'function' ? patch(latest.current) : patch;
    const purchase = await savePurchaseWithDocuments({ ...latest.current, ...changes }, documents);
    latest.current = purchase;
    dirty.current = false;
    setLoaded({ status: 'ready', purchase, documents });
  }, []);

  const remove = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    latest.current = null;
    await deletePurchase(id);
  }, [id]);

  // Открытую закупку видит и ассистент в окне чата: отвечает по её документам и хранит в ней переписку.
  const ready = loaded.status === 'ready' ? loaded : null;
  useEffect(() => {
    if (!ready) return;
    setActivePurchase({ purchase: ready.purchase, documents: ready.documents, update });
    return () => setActivePurchase(null);
  }, [ready, update]);

  if (loaded.status === 'loading') return null;
  if (loaded.status === 'failed') {
    return (
      <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        {loaded.newer
          ? 'Закупку сохранила более новая версия приложения — обновите страницу, и она откроется.'
          : 'Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные.'}
      </p>
    );
  }
  if (loaded.status !== 'ready') return null;

  return (
    <Ctx.Provider value={{ purchase: loaded.purchase, documents: loaded.documents, update, replaceDocuments, remove, saveError }}>
      {children}
    </Ctx.Provider>
  );
}
