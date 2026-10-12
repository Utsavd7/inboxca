"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { InviteForm } from "./invite-form";

export default function InviteDialog({
  trigger,
  close,
}: {
  trigger: HTMLElement;
  close: () => void;
}) {
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent finalFocus={() => trigger}>
        <DialogTitle>Ask for an invite</DialogTitle>
        <DialogDescription>
          InboxCA is in development. The first firms join by invitation, with a
          14 day money back when you join.
        </DialogDescription>
        <InviteForm />
      </DialogContent>
    </Dialog>
  );
}
