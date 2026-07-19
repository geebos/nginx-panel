import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  PauseCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2Icon }
> = {
  active: { label: "Active", variant: "outline", icon: CheckCircle2Icon },
  succeeded: { label: "Success", variant: "outline", icon: CheckCircle2Icon },
  draft: { label: "Draft", variant: "secondary", icon: CircleDashedIcon },
  pending: { label: "Pending", variant: "secondary", icon: CircleDashedIcon },
  queued: { label: "Queued", variant: "secondary", icon: CircleDashedIcon },
  running: { label: "Running", variant: "outline", icon: CheckCircle2Icon },
  testing: { label: "Testing", variant: "outline", icon: LoaderCircleIcon },
  disabled: { label: "Disabled", variant: "secondary", icon: PauseCircleIcon },
  failed: { label: "Failed", variant: "destructive", icon: AlertCircleIcon },
  unknown: { label: "Unknown", variant: "outline", icon: CircleDashedIcon },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = statusMap[status] ?? {
    label: status,
    variant: "outline" as const,
    icon: CircleDashedIcon,
  };
  const Icon = entry.icon;
  return (
    <Badge variant={entry.variant}>
      <Icon
        data-icon="inline-start"
        className={status === "testing" ? "animate-spin" : status === "running" ? "text-success" : undefined}
      />
      {entry.label}
    </Badge>
  );
}
