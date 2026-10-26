"use client";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  Bell as BellIcon,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  FileText,
  Inbox,
  Keyboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Users,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, createContext, startTransition, use, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { switchFirm } from "@/app/(app)/actions";
import { signOut } from "@/app/(auth)/actions";
import { bellItems, markBellRead } from "@/app/(app)/actions";
import { contactEmail } from "@/src/lib/site";
import { typing } from "./command";
import { MotionRoot, spring, springSoft } from "./motion";
import { going } from "./nav-progress";
import { Avatar } from "./ui";
import { NEW_EVENT } from "./ui-client";
import { news, newsLatest, type News } from "./whats-new";

// The app's frame around every page (layout.tsx draws the sidebar and the stage on the
// server; this keeps what changes in the browser): the theme, the folded sidebar, the phone
// drawer, the help, what's new and shortcuts panels, the keys that work everywhere, and the
// header's tools that every PageHead shows.

export type Theme = "light" | "dark" | "system";
export type Me = { member: boolean; name: string; email: string; role: string; firm: string; firmId: string; firms: { id: string; name: string }[]; owner: boolean; people: boolean };
type Panel = "help" | "news" | "keys" | null;
type Shell = {
  me: Me;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  rail: boolean;
  fold: () => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  open: (panel: Panel) => void;
  newsFresh: boolean;
  bell: Promise<number>;
};
const ShellContext = createContext<Shell | null>(null);
const useShell = () => useContext(ShellContext);
const year = 31_536_000;
const remember = (name: string, value: string) => (document.cookie = `${name}=${value}; path=/app; max-age=${year}; samesite=lax`);

export function ShellFrame({ me, theme: savedTheme, rail: savedRail, newsSeen, bell, sidebar, children }: { me: Me; theme: Theme; rail: boolean; newsSeen: string; bell: Promise<number>; sidebar: React.ReactNode; children: React.ReactNode }) {
  const [theme, setThemeState] = useState(savedTheme);
  const [rail, setRail] = useState(savedRail);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [newsFresh, setNewsFresh] = useState(newsSeen < newsLatest);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const path = usePathname();
  // The drawer closes when a link in it is followed.
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setDrawer(false);
  }
  // One value while nothing it holds changes: a new one would redraw the parts of the page
  // still streaming in (shown twice for a moment) and every header tool.
  const shell = useMemo<Shell>(() => ({
    me,
    theme,
    setTheme: (next) => {
      remember("theme", next);
      const root = document.documentElement;
      root.classList.add("theme-fade");
      setTimeout(() => root.classList.remove("theme-fade"), 260);
      setThemeState(next);
    },
    rail,
    fold: () => {
      remember("side", rail ? "full" : "rail");
      setTip(null);
      setRail(!rail);
    },
    drawer,
    setDrawer,
    open: (next) => {
      if (next === "news") {
        remember("news_seen", newsLatest);
        setNewsFresh(false);
      }
      setDrawer(false);
      setPanel(next);
    },
    newsFresh,
    bell,
  }), [me, theme, rail, drawer, newsFresh, bell]);
  // The folded sidebar names what is under the pointer or the keyboard beside it.
  const point = (target: EventTarget) => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".side [data-tip]") : null;
    if (!rail || !item || window.matchMedia("(max-width: 720px)").matches) return setTip(null);
    const box = item.getBoundingClientRect();
    setTip({ text: item.dataset.tip!, top: box.top + box.height / 2 });
  };
  return (
    <MotionRoot>
      <ShellContext value={shell}>
        <div
          className="ui"
          data-theme={theme}
          data-side={rail ? "rail" : "full"}
          data-drawer={drawer ? "open" : undefined}
          onPointerOver={(event) => point(event.target)}
          onPointerLeave={() => setTip(null)}
          onFocus={(event) => point(event.target)}
          onBlur={() => setTip(null)}
        >
          {sidebar}
          <div className="side-scrim" aria-hidden onClick={() => setDrawer(false)} />
          {children}
          {tip && (
            <div key={tip.text} className="side-tip" style={{ top: tip.top }} aria-hidden>
              {tip.text}
            </div>
          )}
        </div>
        <Keys />
        <NoSideways />
        <HelpSheet open={panel === "help"} close={() => setPanel(null)} />
        <NewsSheet open={panel === "news"} close={() => setPanel(null)} />
        <KeysOverlay open={panel === "keys"} close={() => setPanel(null)} />
      </ShellContext>
    </MotionRoot>
  );
}

