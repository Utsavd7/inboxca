"use client";
import { Check, FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { uploadToRequest } from "@/app/(app)/actions";

const MAX_UPLOAD = 25 * 1024 * 1024;
const problems = {
  file: "could not be sent. Choose a photo or PDF of up to 25 MB.",
  full: "could not be sent. This link has taken 100 files, the most it can. Ask your CA's office for a new link.",
  later: "could not be saved just now. Please try again in a few minutes.",
  closed: "could not be sent. This link has ended.",
};

// Files go up one at a time, page wide, so two items never save over each other. A file
// says more files follow while any are waiting, so the request closes only after the last.
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

// One item asked for on a client's upload link: its name, what has arrived, and one button
// that opens the phone's camera, photos or files and sends what is chosen at once.
export function AddFiles({ token, item, type, received, open }: { token: string; item: number; type: string; received: number; open: boolean }) {
  const router = useRouter();
  const [sending, setSending] = useState<[number, number] | null>(null);
  const [problem, setProblem] = useState("");

  async function send(files: File[]) {
    const ready = files.filter((file) => file.size && file.size <= MAX_UPLOAD);
    const left: [string, keyof typeof problems][] = files.filter((file) => !ready.includes(file)).map((file) => [file.name, "file"]);
    waiting += ready.length;
    const sent = ready.map((file) => {
      const form = new FormData();
      form.set("token", token);
      form.set("item", String(item));
      form.set("file", file);
      const result = queue.then(() => {
        if (waiting > 1) form.set("more", "1");
        return uploadToRequest(form);
      }).catch(() => "later" as const).finally(() => waiting--);
      queue = result;
      return result;
    });
    setProblem("");
    for (const [at, result] of sent.entries()) {
      setSending([at + 1, sent.length]);
      const said = await result;
      if (said !== "got") left.push([ready[at].name, said]);
    }
    setSending(null);
    setProblem(left.length ? `${left.map(([name]) => name).join(", ")} ${problems[left[0][1]]}` : "");
    router.refresh();
  }

  return (
    <>
      <span className={`public-tick${received ? " done" : ""}`}>{received ? <Check size={14} aria-label="Received" /> : item + 1}</span>
      <span className="grow">
        <strong>{type}</strong>
        <span className={problem ? "sub bad" : "sub"} role="status">
          {sending ? `Sending ${sending[0]} of ${sending[1]}` : problem || (received ? `Received: ${received === 1 ? "1 file" : `${received} files`}` : "")}
        </span>
      </span>
      {open && (
        <label className={`b b-secondary public-pick${sending ? " busy" : ""}`}>
          <input
            className="sr-only"
            type="file"
            multiple
            accept="image/*,application/pdf"
            disabled={!!sending}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length) void send(files);
            }}
          />
          <FileUp size={16} aria-hidden />
          {sending ? "Sending" : `Add ${type} (photo or PDF)`}
        </label>
      )}
    </>
  );
}
