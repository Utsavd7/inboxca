"use client";
import { Popover } from "@base-ui/react/popover";
import { Check, Plus } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { coverReturn, deskPeople, setDesk } from "@/app/(app)/actions";
import { deskNames, type Desk, type DeskWork, type Holder } from "@/src/lib/desks";
import { ToastMotion } from "./motion";
import { Avatar } from "./ui";
import "./desk-chip.css";

// Who does a client's work, as a chip beside its name, the same everywhere (20261113100000_take_work.sql).
// A desk nobody holds is a dashed Take; anyone who does the work takes it in one click, or hands
// back their own. The owner, partners and managers pick anyone instead: a search, then people
// and teams, the current one ticked, and Nobody. A return's row also has This return only, for
// one person to do just that return (leave cover). Every change has an Undo.
export type Viewer = { id: string; assign: boolean; take: boolean };
type Person = Holder & { role: string };
type Toast = { at: number; text: string; undo?: () => void };

// The toasts outlive the chip, as a row that leaves after a change takes its chip with it.
let said: Toast | null = null;
const heard = new Set<() => void>();
const say = (toast: Omit<Toast, "at">) => {
  said = { ...toast, at: Date.now() };
  heard.forEach((listen) => listen());
};
const listen = (on: () => void) => (heard.add(on), () => heard.delete(on));
export function DeskToasts() {
  const toast = useSyncExternalStore(listen, () => said, () => null);
  return toast ? (
    <ToastMotion key={toast.at}>
      <span>{toast.text}</span>
      {toast.undo && <button type="button" className="b b-ghost" onClick={toast.undo}>Undo</button>}
    </ToastMotion>
  ) : null;
}

let everyone: Promise<Person[]> | null = null;
const deskOf = (work: DeskWork) => (work ? deskNames[work] : "the work");