// The header's backdrop reaches past the page on both sides, so the content pane is wider
// than it looks and a focused field could scroll it sideways; it only ever scrolls down.
function NoSideways() {
  useEffect(() => {
    const pane = document.querySelector<HTMLElement>(".stage-panel");
    const back = () => { if (pane && pane.scrollLeft) pane.scrollLeft = 0; };
    pane?.addEventListener("scroll", back, { passive: true });
    return () => pane?.removeEventListener("scroll", back);
  }, []);
  return null;
}

// Keys that work on every page, unless a field has the keyboard: ? lists them all, C starts
// something new, G then T, I, C or D goes to a place, and [ folds the sidebar.
const places: Record<string, string> = { t: "/app", i: "/app/inbox", c: "/app/clients", d: "/app/documents" };
function Keys() {
  const shell = useShell();
  const router = useRouter();
  const go = useRef(0);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || document.querySelector("[role=dialog], [role=menu]")) return;
      const letter = event.key.toLowerCase();
      if (Date.now() - go.current < 1200 && places[letter]) {
        go.current = 0;
        going(places[letter]);
        router.push(places[letter]);
      } else if (letter === "g") go.current = Date.now();
      else if (event.key === "?") shell?.open("keys");
      else if (letter === "c" && shell?.me.member) window.dispatchEvent(new Event(NEW_EVENT));
      else if (event.key === "[") shell?.fold();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [router, shell]);
  return null;
}

// The header's menu button: on a phone it opens the sidebar as a drawer.
export function MenuButton() {
  const shell = useShell();
  if (!shell) return null;
  return (
    <button type="button" className="b b-ghost b-icon head-menu" aria-label="Menu" aria-expanded={shell.drawer} onClick={() => shell.setDrawer(!shell.drawer)}>
      <MenuIcon size={18} aria-hidden />
    </button>
  );
}

// The header's tools on every page: notifications, help, and on a phone the account menu.
export function HeadTools() {
  const shell = useShell();
  if (!shell) return null;
  return (
    <div className="head-tools">
      {shell.me.member && <Bell />}
      <button type="button" className="b b-ghost b-icon" aria-label="Help" title="Help" onClick={() => shell.open("help")}>
        <CircleHelp size={18} aria-hidden />
      </button>
      <AccountMenu place="head" />
    </div>
  );
}

