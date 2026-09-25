"use client";

import { useEffect, useState } from "react";
import { BackLink } from "@/components/back-link";
import { MenuRow } from "@/components/menu-row";
import { PageTitle } from "@/components/page-title";
import { getProfile, listMyDocuments, type MyDocument } from "@/lib/me-store";
import { DOC_KIND_KEYS, DOC_KINDS } from "@/lib/my-docs";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";

// «Мои данные» — то, что относится к участнику, а не к закупке: реквизиты и его документы.
export default function MePage() {
  const [filled, setFilled] = useState<number | null>(null);
  const [docs, setDocs] = useState<MyDocument[] | null>(null);

  useEffect(() => {
    getProfile().then((p) => setFilled(filledCount(p)), () => setFilled(0));
    listMyDocuments().then(setDocs, () => setDocs([]));
  }, []);

  const total = PROFILE_KEYS.length;
  const profileSub =
    filled === null
      ? "…"
      : filled === 0
        ? "Не заполнены — впишите один раз или загрузите свои документы, дальше реквизиты сами попадут в анкету, декларацию и цену"
        : `Заполнено ${filled} из ${total} · попадают в анкету, декларацию и цену, но никогда — в техническое предложение`;
  const kinds = DOC_KIND_KEYS.filter((kind) => docs?.some((d) => d.kinds.includes(kind))).map((kind) => DOC_KINDS[kind].few);
  const docsSub =
    docs === null
      ? "…"
      : docs.length === 0
        ? "Загрузите всё, что подавали раньше, — новые документы будут написаны так же, как ваши"
        : `${docs.length} ${plural(docs.length, "документ", "документа", "документов")}: ${kinds.join(", ")} · по ним пишутся новые`;

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/">Мои закупки</BackLink>
        <PageTitle className="mt-4">Мои данные</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          То, что относится к вам, а не к закупке. Хранится только в этом браузере.
        </p>
        <ul className="mt-6 overflow-hidden rounded-[var(--r-surface)] bg-card">
          <MenuRow href="/me/profile" title="Реквизиты" sub={profileSub} />
          <MenuRow href="/me/documents" title="Мои документы" sub={docsSub} />
        </ul>
      </main>
    </div>
  );
}
