"use client";
import { FileUp, UserSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { going } from "../nav-progress";

// Files dropped on the page wait here while the upload panel opens, then fill its form.
let held: File[] = [];

// The held files, put into the open upload form, which types each from its name.
function fill() {
  const input = document.querySelector<HTMLInputElement>(".upload-form input[name=file]");
  if (!held.length || !input) return;
  const transfer = new DataTransfer();
  for (const file of held) transfer.items.add(file);
  held = [];
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Files dragged over Documents cover the page with where they will go: the chosen client
// (the open paper's, or the one picked in Upload papers), or a note to choose one first.
// Dropping opens Upload papers (href) with the files in it, each typed from its name as usual.
export function DropUpload({ client, href }: { client: string | null; href: string }) {
  const router = useRouter();
  const [over, setOver] = useState(false);

  useEffect(() => {
    const files = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    // An open upload form takes the files itself, so the page is not covered then.
    const form = () => document.querySelector(".upload-form");
    // Every element entered is left again; the window is left when the count is back to 0.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (files(event) && !form()) setOver(++depth > 0);
    };
    const leave = (event: DragEvent) => {
      if (files(event) && depth) setOver(--depth > 0);
    };
    const move = (event: DragEvent) => {
      if (files(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      if ((event.target as Element).closest?.(".upload-drop")) return;
      held = [...(event.dataTransfer?.files ?? [])];
      if (!held.length) return;
      if (form()) fill();
      else {
        going(href);
        router.push(href, { scroll: false });
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", move);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", move);
      window.removeEventListener("drop", drop);
    };
  }, [href, router]);

  // Once the client's upload form is open, the held files go into it.
  useEffect(fill);

  if (!over) return null;
  return (
    <div className="docs-drop" aria-hidden>
      <div className="docs-drop-frame">
        <span className="icon-tile k-docs">{client ? <FileUp size={22} /> : <UserSearch size={22} />}</span>
        <strong>{client ? `Drop to upload for ${client}` : "Choose a client first"}</strong>
        <span>{client ? "Each file is saved in their folder in your firm's drive, after you check its type and period." : "Drop the files here, then pick the client they are for."}</span>
      </div>
    </div>
  );
}

const nothing = () => () => {};

// In Upload papers before a client is chosen: how many dropped files are waiting.
export function HeldFiles() {
  const count = useSyncExternalStore(nothing, () => held.length, () => 0);
  if (!count) return null;
  return (
    <p className="notice docs-held">
      <FileUp size={16} aria-hidden />
      {count} {count === 1 ? "file is" : "files are"} ready. Choose the client {count === 1 ? "it is" : "they are"} for.
    </p>
  );
}
