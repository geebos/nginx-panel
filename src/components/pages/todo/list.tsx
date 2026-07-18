"use client";

import * as React from "react";
import { format } from "date-fns";
import { PencilIcon, Trash2Icon } from "lucide-react";

import type { Todo } from "@/shared/schemas";
import { utcStartOfTodayMs } from "@/shared/schemas";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

type ListProps = {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  onToggle: (t: Todo) => void;
  onEdit: (t: Todo) => void;
  onDelete: (t: Todo) => void;
  onRetry: () => void;
};

const PRIORITY_BADGE_CLASS: Record<Todo["priority"], string> = {
  high: "bg-destructive text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-secondary text-secondary-foreground",
};

const PRIORITY_LABEL: Record<Todo["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function List({
  todos,
  loading,
  error,
  onToggle,
  onEdit,
  onDelete,
  onRetry,
}: ListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>加载失败</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onRetry}>重试</Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (todos.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>还没有任务</EmptyTitle>
          <EmptyDescription>在上方添加你的第一个任务。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {todos.map((t) => {
        const overdue = !t.completed && t.dueDate < utcStartOfTodayMs();
        return (
          <li
            key={t.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
          >
            <Checkbox
              checked={t.completed}
              onCheckedChange={() => onToggle(t)}
              aria-label="标记完成"
            />
            <span
              className={cn(
                "flex-1 truncate text-sm",
                t.completed && "line-through text-muted-foreground",
              )}
            >
              {t.task}
            </span>
            <Badge className={PRIORITY_BADGE_CLASS[t.priority]}>
              {PRIORITY_LABEL[t.priority]}
            </Badge>
            <span
              className={cn(
                "text-xs tabular-nums",
                overdue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {format(new Date(t.dueDate), "yyyy-MM-dd")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(t)}
              aria-label="编辑"
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(t)}
              aria-label="删除"
            >
              <Trash2Icon className="size-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
