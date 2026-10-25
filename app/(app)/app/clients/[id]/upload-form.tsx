"use client";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { guessPapers, uploadDocument } from "@/app/(app)/actions";

type Row = { name: string; type: string; custom: string; work: string; period: string };
const MAX = 50 * 1024 * 1024;

// One drop zone for one or many files. Each file's type, work and period start from what its
// name says, by the rules that file mail; the person checks them, and none is left at Other.
export function UploadForm({ clientId, types, typeWork, works, periods, keep, children }: { clientId: string; types: string[]; typeWork: Record<string, string>; works: [string, string][]; periods: [string, string][]; keep: boolean; children?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [tooBig, setTooBig] = useState(false);

  const pick = async () => {
    const files = [...(input.current?.files ?? [])];
    setTooBig(files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > MAX);
    if (!files.length) return setRows(null);
    setReading(true);
    const guesses = await guessPapers(files.map((file) => file.name)).catch(() => []);
    setRows(files.map((file, at) => ({ name: file.name, custom: "", ...(guesses[at] ?? { type: "", work: "", period: "" }) })));
    setReading(false);
  };
  const change = (at: number, field: keyof Row, value: string) =>
    setRows((all) => all?.map((row, index) => (index !== at ? row : { ...row, [field]: value, ...(field === "type" && typeWork[value] && { work: typeWork[value] }) })) ?? null);

  return (
    <form action={uploadDocument} className="upload-form">
      <input type="hidden" name="client" value={clientId} />
      <label
        className={`upload-drop${over ? " is-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (input.current && event.dataTransfer.files.length) {
            input.current.files = event.dataTransfer.files;
            void pick();
          }
        }}
      >
        <FileUp size={18} aria-hidden />
        <strong>{rows?.length ? `${rows.length} ${rows.length === 1 ? "file" : "files"} chosen` : "Drop files here, or click to choose"}</strong>
        <span className="hint">Up to 20 files and 50 MB together. A ZIP is unpacked.</span>
        <input ref={input} className="sr-only" name="file" type="file" multiple aria-label="Files" onChange={() => void pick()} />
      </label>
      {tooBig && (
        <p className="alert" role="alert">
          Choose up to 20 files of 50 MB or less together.
        </p>
      )}
      {reading && <p className="hint">Reading the file names.</p>}
      {rows?.map((row, at) => (
        <fieldset key={`${at}-${row.name}`} className="upload-file fields">
          <legend>{row.name}</legend>
          <div>
            <label htmlFor={`upload-type-${at}`}>Type</label>
            <select id={`upload-type-${at}`} name="type" required value={row.type} onChange={(event) => change(at, "type", event.target.value)}>
              <option value="">Choose</option>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
              <option value="Other">Other, named below</option>
            </select>
          </div>
          {/* Every file sends a name, so the server reads each file's values by its place. */}
          {row.type === "Other" ? (
            <div className="upload-name">
              <label htmlFor={`upload-custom-${at}`}>Name</label>
              <input id={`upload-custom-${at}`} name="custom" maxLength={80} required value={row.custom} onChange={(event) => change(at, "custom", event.target.value)} placeholder="HDFC loan sanction letter" />
              {keep && (
                <label className="check">
                  <input type="checkbox" name="keep" value={at} />
                  Add to our list of paper types
                </label>
              )}
            </div>
          ) : (
            <input type="hidden" name="custom" value="" />
          )}
          <div>
            <label htmlFor={`upload-work-${at}`}>Work</label>
            <select id={`upload-work-${at}`} name="work" required value={row.work} onChange={(event) => change(at, "work", event.target.value)}>
              <option value="">Choose</option>
              {works.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`upload-period-${at}`}>Period</label>
            <select id={`upload-period-${at}`} name="period" required value={row.period} onChange={(event) => change(at, "period", event.target.value)}>
              <option value="">Choose</option>
              {periods.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="none">No period</option>
            </select>
          </div>
        </fieldset>
      ))}
      {!!rows?.length && children}
      <Upload count={rows?.length ?? 0} disabled={!rows?.length || reading || tooBig} />
    </form>
  );
}

function Upload({ count, disabled }: { count: number; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="b b-primary" type="submit" disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? "Uploading" : count > 1 ? `Upload ${count} files` : "Upload"}
    </button>
  );
}
