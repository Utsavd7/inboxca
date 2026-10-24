"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkIncoming, describeDiskFiles, incomingLinks } from "@/app/(app)/actions";
import { contentHash } from "@/src/lib/content-hash";

type Picked = { file: File; path: string; final: boolean; year: string };
const LIMIT = 150 * 1024 * 1024;
const size = (bytes: number) => (bytes < 1024 ** 3 ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`);
const time = (seconds: number) =>
  seconds < 120 ? "under 2 minutes" : seconds < 5400 ? `about ${Math.round(seconds / 60)} minutes` : seconds < 129600 ? `about ${Math.round(seconds / 3600)} hours` : `about ${Math.round(seconds / 86400)} days`;

// Files still on a computer or hard disk (PLAN.md 5.16): the owner chooses a folder, sees what
// each choice holds and how long it takes on this line, and each file then goes from this
// browser straight into the drive's Incoming folder, checked against its checksum. Choosing
// the same folder again after a break sends only what is not there yet.
export function DiskUpload({ incoming }: { incoming?: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<Picked[] | null>(null);
  const [speed, setSpeed] = useState(0);
  const [scope, setScope] = useState<"final" | "year" | "all">("final");
  const [year, setYear] = useState("");
  const [sending, setSending] = useState<{ done: number; total: number; left: string; taken: string[]; failed: string[]; finished: boolean } | null>(null);
  const years = [...new Set(files?.map((file) => file.year))].sort().reverse();
  const chosenYear = year || years[0];
  const choose = (which: typeof scope) => (files ?? []).filter((file) => file.file.size <= LIMIT && (which === "final" ? file.final : which === "year" ? file.year === chosenYear : true));
  const chosen = choose(scope);
  const tooBig = (files ?? []).filter((file) => file.file.size > LIMIT).length;

  const read = async (list: FileList | null) => {
    const all = [...(list ?? [])];
    setFiles(null);
    setSending(null);
    setYear("");
    const kinds: Awaited<ReturnType<typeof describeDiskFiles>> = [];
    for (let at = 0; at < all.length; at += 1000) kinds.push(...(await describeDiskFiles(all.slice(at, at + 1000).map((file) => file.webkitRelativePath || file.name))));
    setFiles(all.flatMap((file, at) => (kinds[at] ? [{ file, path: file.webkitRelativePath || file.name, ...kinds[at] }] : [])));
    // A quick test of this line: 2 MB sent to InboxCA and thrown away.
    const test = new Uint8Array(2 * 1024 * 1024);
    for (let at = 0; at < test.length; at += 65536) crypto.getRandomValues(test.subarray(at, at + 65536));
    const started = performance.now();
    await fetch("/app/import/upload", { method: "POST", body: test });
    setSpeed(test.length / Math.max(0.001, (performance.now() - started) / 1000));
  };

  const send = async () => {
    const state = { done: 0, total: chosen.length, left: "", taken: [] as string[], failed: [] as string[], finished: false };
    const started = performance.now();
    let bytes = 0;
    setSending({ ...state });
    for (let at = 0; at < chosen.length; at += 10) {
      const batch = await Promise.all(chosen.slice(at, at + 10).map(async (file) => ({ ...file, hash: await contentHash(file.file) })));
      let waiting = batch;
      // Up to three tries; a file whose checksum does not match in the drive is sent again.
      for (let round = 0; round < 3 && waiting.length; round++) {
        const links = await incomingLinks(waiting.map(({ path, hash }) => ({ path, hash }))).catch(() => []);
        const tries = waiting.map((file, index) => ({ ...file, link: links[index] }));
        state.taken.push(...tries.filter((file) => file.link === "taken").map((file) => file.path));
        const trying = tries.filter((file) => file.link !== "taken");
        await Promise.all(trying.map((file) => file.link && file.link !== "done" && fetch(file.link, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file.file }).catch(() => null)));
        const checked = await checkIncoming(trying.map(({ path, hash }) => ({ path, hash }))).catch(() => []);
        waiting = trying.filter((_, index) => !checked[index]);
      }
      state.failed.push(...waiting.map((file) => file.path));
      state.done += batch.length;
      bytes += batch.reduce((sum, file) => sum + file.file.size, 0);
      const rate = bytes / Math.max(0.001, (performance.now() - started) / 1000);
      state.left = time(chosen.slice(state.done).reduce((sum, file) => sum + file.file.size, 0) / rate);
      setSending({ ...state });
    }
    setSending({ ...state, finished: true });
    router.refresh();
  };

  return (
    <section className="panel" aria-labelledby="disk">
      <h2 id="disk">Files on a computer or hard disk</h2>
      <p className="hint">Each file goes from this browser straight into your drive&apos;s Incoming folder, then you sort it like any folder above. For hundreds of GB, your drive&apos;s own desktop app is easier: it keeps copying by itself for days.</p>
      <div className="disk-pick">
        <label htmlFor="disk-folder">Choose a folder</label>
        <input id="disk-folder" type="file" multiple disabled={!!sending && !sending.finished} onChange={(event) => read(event.target.files)} {...{ webkitdirectory: "" }} />
      </div>
      {files && (
        <fieldset className="disk-choose">
          <legend>Which files to send</legend>
          {(["final", "year", "all"] as const).map((which) => {
            const list = choose(which);
            const bytes = list.reduce((sum, file) => sum + file.file.size, 0);
            return (
              <label key={which} className="check">
                <input type="radio" name="disk-scope" checked={scope === which} onChange={() => setScope(which)} />
                {which === "final" ? "Final papers only (recommended)" : which === "year" ? "One year in full" : "Everything in this folder"}
                <span className="hint">
                  {list.length ? `${list.length} files, ${size(bytes)}${speed > 0 ? `, ${time(bytes / speed)}` : ""}` : "No files"}
                </span>
              </label>
            );
          })}
          {years.length > 1 && (
            <label>
              The year, for one year in full
              <select value={chosenYear} onChange={(event) => setYear(event.target.value)}>
                {years.map((choice) => (
                  <option key={choice}>{choice}</option>
                ))}
              </select>
            </label>
          )}
          {!!tooBig && <p className="hint">{tooBig} files are over 150 MB. Copy those with your drive&apos;s desktop app.</p>}
          <button className="b b-primary" type="button" disabled={!chosen.length || (!!sending && !sending.finished)} onClick={send}>
            {sending && !sending.finished ? "Sending" : "Send to your drive"}
          </button>
        </fieldset>
      )}
      {sending && (
        <div className="disk-progress" role="status">
          <progress max={sending.total} value={sending.done} aria-label="Files sent" />
          <span>
            {sending.finished ? `${sending.done - sending.failed.length - sending.taken.length} of ${sending.total} files are in your drive's Incoming folder.` : `${sending.done} of ${sending.total} files sent. ${sending.left} left.`}
          </span>
          {!!sending.taken.length && <span className="hint">{sending.taken.length} were left out: a different file by the same name is already in Incoming.</span>}
          {!!sending.failed.length && <span className="hint">{sending.failed.length} could not be sent. Choose the folder again to send only those.</span>}
          {sending.finished && incoming && (
            <Link className="b b-secondary" href={`/app/import?folder=${encodeURIComponent(incoming)}`}>
              Sort them into client folders
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
