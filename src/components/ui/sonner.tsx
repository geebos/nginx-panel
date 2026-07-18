import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const DEFAULT_MOBILE_OFFSET = {
  top: "calc(env(safe-area-inset-top, 0px) + 16px)",
  right: "16px",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  left: "16px",
}

function getMobileOffset(
  mobileOffset: ToasterProps["mobileOffset"]
): ToasterProps["mobileOffset"] {
  if (mobileOffset && typeof mobileOffset === "object") {
    return {
      ...DEFAULT_MOBILE_OFFSET,
      ...mobileOffset,
    }
  }

  return mobileOffset ?? DEFAULT_MOBILE_OFFSET
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      mobileOffset={getMobileOffset(props.mobileOffset)}
      {...props}
    />
  )
}

export { Toaster }
