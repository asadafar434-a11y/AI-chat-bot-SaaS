"use client";

import { useEffect, useState } from "react";

export function WorkingSteps({ steps, sub = "Обычно это занимает 1–2 минуты." }: { steps: string[]; sub?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 2500);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="grid gap-1 py-6" aria-live="polite">
      <p className="t-section animate-pulse">{steps[step]}</p>
      <p className="text-[var(--ink-3)]">{sub}</p>
    </div>
  );
}
