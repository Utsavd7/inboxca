"use client";
import { ChevronRight, Download, ExternalLink, Eye, File as FileIcon, FileImage, FileJson, FileSpreadsheet, FileText, Folder, FolderOpen, LayoutGrid, List, Search, Send, Upload, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { findClients } from "@/app/(app)/actions";
import { FileViewer } from "../../files/[id]/view/file-viewer";
import { Badge, Empty, type Tone } from "../../ui";
import { CopyButton } from "../../ui-client";
import { usePageParams, usePaperOpen } from "../../shell";
import { fileDrivePaper, uploadToFolder } from "./actions";
import type { Origin } from "@/src/lib/paper-origin";
import { CameFrom } from "../came-from";
import { paperType } from "@/src/lib/paper-type";
import type { Entry, Listing } from "./data";

type Slot = Listing | "gone" | "error";
type Choices = { types: string[]; works: [string, string][]; periods: [string, string][] };
const icons: Record<string, LucideIcon> = { folder: Folder, pdf: FileText, sheet: FileSpreadsheet, image: FileImage, json: FileJson, other: FileIcon };
const statuses: Record<string, [string, Tone]> = { to_check: ["To check", "warn"], missing: ["Missing in the drive", "late"], earlier: ["Earlier version", ""], deleted: ["Removed", ""] };
const sorts = { name: "Name, A to Z", "-name": "Name, Z to A", "-modified": "Newest first", modified: "Oldest first", "-size": "Largest first", size: "Smallest first" };
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const FRESH = 15_000;

const href = (parts: string[], name?: string) => `/app/documents?${new URLSearchParams({ view: "folders", ...(parts.length && { path: parts.join("/") }), ...(name && { name }) })}`;
const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`);
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "");
const isFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
// "3 folders, 12 files, 2 not in InboxCA yet", leaving out what is none.
function counted(entries: Entry[]) {
  const folders = entries.filter((entry) => entry.kind === "folder").length;
  const loose = entries.filter((entry) => entry.kind !== "folder" && !entry.paper).length;
  const said = [folders && `${folders} ${folders === 1 ? "folder" : "folders"}`, entries.length - folders && `${entries.length - folders} ${entries.length - folders === 1 ? "file" : "files"}`, loose && `${loose} not in InboxCA yet`].filter(Boolean);
  return said.length ? said.join(", ") : "An empty folder";
}

function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = icons[kind] ?? FileIcon;
  return (
    <span className={`fb-icon k-${kind}`} aria-hidden>
      <Icon size={size} />
    </span>
  );
}

// What a file is: its paper's type, work and period, and its state in words, or that
// InboxCA has not saved it.
function Meta({ entry }: { entry: Entry }) {
  const paper = entry.paper;
  const status = paper && statuses[paper.status];
  return (
    <span className="fb-sub">
      {paper ? <span>{[paperType(paper.type), paper.work, paper.period].filter(Boolean).join(", ")}</span> : <Badge tone="purple">Not in InboxCA yet</Badge>}
      {status && <Badge tone={status[1]}>{status[0]}</Badge>}
    </span>
  );
}

// The way down to a folder, from InboxCA's own folder: each part a link but the last.
export function Crumbs({ parts, open }: { parts: string[]; open?: (parts: string[]) => (event: React.MouseEvent) => void }) {
  return (
    <nav className="fb-crumbs" aria-label="Folder path">
      <ol>
        {["InboxCA", ...parts].map((name, at) => (
          <li key={at}>
            {at > 0 && <ChevronRight size={14} aria-hidden />}
            {at === parts.length ? (
              <span aria-current="page">{name}</span>
            ) : (
              <a href={href(parts.slice(0, at))} onClick={open?.(parts.slice(0, at))}>
                {name}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// A paper's first page in a grid card, asked for only once the card scrolls into view.
function Thumb({ id, hideInactive }: { id: string; hideInactive: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSeen(true);
      watch.disconnect();
    }, { rootMargin: "120px" });
    if (box.current) watch.observe(box.current);
    return () => watch.disconnect();
  }, []);
  return <span ref={box} className="fb-thumb-in">{seen && <FileViewer id={id} page={1} thumb hideInactive={hideInactive} />}</span>;
}

// The client a paper found outside a client's folder is for, searched by name.
function ClientPick() {
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [, start] = useTransition();
  return (
    <fieldset className="fb-pick">
      <legend>Client</legend>
      <input type="search" placeholder="Find the client by name" aria-label="Find the client" onChange={(event) => {
        const text = event.currentTarget.value;
        start(async () => setFound(await findClients(text)));
      }} />
      {found.map((client) => (
        <label key={client.id} className="check">
          <input type="radio" name="client" value={client.id} required />
          {client.name}
        </label>
      ))}
    </fieldset>
  );
}

// Save this paper: the person confirms its client, type, work and period, as for a paper in
// To check; InboxCA then moves it to the client's folder under its own name.
function FileForm({ entry, here, choices, done }: { entry: Entry; here: Listing; choices: Choices; done: (result: { ok?: string; folder?: string[] }) => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const guess = entry.guess ?? { type: "", work: "", period: "" };
  return (
    <form
      className="fb-file"
      aria-labelledby="fb-file-title"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const result = await fileDrivePaper(null, form);
          setError(result.error ?? "");
          if (result.ok) done(result);
        });
      }}
    >
      <h3 id="fb-file-title">Save this paper to a client</h3>
      <p className="hint">InboxCA moves it to the client&apos;s folder, names it by its type and period, and lists it with the client&apos;s papers.</p>
      <input type="hidden" name="path" value={here.path.join("/")} />
      <input type="hidden" name="name" value={entry.name} />
      {here.client ? (
        <p className="fb-for">
          <UserRound size={14} aria-hidden />
          For {here.client.name}
          <input type="hidden" name="client" value={here.client.id} />
        </p>
      ) : (
        <ClientPick />
      )}
      <label>
        Paper type
        <select name="type" defaultValue={guess.type} required>
          <option value="" disabled>
            Choose the paper type
          </option>
          {choices.types.map((type) => <option key={type} value={type}>{paperType(type)}</option>)}
        </select>
      </label>
      <label>
        Type of work
        <select name="work" defaultValue={guess.work || "other"}>
          {choices.works.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      <label>
        Period
        <select name="period" defaultValue={guess.period || "none"}>
          <option value="none">No period</option>
          {choices.periods.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <button className="b b-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Saving" : "Save this paper"}
      </button>
    </form>
  );
}

type Props = { initial: Record<string, Listing>; home: string[]; asked: string; drive: { name: string; web: boolean }; choices: Choices; viewer: boolean; hideInactive: boolean };

// The firm's drive as Dropbox shows it: the folder tree, the open folder and the chosen file.
// The address holds the open folder and file, so links and Back work; each folder is read
// once and kept, read again after 15 seconds, and read ahead when pointed at.
export function FolderBrowser({ initial, home, asked, drive, choices, viewer, hideInactive }: Props) {
  const params = usePageParams();
  const homeKey = home.join("/");
  // A folder the server could not open shows the nearest one above it.
  const raw = params.get("path") ?? "";
  const key = raw === asked ? homeKey : raw;
  const path = useMemo(() => (key ? key.split("/") : []), [key]);
  const picked = params.get("name");
  const [store, setStore] = useState<Record<string, Slot>>(initial);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<keyof typeof sorts>("name");
  const [grid, setGrid] = useState(false);
  const [drop, setDrop] = useState<string[] | null>(null);
  const [note, setNote] = useState<{ text: string; at: number; show?: string[] } | null>(null);
  const [from, setFrom] = useState<Record<string, Origin>>({});
  const [busy, start] = useTransition();
  const chooser = useRef<HTMLInputElement>(null);
  const fetched = useRef(new Map<string, number>());
  const loading = useRef(new Set<string>());

  useEffect(() => {
    for (const folder of Object.keys(initial)) if (!fetched.current.has(folder)) fetched.current.set(folder, Date.now());
  }, [initial]);
  useEffect(() => {
    if (raw === asked && raw !== homeKey) window.history.replaceState(null, "", href(home, picked ?? undefined));
  }, [raw, asked, homeKey, home, picked]);

  // Reads a folder unless it was read in the last 15 seconds; with a cursor, its next page.
  const load = useCallback((folder: string, cursor?: string) => {
    const at = fetched.current.get(folder);
    const job = `${folder}\n${cursor ?? ""}`;
    if (loading.current.has(job) || (!cursor && at && Date.now() - at < FRESH)) return;
    loading.current.add(job);
    fetch(`/app/documents/folders?${new URLSearchParams({ path: folder, ...(cursor && { cursor }) })}`)
      .then(async (response): Promise<Slot> => (response.ok ? response.json() : response.status === 404 ? "gone" : "error"))
      .catch((): Slot => "error")
      .then((slot) => {
        fetched.current.set(folder, Date.now());
        setStore((was) => {
          const before = was[folder];
          return { ...was, [folder]: cursor && typeof slot === "object" && typeof before === "object" ? { ...slot, entries: [...before.entries, ...slot.entries] } : slot };
        });
      })
      .finally(() => loading.current.delete(job));
  }, []);
  // After a change, every folder is read again when next shown; these at once.
  const reload = useCallback((...folders: string[]) => {
    fetched.current.clear();
    for (const folder of folders) load(folder);
  }, [load]);

  useEffect(() => load(key), [key, load]);

  const go = useCallback((parts: string[], name?: string, replace = false) => window.history[replace ? "replaceState" : "pushState"](null, "", href(parts, name)), []);
  // Beside an open paper the list chooses the paper shown there instead: a file InboxCA can
  // show opens in its place (data-paper, shell.tsx); any other closes it and shows here.
  const beside = usePaperOpen();
  const router = useRouter();
  const choose = (entry: Entry) => () => (beside ? router.push(href(path, entry.name), { scroll: false }) : go(path, entry.name, true));
  const shown = (entry: Entry) => entry.kind !== "folder" && (beside ? entry.paper?.id === beside : entry.name === picked);
  const opener = (parts: string[]) => (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setQ("");
    setOpen((was) => ({ ...was, ...Object.fromEntries(parts.map((_, at) => [parts.slice(0, at + 1).join("/"), true])) }));
    go(parts);
  };
  const isOpen = (folder: string) => open[folder] ?? (folder === "" || key === folder || key.startsWith(`${folder}/`));

  const here = store[key];
  const listing = typeof here === "object" ? here : null;
  const entries = useMemo(() => {
    if (!listing) return [];
    const by = sort.replace("-", "");
    const flip = sort.startsWith("-") ? -1 : 1;
    const words = q.trim().toLowerCase();
    return listing.entries
      .filter((entry) => !words || entry.name.toLowerCase().includes(words))
      .sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || flip * (by === "size" ? a.size - b.size : by === "modified" ? a.modified.localeCompare(b.modified) : collator.compare(a.name, b.name)) || collator.compare(a.name, b.name));
  }, [listing, sort, q]);
  const chosen = listing?.entries.find((entry) => entry.kind !== "folder" && entry.name === picked) ?? null;
  const paperId = chosen?.paper?.id;

  useEffect(() => {
    if (!paperId || from[paperId]) return;
    const stop = new AbortController();
    fetch(`/app/documents/folders?paper=${paperId}`, { signal: stop.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((found: Origin | null) => found && setFrom((was) => ({ ...was, [paperId]: found })))
      .catch(() => {});
    return () => stop.abort();
  }, [paperId, from]);

  // Papers from the computer, into a client's folder.
  const upload = (files: File[], parts: string[]) => {
    if (!files.length) return;
    const form = new FormData();
    form.set("path", parts.join("/"));
    for (const file of files) form.append("files", file);
    start(async () => {
      const result = await uploadToFolder(form);
      setNote({ text: result.ok ?? result.error ?? "", at: Date.now() });
      if (result.ok) reload(parts.join("/"), key);
    });
  };
  const dropKey = drop?.join("/");
  const target = drop && store[drop.join("/")];
  const refused = !!target && typeof target === "object" && !target.upload;
  const over = (parts: string[]) => (event: React.DragEvent) => {
    if (!isFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (dropKey !== parts.join("/")) {
      setDrop(parts);
      load(parts.join("/"));
    }
  };
  const dropped = (parts: string[]) => (event: React.DragEvent) => {
    if (!isFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDrop(null);
    if (!refused) upload([...event.dataTransfer.files], parts);
  };

  const tree = { store, isOpen, load, opener, over, dropped, current: key, dropKey, toggle: (folder: string, next: boolean) => setOpen((was) => ({ ...was, [folder]: next })) };
  const full = chosen && `/InboxCA/${[...path, chosen.name].join("/")}`;

  return (
    <div
      className="split fb-split"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
    >
      <nav className="pane fb-tree" aria-label="Folders">
        <ul>
          <TreeNode parts={[]} name="InboxCA" tree={tree} />
        </ul>
      </nav>

      <section className="fb-main" aria-label="Folder" onDragOver={over(path)} onDrop={dropped(path)}>
        <header className="fb-bar">
          <Crumbs parts={path} open={opener} />
          <div className="fb-tools">
            <label className="fb-search">
              <Search size={16} aria-hidden />
              <input type="search" value={q} onChange={(event) => setQ(event.currentTarget.value)} placeholder="Search in this folder" aria-label="Search in this folder" />
            </label>
            <select className="fb-sort" value={sort} onChange={(event) => setSort(event.currentTarget.value as keyof typeof sorts)} aria-label="Sort">
              {Object.entries(sorts).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <div className="fb-seg" role="group" aria-label="Show as">
              <button type="button" aria-pressed={!grid} onClick={() => setGrid(false)} title="List">
                <List size={16} aria-hidden />
                <span className="sr-only">List</span>
              </button>
              <button type="button" aria-pressed={grid} onClick={() => setGrid(true)} title="Grid">
                <LayoutGrid size={16} aria-hidden />
                <span className="sr-only">Grid</span>
              </button>
            </div>
            {listing?.upload && (
              <>
                <button type="button" className="b b-primary" onClick={() => chooser.current?.click()} disabled={busy}>
                  <Upload size={16} aria-hidden />
                  {busy ? "Uploading" : "Upload"}
                </button>
                <input ref={chooser} type="file" multiple hidden aria-label="Files to upload" onChange={(event) => {
                  upload([...(event.currentTarget.files ?? [])], path);
                  event.currentTarget.value = "";
                }} />
              </>
            )}
          </div>
        </header>

        <div className="pane fb-body">
          <div key={key} className="fb-view">
            {here === undefined ? (
              Array.from({ length: 6 }, (_, row) => <span key={row} className="skel fb-skel-row" />)
            ) : here === "gone" ? (
              <Empty Icon={FolderOpen} title="This folder is not here">
                <span>It may have been moved or renamed in the drive, or it is not one of your clients&apos;.</span>
                <a className="b b-secondary" href={href([])} onClick={opener([])}>Open the InboxCA folder</a>
              </Empty>
            ) : here === "error" ? (
              <Empty Icon={FolderOpen} title="The drive could not be read just now">
                <span>Try again in a minute.</span>
                <button type="button" className="b b-secondary" onClick={() => reload(key)}>Try again</button>
              </Empty>
            ) : !entries.length ? (
              <Empty Icon={FolderOpen} title={q ? "Nothing here by that name" : "This folder is empty"}>
                {!q && listing?.upload && <span>Drop files here, or choose Upload, to save them for {listing.client?.name}.</span>}
              </Empty>
            ) : grid ? (
              <ul className="fb-grid" aria-label="Files and folders">
                {entries.map((entry) => {
                  const child = [...path, entry.name];
                  const on = shown(entry);
                  return (
                    <li key={entry.name} className={`fb-card${on ? " on" : ""}${dropKey === child.join("/") ? " is-drop" : ""}`} {...(entry.kind === "folder" && { onDragOver: over(child), onDrop: dropped(child), onPointerEnter: () => load(child.join("/")) })}>
                      <span className="fb-thumb">{entry.paper?.view && viewer ? <Thumb id={entry.paper.id} hideInactive={hideInactive} /> : <KindIcon kind={entry.kind} size={28} />}</span>
                      {entry.kind === "folder" ? (
                        <a className="fb-card-name" href={href(child)} onClick={opener(child)} title={entry.name}>{entry.name}</a>
                      ) : (
                        <button type="button" className="fb-card-name" aria-pressed={on} onClick={choose(entry)} title={entry.name} data-paper={entry.paper?.view ? entry.paper.id : undefined}>{entry.name}</button>
                      )}
                      {entry.kind !== "folder" && <Meta entry={entry} />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <table className="fb-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Last changed</th>
                    <th scope="col" className="fb-num">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const child = [...path, entry.name];
                    const on = shown(entry);
                    return entry.kind === "folder" ? (
                      <tr key={entry.name} className={dropKey === child.join("/") ? "is-drop" : undefined} onDragOver={over(child)} onDrop={dropped(child)} onPointerEnter={() => load(child.join("/"))}>
                        <td>
                          <a className="fb-name" href={href(child)} onClick={opener(child)} title={entry.name}>
                            <KindIcon kind="folder" />
                            <span className="fb-text">{entry.name}</span>
                          </a>
                        </td>
                        <td>{dateOf(entry.modified)}</td>
                        <td className="fb-num" />
                      </tr>
                    ) : (
                      <tr key={entry.name} className={on ? "on" : undefined}>
                        <td>
                          <button type="button" className="fb-name" aria-pressed={on} onClick={choose(entry)} title={entry.name} data-paper={entry.paper?.view ? entry.paper.id : undefined}>
                            <KindIcon kind={entry.kind} />
                            <span className="fb-text">
                              <span className="fb-title">{entry.name}</span>
                              <Meta entry={entry} />
                            </span>
                          </button>
                        </td>
                        <td>{dateOf(entry.modified)}</td>
                        <td className="fb-num">{sizeOf(entry.size)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {listing?.cursor && (
              <button type="button" className="b b-secondary fb-more" onClick={() => load(key, listing.cursor!)}>
                Show more
              </button>
            )}
          </div>
        </div>

        {drop && (
          <div className={`fb-drop${refused ? " is-refused" : ""}`} aria-hidden>
            <span>
              <Upload size={18} />
              <span>{refused ? "Open a client\u2019s folder to upload papers there" : <>Drop to upload to <strong>{drop.at(-1) ?? "InboxCA"}</strong></>}</span>
            </span>
          </div>
        )}
      </section>

      <aside className="pane fb-detail" aria-label="Details">
        {chosen && full ? (
          <div key={chosen.name} className="fb-detail-in">
            {chosen.paper ? (
              <div className="fb-preview">
                {chosen.paper.view && viewer ? (
                  <FileViewer key={chosen.paper.id} id={chosen.paper.id} page={1} thumb hideInactive={hideInactive} />
                ) : (
                  <>
                    <KindIcon kind={chosen.kind} size={28} />
                    <span>{viewer ? "This kind of file cannot be shown here." : "Papers cannot be shown yet."}</span>
                  </>
                )}
              </div>
            ) : (
              <KindIcon kind={chosen.kind} size={28} />
            )}
            <h2>{chosen.name}</h2>
            <Meta entry={chosen} />
            {/* A file InboxCA did not file leads with filing it. */}
            {!chosen.paper && listing?.file && (
              <FileForm
                key={chosen.name}
                entry={chosen}
                here={listing}
                choices={choices}
                done={(result) => {
                  setNote({ text: result.ok ?? "", at: Date.now(), show: result.folder });
                  reload(key, result.folder?.join("/") ?? key);
                  go(path, undefined, true);
                }}
              />
            )}
            <dl className="fb-facts">
              <div>
                <dt>Came from</dt>
                <dd>{!chosen.paper ? "Put in the drive by hand, not through InboxCA" : from[chosen.paper.id] ? <CameFrom origin={from[chosen.paper.id]} /> : <span className="skel fb-skel-line" />}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{sizeOf(chosen.size)}</dd>
              </div>
              <div>
                <dt>Last changed</dt>
                <dd>{dateOf(chosen.modified)}</dd>
              </div>
              <div>
                <dt>In {drive.name}</dt>
                <dd className="fb-path">
                  <span>{full}</span>
                  <CopyButton text={full} label="Path" />
                </dd>
              </div>
            </dl>
            <div className="fb-actions">
              {chosen.paper && (
                <>
                  {chosen.paper.view && (
                    <Link className="b b-secondary" href={`/app/files/${chosen.paper.id}/view`}>
                      <Eye size={16} aria-hidden />
                      View
                    </Link>
                  )}
                  {chosen.paper.download && (
                    <a className="b b-secondary" href={`/app/files/${chosen.paper.id}`}>
                      <Download size={16} aria-hidden />
                      Download
                    </a>
                  )}
                  {chosen.paper.send && (
                    <Link className="b b-secondary" href={`/app/clients/${chosen.paper.client}?tab=documents&send=${chosen.paper.id}`}>
                      <Send size={16} aria-hidden />
                      Send as a secure link
                    </Link>
                  )}
                </>
              )}
              {(chosen.paper?.client ?? listing?.client?.id) && (
                <Link className="b b-secondary" href={`/app/clients/${chosen.paper?.client ?? listing?.client?.id}`}>
                  <UserRound size={16} aria-hidden />
                  Open client
                </Link>
              )}
              {drive.web && (
                <a className="b b-ghost" href={`https://www.dropbox.com/home/InboxCA/${path.map(encodeURIComponent).join("/")}?preview=${encodeURIComponent(chosen.name)}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} aria-hidden />
                  Open in Dropbox
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="fb-detail-in fb-summary">
            <KindIcon kind="folder" size={28} />
            <h2>{path.at(-1) ?? "InboxCA"}</h2>
            {listing && (
              <p className="hint">
                {counted(listing.entries)}
                {listing.cursor && " so far"}
              </p>
            )}
            <p className="hint">Choose a file to see it here.</p>
            {listing?.client && (
              <Link className="b b-secondary" href={`/app/clients/${listing.client.id}`}>
                <UserRound size={16} aria-hidden />
                Open {listing.client.name}
              </Link>
            )}
          </div>
        )}
      </aside>

      {note && (
        <div key={note.at} className="toast" role="status">
          <span>{note.text}</span>
          {note.show && (
            <button type="button" className="b" onClick={() => go(note.show!)}>
              Open its folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type Tree = {
  store: Record<string, Slot>;
  isOpen: (folder: string) => boolean;
  load: (folder: string) => void;
  opener: (parts: string[]) => (event: React.MouseEvent) => void;
  over: (parts: string[]) => (event: React.DragEvent) => void;
  dropped: (parts: string[]) => (event: React.DragEvent) => void;
  toggle: (folder: string, open: boolean) => void;
  current: string;
  dropKey?: string;
};

// One folder in the tree: its chevron opens its folders (read when first opened, or ahead
// when pointed at), its name opens it. The open folder is marked.
function TreeNode({ parts, name, tree }: { parts: string[]; name: string; tree: Tree }) {
  const folder = parts.join("/");
  const slot = tree.store[folder];
  const open = tree.isOpen(folder);
  const { load } = tree;
  useEffect(() => {
    if (open) load(folder);
  }, [open, folder, load]);
  const folders = typeof slot === "object" ? slot.entries.filter((entry) => entry.kind === "folder").sort((a, b) => collator.compare(a.name, b.name)) : null;
  const leaf = folders?.length === 0 || slot === "gone";
  return (
    <li>
      <div className={`fb-node${tree.current === folder ? " is-on" : ""}${tree.dropKey === folder ? " is-drop" : ""}`} style={{ "--depth": parts.length } as React.CSSProperties} onDragOver={tree.over(parts)} onDrop={tree.dropped(parts)}>
        {leaf ? (
          <span className="fb-chev" />
        ) : (
          <button type="button" className="fb-chev" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the folders in ${name}`} onClick={() => tree.toggle(folder, !open)}>
            <ChevronRight size={14} aria-hidden />
          </button>
        )}
        <a href={href(parts)} onClick={tree.opener(parts)} onPointerEnter={() => load(folder)} aria-current={tree.current === folder ? "page" : undefined}>
          {open && folders?.length ? <FolderOpen size={16} aria-hidden /> : <Folder size={16} aria-hidden />}
          <span className="fb-label">{name}</span>
        </a>
      </div>
      {!leaf && (
        <div className="fb-kids" data-open={open || undefined} inert={!open}>
          <ul>
            {folders ? folders.map((entry) => <TreeNode key={entry.name} parts={[...parts, entry.name]} name={entry.name} tree={tree} />) : open && <li><span className="skel fb-skel" /></li>}
          </ul>
        </div>
      )}
    </li>
  );
}
