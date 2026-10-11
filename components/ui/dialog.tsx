"use client";
import { Dialog as Primitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/src/lib/utils";

// shadcn's Base UI dialog, kept to the primitives this page uses.
export const Dialog = Primitive.Root;
export function DialogContent({
  className,
  children,
  ...props
}: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="dialog-overlay" />
      <Primitive.Popup
        data-slot="dialog-content"
        className={cn("dialog-content", className)}
        {...props}
      >
        {children}
        <Primitive.Close
          data-slot="dialog-close"
          className="dialog-close"
          aria-label="Close"
        >
          <X size={20} aria-hidden />
        </Primitive.Close>
      </Primitive.Popup>
    </Primitive.Portal>
  );
}
export function DialogTitle({ className, ...props }: Primitive.Title.Props) {
  return (
    <Primitive.Title
      data-slot="dialog-title"
      className={cn("dialog-title", className)}
      {...props}
    />
  );
}
export function DialogDescription({
  className,
  ...props
}: Primitive.Description.Props) {
  return (
    <Primitive.Description
      data-slot="dialog-description"
      className={cn("dialog-description", className)}
      {...props}
    />
  );
}
