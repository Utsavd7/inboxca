"use client";
import {PanelRightOpen} from "lucide-react";
import {useRouter} from "next/navigation";
import {useEffect,useRef,useState,useTransition} from "react";

// Reads the page again 3 seconds after the last reading ended, while InboxCA saves a return
// file, so the file shows by itself when it is ready. It stops after 40 readings, or once the
// page no longer draws it.
export function Refresh() {
  const router=useRouter(),[reading,read]=useTransition(),left=useRef(40);
  useEffect(()=>{
    if(reading || left.current<=0) return;
    const timer=window.setTimeout(()=>{left.current--;read(()=>router.refresh());},3000);
    return ()=>window.clearTimeout(timer);
  },[reading,router]);
  return null;
}

// Menus made of <details className="rf-menu">: a click outside one, or Escape, closes it.
export function MenuClose() {
  useEffect(()=>{
    const open=()=>[...document.querySelectorAll<HTMLDetailsElement>("details.rf-menu[open]")];
    const click=(event:PointerEvent)=>open().forEach(menu=>{if(!menu.contains(event.target as Node)) menu.open=false;});
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape") open().forEach(menu=>{menu.open=false;menu.querySelector("summary")?.focus();});};
    document.addEventListener("pointerdown",click);document.addEventListener("keydown",key);
    return ()=>{document.removeEventListener("pointerdown",click);document.removeEventListener("keydown",key);};
  },[]);
  return null;
}

// Download for filing says it started and waits a few seconds, so a second click does not download it again.
export function FilingDownload({id,primary,disabled}:{id:string;primary:boolean;disabled:boolean}) {
  const [sent,setSent]=useState(false);
  useEffect(()=>{if(!sent) return;const timer=window.setTimeout(()=>setSent(false),4000);return ()=>window.clearTimeout(timer);},[sent]);
  return <form action={`/app/files/${id}/filing`} method="post" onSubmit={()=>setSent(true)}><button className={`b ${primary ? "b-primary" : "b-secondary"}`} disabled={disabled || sent} aria-busy={sent || undefined}>{sent ? "Downloading" : "Download for filing"}</button></form>;
}

// The paper a figure came from, beside the figures. Close hides it (kept loaded) until asked again.
export function SourcePane({title,children}:{title:React.ReactNode;children:React.ReactNode}) {
  const [open,setOpen]=useState(true);
  return <>
    {!open && <button type="button" className="b b-secondary b-small fig-pane-show" onClick={()=>setOpen(true)}><PanelRightOpen size={15} aria-hidden/>Show the paper</button>}
    <aside className="fig-pane" aria-label="Source paper" hidden={!open}>
      <header className="fig-pane-head">{title}<button type="button" className="b b-ghost b-small" onClick={()=>setOpen(false)}>Close</button></header>
      {children}
    </aside>
  </>;
}
