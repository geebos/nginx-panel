"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { UpdateTodoForm } from "@/components/pages/todo/forms/todo-form";
import type { Todo, UpdateTodoInput } from "@/shared/schemas";

type EditDialogProps = {
  todo: Todo;
  onSubmit: (input: UpdateTodoInput) => Promise<void>;
  onOpenChange: (open: boolean) => void;
};

export function EditDialog({ todo, onSubmit, onOpenChange }: EditDialogProps) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑任务</DialogTitle>
          <DialogDescription>修改任务、优先级或完成时间。</DialogDescription>
        </DialogHeader>
        <UpdateTodoForm
          todo={todo}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
