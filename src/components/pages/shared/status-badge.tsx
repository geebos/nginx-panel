import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  PauseCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

const statusMap: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2Icon }
> = {
  active: { variant: "outline", icon: CheckCircle2Icon },
  succeeded: { variant: "outline", icon: CheckCircle2Icon },
  draft: { variant: "secondary", icon: CircleDashedIcon },
  pending: { variant: "secondary", icon: CircleDashedIcon },
  queued: { variant: "secondary", icon: CircleDashedIcon },
  running: { variant: "outline", icon: CheckCircle2Icon },
  testing: { variant: "outline", icon: LoaderCircleIcon },
  disabled: { variant: "secondary", icon: PauseCircleIcon },
  failed: { variant: "destructive", icon: AlertCircleIcon },
  unknown: { variant: "outline", icon: CircleDashedIcon },
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(["common"]);
  const entry = statusMap[status] ?? {
    variant: "outline" as const,
    icon: CircleDashedIcon,
  };
  const Icon = entry.icon;
  const label = t(`common:status.${status}`, { defaultValue: status });
  return (
    <Badge variant={entry.variant}>
      <Icon
        data-icon="inline-start"
        className={status === "testing" ? "animate-spin" : status === "running" ? "text-success" : undefined}
      />
      {label}
    </Badge>
  );
}
