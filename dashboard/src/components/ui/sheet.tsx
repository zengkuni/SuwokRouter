"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type React from "react";
import { cn } from "@/lib/utils";

export const Sheet: typeof DialogPrimitive.Root = DialogPrimitive.Root;
export const SheetTrigger: typeof DialogPrimitive.Trigger = DialogPrimitive.Trigger;
export const SheetClose: typeof DialogPrimitive.Close = DialogPrimitive.Close;

export function SheetPopup({
  className,
  children,
  variant = "inset",
  ...props
}: DialogPrimitive.Popup.Props & {
  variant?: "default" | "inset";
}): React.ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex justify-end p-0 sm:p-3">
        <DialogPrimitive.Popup
          className={cn(
            "relative flex h-full min-h-0 w-full min-w-0 max-w-2xl flex-col overflow-hidden border bg-popover text-popover-foreground outline-none transition-[translate,opacity] duration-200 ease-out data-ending-style:translate-x-full data-ending-style:opacity-0 data-starting-style:translate-x-full data-starting-style:opacity-0 sm:rounded-2xl sm:border",
            variant === "inset" && "sm:h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-1.5rem)]",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("shrink-0 border-b border-border/70 px-6 py-5", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("font-heading text-xl font-semibold leading-none", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("mt-2 text-sm text-muted-foreground", className)} {...props} />;
}

export function SheetPanel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 justify-end gap-2 border-t border-border/70 px-6 py-4", className)} {...props} />;
}