export function DeskChip({ client, desks, work, task, viewer, named = false }: { client: { id: string; name: string }; desks: Desk[]; work?: DeskWork; task?: { id: string; doer: Holder | null }; viewer: Viewer; named?: boolean }) {
  const shown = work === undefined ? desks : desks.filter((desk) => desk.work === null || desk.work === work).slice(0, 1);
  const sections = [...shown.map((desk) => ({ key: `desk:${desk.work}`, label: desk.work ? deskNames[desk.work] : "This client", desk })), ...(task ? [{ key: "task", label: "This return only", desk: null }] : [])];
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(sections[0]?.key ?? "");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [find, setFind] = useState("");
  const [active, setActive] = useState(0);
  const [busy, start] = useTransition();
  if (!shown.length) return null;
  const section = sections.find((one) => one.key === at) ?? sections[0];
  const current = section.desk ? section.desk.holder : (task?.doer ?? null);
  const holders = [...new Map(shown.flatMap((desk) => (desk.holder ? [[desk.holder.id, desk.holder]] : []))).values()];
  const face = task?.doer ? [task.doer] : holders;
  const free = shown.some((desk) => !desk.holder);
  const may = viewer.assign || viewer.take;
  const owner = shown[0]?.holder?.name;
  const title = task?.doer ? `${task.doer.name} does this return. ${owner ? `${owner} does ${deskOf(shown[0].work)} for ${client.name}` : `Nobody does ${deskOf(shown[0].work)} for ${client.name} yet`}` : shown.map((desk) => `${desk.work ? `${deskNames[desk.work]}: ` : ""}${desk.holder?.name ?? "Nobody yet"}`).join(". ");

  // One change, then its toast with the change back as Undo (which works after the chip has gone).
  const act = async (to: Holder | null, from: Holder | null, again: boolean) => {
    const result = section.desk ? await setDesk(client.id, section.desk.work, to ? `${to.team ? "team" : "person"}:${to.id}` : "") : await coverReturn(task!.id, to ? `person:${to.id}` : "");
    if (result.error) return say({ text: result.error });
    setOpen(false);
    const what = section.desk ? `${deskOf(section.desk.work)} for ${client.name}` : `this return for ${client.name}`;
    const who = to?.id === viewer.id ? "You" : to?.name;
    say({
      text: !again ? "Undone." : who ? `${who} ${who === "You" ? "do" : "does"} ${what} now.` : from?.id === viewer.id ? `You handed back ${what}.` : section.desk ? `Nobody does ${what} now.` : `${client.name}'s return is back with its desk.`,
      undo: again ? () => act(from, to, false) : undefined,
    });
  };
  const change = (to: Holder | null, from: Holder | null) => start(() => act(to, from, true));
  const me: Holder = { id: viewer.id, team: false, name: "You" };
  const choices = (people ?? []).filter((person) => (section.desk || !person.team) && person.name.toLowerCase().includes(find.trim().toLowerCase()));
  const options = [...choices.map((person) => ({ key: person.id, person })), ...(current && !find ? [{ key: "nobody", person: null }] : [])];
  const pick = (person: Person | null) => person?.id !== current?.id && change(person, current);
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((at) => (at + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length));
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      pick(options[active].person);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setFind("");
        setActive(0);
        if (viewer.assign && !people) (everyone ??= deskPeople()).then(setPeople, () => (everyone = null));
      }}
    >
      <Popover.Trigger
        className={`desk-chip${face.length ? "" : " is-free"}${named ? " is-named" : ""}`}
        disabled={!may}
        title={title}
        aria-label={`${face.length ? `Who does the work: ${title}` : `Nobody does ${client.name}'s work yet`}. ${may ? "Change" : ""}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        {face.length ? (
          <>
            <span className="avatar-stack">{face.slice(0, 2).map((holder) => <Avatar key={holder.id} name={holder.name} square={holder.team} />)}</span>
            {named && <span className="desk-name">{face.map((holder) => holder.name).join(", ")}</span>}
            {free && may && <span className="desk-plus" aria-hidden><Plus size={10} strokeWidth={2.6} /></span>}
          </>
        ) : may ? (
          <><Plus size={12} strokeWidth={2.4} aria-hidden />{named && (viewer.assign ? "Assign" : "Take")}</>
        ) : (
          <span className="hint">Nobody yet</span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="menu-layer">
          <Popover.Popup className="menu-pop desk-pop" aria-busy={busy}>
            <Popover.Title className="desk-head">{client.name}</Popover.Title>
            {sections.length > 1 && (
              <div className="desk-tabs" role="tablist" aria-label="Which work">
                {sections.map((one) => (
                  <button key={one.key} type="button" role="tab" aria-selected={one.key === section.key} className={one.key === section.key ? "is-on" : ""} onClick={() => { setAt(one.key); setActive(0); }}>
                    {one.label}
                  </button>
                ))}
              </div>
            )}
            {viewer.assign ? (
              <>
                <input className="desk-find" autoFocus value={find} placeholder={section.desk ? "Find a person or team" : "Find a person"} aria-label="Find a person"
                  role="combobox" aria-expanded aria-controls={`desk-${client.id}`} aria-activedescendant={options[active] ? `desk-${client.id}-${options[active].key}` : undefined}
                  onChange={(event) => { setFind(event.target.value); setActive(0); }} onKeyDown={keys} />
                <ul id={`desk-${client.id}`} className="desk-list" role="listbox" aria-label="People">
                  {!people && <li className="skel" aria-hidden />}
                  {options.map((option, n) => (
                    <li key={option.key} id={`desk-${client.id}-${option.key}`} role="option" aria-selected={n === active} className={`menu-item${n === active ? " is-active" : ""}`} onMouseEnter={() => setActive(n)} onClick={() => pick(option.person)}>
                      {option.person ? <Avatar name={option.person.name} square={option.person.team} /> : <span className="desk-none" aria-hidden />}
                      <span className="grow">{option.person ? `${option.person.name}${option.person.id === viewer.id ? " (you)" : ""}` : section.desk ? "Nobody" : "Back to the desk"}</span>
                      {option.person && <small>{option.person.role}</small>}
                      {option.person?.id === current?.id && <Check className="menu-check" size={16} aria-label="Now" />}
                    </li>
                  ))}
                  {people && !options.length && <li className="desk-empty">Nobody by that name</li>}
                </ul>
                {!section.desk && <p className="desk-note">{task?.doer ? "Only this return. It goes back to the desk once filed." : `Only this return. ${owner ?? "Nobody"} still does ${deskOf(shown[0].work)} for the client.`}</p>}
              </>
            ) : (
              <div className="desk-self">
                {current?.id === viewer.id ? (
                  <><p>{section.desk ? `You do ${deskOf(section.desk.work)} for this client.` : "You do this return."}</p><button type="button" className="b b-secondary" disabled={busy} onClick={() => change(null, current)}>{section.desk ? "Hand back" : "Hand back this one"}</button></>
                ) : current ? (
                  <p>{section.desk ? `${current.name} does ${deskOf(section.desk.work)} for this client. A manager can change it.` : `${current.name} does this return.`}</p>
                ) : (
                  <><p>{section.desk ? `Nobody does ${deskOf(section.desk.work)} for this client yet.` : `Only this return. ${owner ?? "Nobody"} still does the rest.`}</p><button type="button" className="b b-primary" disabled={busy} autoFocus onClick={() => change(me, null)}>{section.desk ? "Take it" : "I'll do this one"}</button></>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
