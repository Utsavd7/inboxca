"use client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InviteForm } from "./invite-form";
export default function DialogContents({ kind, trigger, close }: { kind: "invite" | "film"; trigger: HTMLElement; close: () => void }) {
  return <Dialog defaultOpen onOpenChange={open => { if (!open) close(); }}><DialogContent className={kind === "film" ? "film-dialog" : "invite-dialog"} finalFocus={() => trigger}>
    <DialogTitle>{kind === "film" ? "Meet InboxCA" : "Ask for an invite"}</DialogTitle>
    <DialogDescription>{kind === "film" ? "Illustration · sample data" : "In development. First firms by invitation."}</DialogDescription>
    {kind === "film" ? <video controls playsInline preload="metadata" poster="/media/inboxca-film.webp" width="540" height="960" aria-label="InboxCA product film"><source src="/media/inboxca-film.mp4" type="video/mp4" /><track default kind="captions" src="/media/inboxca-film.vtt" srcLang="en" label="English" /></video> : <InviteForm />}
  </DialogContent></Dialog>;
}
