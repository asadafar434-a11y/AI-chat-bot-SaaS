"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { MenuRow } from "@/components/menu-row";
import { PageTitle } from "@/components/page-title";
import { getProfile, listSamples } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";

// «Мои данные» — то, что относится к участнику, а не к закупке: реквизиты и образцы документов.
export default function MePage() {
  const [filled, setFilled] = useState<number | null>(null);
  const [samples, setSamples] = useState<number | null>(null);

  useEffect(() => {
    getProfile().then((p) => setFilled(filledCount(p)), () => setFilled(0));
    listSamples().then((list) => setSamples(list.length), () => setSamples(0));
  }, []);

  const total = PROFILE_KEYS.length;
  const profileSub =
    filled === null
      ? "…"
      : filled === 0
        ? "Не заполнены — впишите один раз, дальше они сами попадут в анкету, декларацию и цену"
        : `Заполнено ${filled} из ${total} · попадают в анкету, декларацию и цену, но никогда — в техническое предложение`;
  const samplesSub =
    samples === null
      ? "…"
      : samples === 0
        ? "Загрузите свои поданные технические предложения — новые будут написаны так же"
        : `${samples} ${plural(samples, "образец", "образца", "образцов")} · по ним пишутся новые технические предложения`;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/">Мои закупки</BackLink>
        <PageTitle className="mt-4">Мои данные</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          То, что относится к вам, а не к закупке. Хранится только в этом браузере.
        </p>
        <ul className="mt-6 overflow-hidden rounded-[var(--r-surface)] bg-card">
          <MenuRow href="/me/profile" title="Реквизиты" sub={profileSub} />
          <MenuRow href="/me/samples" title="Образцы документов" sub={samplesSub} />
        </ul>
      </main>
    </div>
  );
}
