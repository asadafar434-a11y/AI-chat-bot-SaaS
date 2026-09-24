"use client";

import { useEffect, useState } from "react";

export function WorkingSteps({ steps }: { steps: string[] }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 2500);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="mt-12 grid gap-2" aria-live="polite">
      <p className="animate-pulse text-lg font-semibold">{steps[step]}</p>
      <p className="text-[15px] text-muted-foreground">Обычно это занимает 1–2 минуты.</p>
    </div>
  );
}
