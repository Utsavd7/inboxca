"use client";
import {useEffect} from "react";
import {logFormView} from "@/app/(app)/actions";
import {useCaptureGuard} from "./file-viewer";

// A prepared return shown as its form keeps a paper's safeguards: the viewer's email and the time
// across it, no copying, hidden on a screenshot key (or, with the firm's setting, while InboxCA is
// not the active window), and a line in the view log.
export function FormStamp({id,label,hideInactive,children}:{id:string;label:string;hideInactive:boolean;children:React.ReactNode}) {
  const blank=useCaptureGuard(id,hideInactive);
  useEffect(()=>{void logFormView(id);},[id]);
  const text=label.replace(/[&<>"']/g,(char)=>`&#${char.charCodeAt(0)};`);
  const stamp=`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><text x="40" y="160" transform="rotate(-24 280 120)" font-family="sans-serif" font-size="15" font-weight="600" fill="rgba(24,32,47,0.13)">${text}</text></svg>`;
  return <div className={`pf${blank ? " is-blank" : ""}`} onCopy={(event)=>event.preventDefault()} onContextMenu={(event)=>event.preventDefault()} onDragStart={(event)=>event.preventDefault()}>
    {children}
    <div className="pf-stamp" aria-hidden style={{backgroundImage:`url("data:image/svg+xml,${encodeURIComponent(stamp)}")`}}/>
    {blank && <p className="hint pf-hidden">The form is hidden. It shows again in a few seconds, or when you come back to this window.</p>}
  </div>;
}
