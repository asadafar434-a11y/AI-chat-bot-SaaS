"use client";

import { useRef, useState } from "react";
import { UploadIcon } from "lucide-react";
import { ACCEPTED_FILES } from "@/lib/read-documents";

type FileDropProps = {
  hint: string;
  button: string;
  onFiles: (files: File[]) => void;
  onSample?: () => void;
};

export function FileDrop({ hint, button, onFiles, onSample }: FileDropProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={`mt-7 grid justify-items-center gap-4 rounded-[var(--r-surface)] px-6 py-9 text-center ${
        over ? "bg-[var(--brand-tint)] ring-2 ring-primary ring-inset" : "bg-card ring-2 ring-[var(--edge-2)] ring-inset"
      }`}
    >
      <UploadIcon className="size-8 text-primary" />
      <p className="text-[var(--ink-2)]">{hint}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="min-h-[52px] rounded-[var(--r-ctl)] bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90"
      >
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
      {onSample && (
        <span className="text-[15px] text-muted-foreground">
          или{" "}
          <button type="button" onClick={onSample} className="font-semibold text-primary underline underline-offset-4">
            посмотреть на примере
          </button>
        </span>
      )}
    </div>
  );
}
