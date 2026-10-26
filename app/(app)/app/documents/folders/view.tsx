import "./folders.css";
import { Files, FolderOpen, FolderTree, HardDrive, Upload } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { todayInIndia } from "@/src/lib/calendar";
import { documentTypes, periodChoices, periodName } from "@/src/lib/documents";
import { workTypes } from "@/src/lib/drive";
import { parsePath } from "@/src/lib/drive-browse";
import { Empty, PageHead } from "../../ui";
import { Crumbs, FolderBrowser } from "./browser";
import { browseContext, listing, type Listing } from "./data";

// The two ways to see the firm's papers: its drive's own folders, or every paper in one list.
export function ViewSwitch({ folders }: { folders: boolean }) {
  return (
    <nav className="fb-switch" aria-label="Show papers as">
      <Link href="/app/documents" aria-current={folders ? "page" : undefined}>
        <FolderTree size={16} aria-hidden />
        Folders
      </Link>
      <Link href="/app/documents?view=papers" aria-current={folders ? undefined : "page"}>
        <Files size={16} aria-hidden />
        All papers
      </Link>
    </nav>
  );
}

// The folder view's frame while the drive is read: the path at once, the rest shimmering.
function Frame({ parts }: { parts: string[] }) {
  return (
    <div className="split fb-split" aria-busy="true">
      <nav className="pane fb-tree" aria-label="Folders">
        {["InboxCA", ...parts].map((name, at) => (
          <span key={at} className="fb-node is-path" style={{ "--depth": at } as React.CSSProperties}>
            <span className="fb-chev" />
            <FolderOpen size={16} aria-hidden />
            <span className="fb-label">{name}</span>
          </span>
        ))}
        <span className="skel fb-skel" />
        <span className="skel fb-skel" />
      </nav>
      <section className="fb-main" aria-label="Folder">
        <header className="fb-bar">
          <Crumbs parts={parts} />
        </header>
        <div className="fb-body">
          {Array.from({ length: 6 }, (_, row) => <span key={row} className="skel fb-skel-row" />)}
        </div>
      </section>
      <aside className="pane fb-detail" aria-label="Details" />
    </div>
  );
}

// The open folder and each one above it, read together, so the tree shows the way down at
// once; a folder the person may not open, or that is gone, opens the nearest one above it.
async function Loaded({ parts }: { parts: string[] }) {
  const ctx = await browseContext();
  if (!ctx) redirect("/app");
  if (!ctx.drive)
    return (
      <Empty Icon={HardDrive} title="The firm's drive is not connected yet">
        <span>When the owner connects the drive in Settings, its folders show here.</span>
        {ctx.owner && (
          <Link className="b b-primary" href="/app/settings#drive">
            Connect the drive
          </Link>
        )}
      </Empty>
    );
  const chain = await Promise.all([[], ...parts.map((_, at) => parts.slice(0, at + 1))].map((up) => listing(ctx, up).catch(() => null)));
  const reached = chain.findIndex((found) => !found);
  if (reached === 0)
    return (
      <Empty Icon={HardDrive} title="The drive could not be read just now">
        <span>Try again in a minute. If it keeps happening, ask the owner to connect the drive again in Settings.</span>
      </Empty>
    );
  const shown = chain.slice(0, reached === -1 ? undefined : reached) as Listing[];
  const today = todayInIndia();
  return (
    <FolderBrowser
      initial={Object.fromEntries(shown.map((found) => [found.path.join("/"), found]))}
      home={shown[shown.length - 1].path}
      asked={parts.join("/")}
      drive={{ name: ctx.account?.provider === "dropbox" ? "Dropbox" : "Test drive", web: ctx.owner && ctx.account?.provider === "dropbox" }}
      choices={{
        types: [...documentTypes, ...((ctx.membership.settings.document_types ?? []) as string[])],
        works: Object.entries(workTypes),
        periods: periodChoices(today).map((key) => [key, periodName(key)]),
      }}
      viewer={!!process.env.FILE_WORKER_URL && !!process.env.FILE_WORKER_SECRET}
      hideInactive={ctx.membership.settings.viewer_hide_inactive === true}
    />
  );
}

// Documents as the firm's drive shows them (?view=folders, &path= the open folder, &name= the
// chosen file): the folder tree, the open folder's contents and the chosen file's details.
export function FoldersView({ path, portal, upload }: { path?: string; portal: boolean; upload: boolean }) {
  const parts = parsePath(path) ?? [];
  return (
    <div className="fill docs fb">
      <PageHead
        title="Documents"
        sub="Your firm's drive, folder by folder, as InboxCA saves it."
        actions={
          <>
            {portal && <Link className="b b-secondary" href="/app/documents?view=papers&portal=1" scroll={false}>Add portal files</Link>}
            {upload && (
              <Link className="b b-primary" href="/app/documents?view=papers&upload=1" scroll={false}>
                <Upload size={16} aria-hidden />
                Upload papers
              </Link>
            )}
          </>
        }
      />
      <ViewSwitch folders />
      <Suspense fallback={<Frame parts={parts} />}>
        <Loaded parts={parts} />
      </Suspense>
    </div>
  );
}
