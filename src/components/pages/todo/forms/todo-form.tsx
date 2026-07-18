"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import {
  createTodoSchema,
  updateTodoSchema,
  utcStartOfTodayMs,
  type CreateTodoInput,
  type UpdateTodoInput,
  type Priority,
  type Todo,
} from "@/shared/schemas";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Spinner } from "@/components/ui/spinner";
import { Select } from "@/components/ui/select";
import { useState } from "react";

type FormValues = {
  task: string;
  priority: Priority;
  dueDate: number;
};

const PRIORITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

// Internal base form. `edit` controls: which zod schema, whether past dates
// are disabled, whether the Cancel button shows, and the FieldDescription.
// Not exported — CreateTodoForm and UpdateTodoForm are the public API.
// Constraint is Partial<FormValues> so both CreateTodoInput (required fields)
// and UpdateTodoInput (optional fields + extra completed) satisfy T.
function Form<T extends Partial<FormValues>>({
  edit,
  defaultValues,
  onSubmit,
  onCancel,
}: {
  edit: boolean;
  defaultValues: FormValues;
  onSubmit: (input: T) => Promise<void>;
  onCancel?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const resolver = zodResolver(edit ? updateTodoSchema : createTodoSchema);

  const form = useForm<FormValues>({
    resolver: resolver as never,
    defaultValues,
  });

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await onSubmit(values as T);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} noValidate className="flex flex-col gap-4">
      <Controller
        name="task"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>任务</FieldLabel>
            <Input
              {...field}
              id={field.name}
              placeholder="写点什么…"
              aria-invalid={fieldState.invalid}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        name="priority"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>优先级</FieldLabel>
            <Select
              {...field}
              options={PRIORITY_OPTIONS}
              aria-label="优先级"
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        name="dueDate"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>完成时间</FieldLabel>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal")}
                  aria-invalid={fieldState.invalid}
                >
                  <CalendarIcon className="size-4 opacity-50" />
                  {field.value ? format(new Date(field.value), "yyyy-MM-dd") : "选择日期"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={field.value ? new Date(field.value) : undefined}
                  onSelect={(d) => {
                    if (!d) return;
                    const ts = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
                    field.onChange(ts);
                  }}
                  disabled={edit ? undefined : { before: new Date() }}
                />
              </PopoverContent>
            </Popover>
            {!edit && (
              <FieldDescription>不能选择今天之前的日期</FieldDescription>
            )}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <div className="flex justify-end gap-2">
        {edit && onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting && <Spinner className="size-4" />}
          {edit ? "保存" : "提交"}
        </Button>
      </div>
    </form>
  );
}

export function CreateTodoForm({
  onSubmit,
}: {
  onSubmit: (input: CreateTodoInput) => Promise<void>;
}) {
  return (
    <Form<CreateTodoInput>
      edit={false}
      defaultValues={{ task: "", priority: "medium", dueDate: utcStartOfTodayMs() }}
      onSubmit={onSubmit}
    />
  );
}

export function UpdateTodoForm({
  todo,
  onSubmit,
  onCancel,
}: {
  todo: Todo;
  onSubmit: (input: UpdateTodoInput) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Form<UpdateTodoInput>
      edit={true}
      defaultValues={{ task: todo.task, priority: todo.priority, dueDate: todo.dueDate }}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}
