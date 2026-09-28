"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { FileUploadIcon } from "@/components/icons";
import { ACCEPTED_FILES } from "@/lib/read-documents";
import { readScanOcr, saveScanOcr } from "@/lib/scan-setting";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

type FileDropProps = {
  hint: string;
  button: string;
  onFiles: (files: File[]) => void;
  onSample?: () => void;
};

export function FileDrop({ hint, button, onFiles, onSample }: FileDropProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Распознавание сканов: настройка браузера, на сервере — включено по умолчанию.
  const stored = useSyncExternalStore(subscribe, () => readScanOcr(), () => true);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const ocr = chosen ?? stored;

  const pick = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={`grid justify-items-center gap-3 rounded-[var(--r-surface)] border-[1.5px] border-dashed px-5 py-6 text-center ${
        over ? "border-primary bg-[var(--brand-tint)]" : "border-[var(--edge-2)] bg-[var(--canvas)]"
      }`}
    >
      <span className="grid size-10 place-items-center rounded-[var(--r-ctl)] bg-[var(--brand-tint)] text-primary">
        <FileUploadIcon className="size-5" />
      </span>
      <p className="max-w-[46ch] text-[var(--ink-2)]">{hint}</p>
      <button type="button" onClick={() => input.current?.click()} className="btn btn-lg">
        {button}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => { pick(e.currentTarget.files); e.currentTarget.value = ""; }}
      />
      <label className="t-caption flex max-w-[46ch] items-start gap-2 text-left text-[var(--ink-3)]">
        <input
          type="checkbox"
          checked={ocr}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            saveScanOcr(on);
            setChosen(on);
          }}
          className="mt-0.5 size-4 flex-none accent-[var(--brand)]"
        />
        <span>
          Распознавать сканы и фото через ИИ. Картинка уходит в США как есть: персональные данные на ней не скрываются — паспорта и
          анкеты со скана лучше не загружать.
        </span>
      </label>
      {onSample && (
        <span className="text-[var(--ink-3)]">
          или{" "}
          <button type="button" onClick={onSample} className="link">
            посмотреть на примере
          </button>
        </span>
      )}
    </div>
  );
}
