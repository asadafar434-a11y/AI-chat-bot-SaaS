"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { getProfile, saveProfile } from "@/lib/me-store";
import { PROFILE_GROUPS, type Profile, type ProfileKey } from "@/lib/profile";

type SaveState = "idle" | "saving" | "saved" | "failed";

// Реквизиты сохраняются сами, пока их вписывают: отдельной кнопки нет, чтобы ничего не потерять.
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getProfile().then(setProfile, () => setLoadError(true));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function change(key: ProfileKey, value: string) {
    if (!profile) return;
    const next = { ...profile, [key]: value };
    setProfile(next);
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveProfile(next).then(
        () => setSave("saved"),
        () => setSave("failed")
      );
    }, 400);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/me">Мои данные</BackLink>
        <PageTitle className="mt-4">Реквизиты</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          Впишите один раз — дальше они сами попадут в анкету, декларацию, предложение о цене и подпись. В техническое предложение реквизиты не попадают никогда: его подают анонимно.
        </p>

        {loadError && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
            Браузер не дал открыть сохранённые реквизиты. Обновите страницу.
          </Note>
        )}

        {profile &&
          PROFILE_GROUPS.map((group) => (
            <section key={group.title} className="mt-7">
              <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{group.title}</h2>
              <div className="grid gap-4 rounded-[var(--r-card)] bg-card p-[18px]">
                {group.fields.map((field) => (
                  <label key={field.key} className="grid gap-1.5">
                    <span className="text-[14.5px] font-semibold">{field.label}</span>
                    <input
                      value={profile[field.key]}
                      onChange={(e) => change(field.key, e.target.value)}
                      placeholder={field.example}
                      className="h-11 rounded-[var(--r-ctl)] bg-muted px-3 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary"
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}

        <p className="sticky bottom-0 mt-4 bg-gradient-to-b from-transparent to-background to-40% pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-5 text-[14.5px] text-muted-foreground" aria-live="polite">
          {save === "saving" && "Сохраняю…"}
          {save === "saved" && "Сохранено в этом браузере."}
          {save === "failed" && <span className="font-semibold text-[var(--warn)]">Не получилось сохранить — попробуйте ещё раз.</span>}
        </p>
      </main>
    </div>
  );
}
