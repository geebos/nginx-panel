"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

type ResponsiveDialogMode = "dialog" | "sheet"
type ResponsiveDialogSide = "top" | "right" | "bottom" | "left"

type ResponsiveDialogContextValue = {
  mode: ResponsiveDialogMode
  side: ResponsiveDialogSide
}

const ResponsiveDialogContext =
  React.createContext<ResponsiveDialogContextValue>({
    mode: "dialog",
    side: "bottom",
  })

function ResponsiveDialog({
  children,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof Dialog> & {
  side?: ResponsiveDialogSide
}) {
  const isMobile = useIsMobile()
  const mode: ResponsiveDialogMode = isMobile ? "sheet" : "dialog"
  const context = React.useMemo<ResponsiveDialogContextValue>(
    () => ({ mode, side }),
    [mode, side]
  )

  if (mode === "sheet") {
    return (
      <ResponsiveDialogContext.Provider value={context}>
        <Sheet side={side} {...props}>
          {children}
        </Sheet>
      </ResponsiveDialogContext.Provider>
    )
  }

  return (
    <ResponsiveDialogContext.Provider value={context}>
      <Dialog {...props}>{children}</Dialog>
    </ResponsiveDialogContext.Provider>
  )
}

function ResponsiveDialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogTrigger>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetTrigger {...props} />
  }

  return <DialogTrigger {...props} />
}

function ResponsiveDialogClose({
  ...props
}: React.ComponentProps<typeof DialogClose>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetClose {...props} />
  }

  return <DialogClose {...props} />
}

function ResponsiveDialogContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return (
      <SheetContent className={className} {...props}>
        <SheetTitle className="sr-only">Dialog</SheetTitle>
        {children}
      </SheetContent>
    )
  }

  return (
    <DialogContent
      className={cn(
        "max-h-[calc(100svh-4rem)] overflow-y-auto md:max-w-3xl",
        className
      )}
      {...props}
    >
      <DialogTitle className="sr-only">Dialog</DialogTitle>
      {children}
    </DialogContent>
  )
}

function ResponsiveDialogHeader({
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetHeader {...props} />
  }

  return <DialogHeader {...props} />
}

function ResponsiveDialogFooter({
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetFooter {...props} />
  }

  return <DialogFooter {...props} />
}

function ResponsiveDialogTitle({
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetTitle {...props} />
  }

  return <DialogTitle {...props} />
}

function ResponsiveDialogDescription({
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  const { mode } = React.useContext(ResponsiveDialogContext)

  if (mode === "sheet") {
    return <SheetDescription {...props} />
  }

  return <DialogDescription {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
}
