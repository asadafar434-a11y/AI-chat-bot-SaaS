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
      className={`grid justify-items-center gap-4 rounded-[var(--r-surface)] border-[1.5px] border-dashed px-6 py-10 text-center ${
        over ? "border-primary bg-[var(--brand-tint)]" : "border-[var(--edge-2)] bg-[var(--canvas)]"
      }`}
    >
      <span className="grid size-14 place-items-center rounded-[var(--r-ctl)] bg-[var(--brand-tint)] text-primary">
        <UploadIcon className="size-[26px]" />
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
