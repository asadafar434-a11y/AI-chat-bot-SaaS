"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Note } from "@/components/note";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { STORAGE_ERROR, usePurchases } from "@/lib/use-purchases";

// Основная панель раздела «Закупки», пока закупка не выбрана. На широком экране сразу открывается
// самая срочная — как переписка в мессенджере; на узком здесь виден только список.
export default function PurchasesPage() {
  const router = useRouter();
  const { purchases } = usePurchases();
  const [sampleError, setSampleError] = useState(false);
  const firstId = purchases?.[0]?.id;

  useEffect(() => {
    if (!firstId) return;
    const wide = window.matchMedia("(min-width: 73.75rem)");
    const open = () => wide.matches && router.replace(`/p/${firstId}`);
    open();
    wide.addEventListener("change", open);
    return () => wide.removeEventListener("change", open);
  }, [firstId, router]);

  async function sample() {
    setSampleError(false);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setSampleError(true);
    }
  }

  if (purchases?.length !== 0) return null;

  return (
    <div className="island grid max-w-[560px] justify-items-start gap-3 p-[var(--pad)]">
      <h2 className="t-title">Первая закупка</h2>
      <p className="t-body text-[var(--ink-2)]">
        Загрузите документы закупки — выпишу требования и сроки, составлю черновик технического предложения и отвечу на вопросы по документам.
      </p>
      {sampleError && <Note tone="warn">{STORAGE_ERROR}</Note>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/new" className="btn">
          <PlusIcon />
          Новая закупка
        </Link>
        <span className="t-body text-[var(--ink-3)]">
          или{" "}
          <button type="button" onClick={() => void sample()} className="link">
            посмотреть на примере
          </button>
        </span>
      </div>
    </div>
  );
}