// The workspace switcher at the top of the sidebar: the firm, and the firm's own places.
export function WorkspaceMenu() {
  const shell = useShell()!;
  const { me } = shell;
  return (
    <Menu.Root>
      <Menu.Trigger className="side-item rail-firm" data-tip={me.firm || "InboxCA"}>
        <Avatar name={me.firm || "InboxCA"} square />
        <span className="side-who side-text">
          <strong>{me.firm || "InboxCA"}</strong>
          <small>{me.member ? "Firm workspace" : "No firm yet"}</small>
        </span>
        <ChevronsUpDown size={14} className="side-chev" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={shell.rail ? "right" : "bottom"} align="start" sideOffset={6} className="menu-layer">
          <Menu.Popup className="menu-pop">
            <div className="menu-me">
              <Avatar name={me.firm || "InboxCA"} square />
              <span>
                <strong>{me.firm || "InboxCA"}</strong>
                <small>{me.member ? "Firm workspace" : "No firm yet"}</small>
              </span>
            </div>
            {me.firms.length > 1 && (
              <Menu.Group aria-label="Your other firms">
                {me.firms.filter((row) => row.id !== me.firmId).map((row) => (
                  <Menu.Item key={row.id} className="menu-item" onClick={() => startTransition(() => switchFirm(row.id))}>
                    <Avatar name={row.name} square />
                    Switch to {row.name}
                  </Menu.Item>
                ))}
              </Menu.Group>
            )}
            <div className="menu-sep" />
            {me.owner && (
              <Menu.LinkItem className="menu-item" closeOnClick render={<Link href="/app/settings" />}>
                <Settings size={16} aria-hidden />
                Firm settings
              </Menu.LinkItem>
            )}
            {me.people && (
              <Menu.LinkItem className="menu-item" closeOnClick render={<Link href="/app/people" />}>
                <Users size={16} aria-hidden />
                People
              </Menu.LinkItem>
            )}
            <Menu.Item className="menu-item" onClick={() => shell.open("help")}>
              <CircleHelp size={16} aria-hidden />
              Help and support
            </Menu.Item>
            <div className="menu-sep" />
            <SignOutItem />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SignOutItem() {
  const [busy, start] = useTransition();
  return (
    <Menu.Item className="menu-item" closeOnClick={false} disabled={busy} onClick={() => start(() => signOut())}>
      <LogOut size={16} aria-hidden />
      {busy ? "Signing out" : "Sign out"}
    </Menu.Item>
  );
}

// Who is signed in, at the foot of the sidebar (and in the header on a phone): the theme,
// the shortcuts, help, and signing out.
const themes = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;
export function AccountMenu({ place }: { place: "side" | "head" }) {
  const shell = useShell()!;
  const { me } = shell;
  const side = place === "head";
  return (
    <Menu.Root>
      {side ? (
        <Menu.Trigger className="b b-ghost b-icon head-me" aria-label={`Account, ${me.name}`}>
          <Avatar name={me.email || "?"} />
        </Menu.Trigger>
      ) : (
        <Menu.Trigger className="side-item rail-me" data-tip={me.name}>
          <Avatar name={me.email || "?"} />
          <span className="side-who side-text">
            <strong title={me.email}>{me.name}</strong>
            {me.role && <small>{me.role}</small>}
          </span>
          <ChevronsUpDown size={14} className="side-chev" aria-hidden />
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner side={side ? "bottom" : shell.rail ? "right" : "top"} align={side ? "end" : shell.rail ? "end" : "start"} sideOffset={6} className="menu-layer">
          <Menu.Popup className="menu-pop">
            <div className="menu-me">
              <Avatar name={me.email || "?"} />
              <span>
                <strong>{me.name}</strong>
                <small>
                  {me.email}
                  {me.role && `, ${me.role}`}
                </small>
              </span>
            </div>
            <div className="menu-sep" />
            <Menu.Group>
              <Menu.GroupLabel className="menu-head">Theme</Menu.GroupLabel>
              <Menu.RadioGroup value={shell.theme} onValueChange={(value) => shell.setTheme(value as Theme)}>
                {themes.map(({ value, label, Icon }) => (
                  <Menu.RadioItem key={value} value={value} className="menu-item" closeOnClick={false}>
                    <Icon size={16} aria-hidden />
                    {label}
                    <Menu.RadioItemIndicator className="menu-check">
                      <Check size={15} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <div className="menu-sep" />
            <Menu.Item className="menu-item" onClick={() => shell.open("keys")}>
              <Keyboard size={16} aria-hidden />
              Keyboard shortcuts
              <kbd>?</kbd>
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => shell.open("help")}>
              <CircleHelp size={16} aria-hidden />
              Help and support
            </Menu.Item>
            <div className="menu-sep" />
            <SignOutItem />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// The sidebar's foot: help, what's new (a dot until opened) and folding the sidebar.
export function SideFoot() {
  const shell = useShell()!;
  return (
    <>
      <button type="button" className="side-item" data-tip="Help" onClick={() => shell.open("help")}>
        <CircleHelp size={18} aria-hidden />
        <span className="side-text">Help</span>
      </button>
      <button type="button" className="side-item" data-tip="What's new" onClick={() => shell.open("news")}>
        <Sparkles size={18} aria-hidden />
        <span className="side-text">What&apos;s new</span>
        {shell.newsFresh && <span className="side-dot" role="img" aria-label="New updates" />}
      </button>
      <button type="button" className="side-item side-fold" data-tip={shell.rail ? "Expand sidebar" : "Collapse sidebar"} aria-label={shell.rail ? "Expand sidebar" : "Collapse sidebar"} aria-keyshortcuts="[" onClick={shell.fold}>
        {shell.rail ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        <span className="side-text">Collapse</span>
      </button>
    </>
  );
}

// The notifications: questions for this person, then what others did on their clients,
// newest first. The count is what came since they last marked all read.
type Item = Awaited<ReturnType<typeof bellItems>>[number];
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function Bell() {
  const shell = useShell()!;
  const [items, setItems] = useState<Item[] | null>(null);
  const [read, setRead] = useState(false);
  const [, start] = useTransition();
  const fresh = items?.filter((item) => item.fresh && !(read && item.at)) ?? [];
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) start(async () => setItems(await bellItems()));
      }}
    >
      <Popover.Trigger className="b b-ghost b-icon bell" title="Notifications">
        <BellIcon size={18} aria-hidden />
        <span className="sr-only">Notifications</span>
        {items ? <BellCount count={fresh.length} /> : read ? null : (
          <Suspense fallback={null}>
            <BellCountLater count={shell.bell} />
          </Suspense>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="menu-layer">
          <Popover.Popup className="menu-pop bell-pop">
            <div className="bell-head">
              <Popover.Title render={<h2 />}>Notifications</Popover.Title>
              {!!fresh.some((item) => item.at) && (
                <button
                  type="button"
                  className="b b-ghost b-small"
                  onClick={() => {
                    setRead(true);
                    start(() => markBellRead());
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>
            {!items ? (
              <div className="bell-list" aria-busy="true">
                {[0, 1, 2].map((row) => <span key={row} className="skel" />)}
              </div>
            ) : items.length ? (
              <div className="bell-list">
                {items.map((item) => (
                  <Link key={item.key} href={item.href} className={item.fresh && !(read && item.at) ? "is-new" : undefined}>
                    <Avatar name={item.who} />
                    <span className="grow">
                      <strong>{item.what}</strong>
                      <small>
                        {item.who}
                        {item.at && `, ${when(item.at)}`}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bell-none">
                <BellIcon size={20} aria-hidden />
                Nothing new. Permission requests for you and changes to your clients show here.
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
function BellCountLater({ count }: { count: Promise<number> }) {
  return <BellCount count={use(count)} />;
}
function BellCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <m.span className="bell-count" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
      <span aria-hidden>{count > 9 ? "9+" : count}</span>
      <span className="sr-only">, {count} new</span>
    </m.span>
  );
}

// A panel from the right edge (help, what's new): it springs in and leaves the same way.
function Sheet({ open, close, title, children }: { open: boolean; close: () => void; title: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(now) => !now && close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop className="sheet-backdrop" render={<m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />} />
            <Dialog.Popup
              className="sheet"
              render={<m.div initial={{ opacity: 0, x: 48 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 48, transition: { duration: 0.18 } }} transition={springSoft} />}
            >
              <header className="sheet-head">
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Close className="b b-ghost">Close</Dialog.Close>
              </header>
              <div className="sheet-body">{children}</div>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

const answers: [string, string][] = [
  ["How do clients send us papers?", "Clients email papers to your firm email as they do today. InboxCA saves each paper in your drive, in a folder for the client, the year and the type of work. To ask for papers you still need, use Ask for papers: the client gets an upload link with a list of what is still missing."],
  ["How do reminders work?", "At 10:00 each day, InboxCA emails clients about returns that are due soon or late, at most once a day each, from your firm email. The owner picks when in Settings. InboxCA reminds only for due dates it has checked against the government notification. You can pause reminders for any client."],
  ["How do I connect our email and drive?", "The owner does it once in Settings: Firm email for the address your clients write to, and Firm drive for where papers are saved. InboxCA keeps no copy of your mail and no client files."],
  ["What does Office only do?", "Staff can use InboxCA only in the office, on the office internet connection, and only on PCs the owner approves. The owner can sign in from anywhere."],
  ["Who sees what?", "The owner chooses whether everyone sees every client or only the people assigned to it. Each role (partner, manager, staff, front desk) can do only what Permissions allows. For anything more, they ask their manager or the owner for permission."],
  ["Where are our papers kept?", "In your firm's own drive, in folders by year, client and type of work. InboxCA reads them to help you prepare and check returns. Inside InboxCA, papers open view only."],
  ["How do I mark a return filed?", "On Today, point at a late client and choose Mark filed, or open the client's Returns tab. You can add the acknowledgement number, and Undo puts it back."],
  ["How do I add our clients?", "Choose New client, or add them all at once with Import from Excel on the Clients page. Then choose the services you do for each client, and InboxCA works out their due dates."],
];
function HelpSheet({ open, close }: { open: boolean; close: () => void }) {
  const shell = useShell();
  return (
    <Sheet open={open} close={close} title="Help">
      <p className="sheet-lede">Short answers to what CA offices ask most.</p>
      <div className="help-list">
        {answers.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <ChevronDown size={16} aria-hidden />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
      <div className="sheet-foot">
        <span>
          Contact Orelu support: <strong>{contactEmail}</strong>
        </span>
        <button type="button" className="b b-secondary" onClick={() => shell?.open("keys")}>
          <Keyboard size={16} aria-hidden />
          Keyboard shortcuts
        </button>
      </div>
    </Sheet>
  );
}

const newsIcons: Record<News["icon"], typeof Sparkles> = { sparkles: Sparkles, upload: Upload, inbox: Inbox, shield: ShieldCheck, calendar: CalendarDays, file: FileText };
const newsKinds: Record<News["icon"], string> = { sparkles: "approve", upload: "papers", inbox: "reply", shield: "done", calendar: "week", file: "docs" };
function NewsSheet({ open, close }: { open: boolean; close: () => void }) {
  return (
    <Sheet open={open} close={close} title="What's new">
      <ol className="news">
        {news.map((item) => {
          const Icon = newsIcons[item.icon];
          return (
            <li key={item.title}>
              <span className={`icon-tile k-${newsKinds[item.icon]}`} aria-hidden>
                <Icon size={15} />
              </span>
              <span>
                <time dateTime={item.date}>{new Date(`${item.date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</time>
                <strong>{item.title}</strong>
                <p>{item.line}</p>
              </span>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}

const keyGroups: [string, [string, string[]][]][] = [
  ["Everywhere", [["Search or jump to", ["/"]], ["Search", ["Ctrl", "K"]], ["Start something new", ["C"]], ["Keyboard shortcuts", ["?"]], ["Fold the sidebar", ["["]]]],
  ["Go to", [["Today", ["G", "T"]], ["Inbox", ["G", "I"]], ["Clients", ["G", "C"]], ["Documents", ["G", "D"]]]],
  ["Lists and tables", [["Next row", ["J"]], ["Previous row", ["K"]], ["Open the row", ["Enter"]]]],
  ["Panels and search", [["Move in the results", ["↑", "↓"]], ["Open the result", ["Enter"]], ["Close", ["Esc"]]]],
];
// The shortcuts overlay (?). It opens quickly and quietly: it is reached from the keyboard.
function KeysOverlay({ open, close }: { open: boolean; close: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(now) => !now && close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop className="sheet-backdrop" render={<m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} />} />
            <Dialog.Popup className="keys-pop" render={<m.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.14 }} />}>
              <Dialog.Title>Keyboard shortcuts</Dialog.Title>
              <div className="keys">
                {keyGroups.map(([group, keys]) => (
                  <section key={group}>
                    <h3>{group}</h3>
                    <ul>
                      {keys.map(([what, combo]) => (
                        <li key={what}>
                          <span>{what}</span>
                          <span>
                            {combo.map((part) => (
                              <kbd key={part}>{part}</kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
