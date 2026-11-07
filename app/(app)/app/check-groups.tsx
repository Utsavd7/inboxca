"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {FileText} from "lucide-react";
import {checkGroup} from "./clients/[id]/dataset-actions";
import {typing} from "./command";
import {Pending} from "./pending";

export type CheckGroup={key:string;draft:string;revision:number;title:string;sub:string;blocked?:string;figures:{id:string;label:string;value:string;wrong:boolean;where:string;href:string}[]};

// A return's Check step as rows (GroupChecks in return-work.tsx): each group of figures with one
// All correct, any figure in it chosen as Wrong first, and its paper at its spot one click away.
// J/K or the arrows move between groups, Y says All correct (or saves the ticks), N goes to the
// group's first figure (Space marks it wrong), Esc comes back to the group.
export function CheckGroups({client,groups,figures,more,canCheck,why,focus}:{client:string;groups:CheckGroup[];figures:number;more:number;canCheck:boolean;why:string;focus:boolean}) {
  const [at,setAt]=useState(0),root=useRef<HTMLOListElement>(null),on=Math.min(at,groups.length-1);
  const row=(n:number)=>root.current?.children[n] as HTMLElement|undefined;
  const go=(n:number)=>{const next=Math.max(0,Math.min(groups.length-1,n));setAt(next);requestAnimationFrame(()=>{const el=row(next);el?.focus({preventScroll:true});el?.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});});};
  // After a save the page comes back with the next group in the same place: keyboard work carries on there.
  const shown=groups.map(group=>`${group.key}:${group.revision}`).join();
  useEffect(()=>{if(focus) root.current?.querySelector<HTMLElement>(".cg-row.is-on")?.focus({preventScroll:true});},[focus,shown]);
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[role=dialog], [role=menu]")) return;
      const inside=!!root.current?.contains(document.activeElement);
      if(event.key==="Escape" && inside) {row(on)?.focus();event.preventDefault();return;}
      if(typing(event.target) && (event.target as HTMLInputElement).type!=="checkbox") return;
      const key=event.key.toLowerCase();
      if(key==="j" || inside && event.key==="ArrowDown") go(on+1);
      else if(key==="k" || inside && event.key==="ArrowUp") go(on-1);
      else if(key==="y") row(on)?.querySelector<HTMLButtonElement>("button:not([type=button], :disabled)")?.click();
      else if(key==="n") row(on)?.querySelector<HTMLInputElement>("input[name=wrong]:not(:disabled)")?.focus();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown",keys);
    return ()=>document.removeEventListener("keydown",keys);
  });
  return <section className="cg" aria-label="Figures not checked yet">
    <header className="cg-head">
      <p><strong>{figures} {figures===1 ? "figure" : "figures"} not checked yet.</strong><span className="sub">Approving waits until every one is checked.</span></p>
      <p className="keys fc-keys" aria-hidden><span><kbd>J</kbd><kbd>K</kbd> move</span><span><kbd>Y</kbd> all correct</span><span><kbd>N</kbd> mark one wrong</span></p>
    </header>
    {why && <p className="fig-why">{why}</p>}
    <ol className="cg-list" ref={root}>
      {groups.map((group,n)=><Group key={`${group.key}:${group.revision}`} client={client} group={group} on={n===on} canCheck={canCheck} choose={()=>setAt(n)}/>)}
    </ol>
    {more>0 && <p className="hint">{more} more {more===1 ? "group" : "groups"} after these.</p>}
  </section>;
}

function Group({client,group,on,canCheck,choose}:{client:string;group:CheckGroup;on:boolean;canCheck:boolean;choose:()=>void}) {
  const [wrong,setWrong]=useState(()=>group.figures.filter(figure=>figure.wrong).length);
  const first=group.figures[0];
  return <li className={`cg-row${on ? " is-on" : ""}`} tabIndex={on ? 0 : -1} aria-label={`${group.title}${group.sub ? `, ${group.sub}` : ""}`} onFocus={choose} onPointerDown={choose}>
    <form action={checkGroup} onChange={(event)=>setWrong(event.currentTarget.querySelectorAll("input[name=wrong]:checked").length)}>
      <input type="hidden" name="client" value={client}/><input type="hidden" name="draft" value={group.draft}/><input type="hidden" name="revision" value={group.revision}/>
      {group.figures.map(figure=><input key={figure.id} type="hidden" name="line" value={figure.id}/>)}
      <div className="cg-top">
        <p className="cg-name"><strong>{group.title}</strong>{group.sub && <span className="sub">{group.sub}</span>}</p>
        <Link className="fig-from" href={first.href} scroll={false} title="Open the paper at this spot"><FileText size={13} aria-hidden/>{first.where}</Link>
        <Pending className={`b ${on ? "b-primary" : "b-secondary"} b-small cg-go`} disabled={!canCheck || !!group.blocked} busy="Saving">{wrong ? `Save, ${wrong} wrong` : "All correct"}{on && <kbd aria-hidden>Y</kbd>}</Pending>
      </div>
      <ul className="cg-figs">
        {group.figures.map(figure=><li key={figure.id}>
          <label className="cg-fig" title={`${figure.label}: ${figure.where}. Choose it if it is wrong.`}>
            <input type="checkbox" name="wrong" value={figure.id} defaultChecked={figure.wrong} disabled={!canCheck}/>
            <span className="cg-label">{figure.label}</span><span className="cg-value">{figure.value}</span><span className="cg-flag">Wrong</span>
          </label>
          {figure.wrong && <Link className="cg-fix" href={figure.href} scroll={false}>Correct</Link>}
        </li>)}
      </ul>
      {group.blocked && <p className="fig-why">{group.blocked}</p>}
    </form>
  </li>;
}
