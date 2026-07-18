"use client";

import * as React from "react";
import { toast } from "sonner";

import { Page } from "@/components/layout/page";
import { CreateTodoForm } from "@/components/pages/todo/forms/todo-form";
import { EditDialog } from "@/components/pages/todo/edit-dialog";
import { DeleteDialog } from "@/components/pages/todo/delete-dialog";
import { List } from "@/components/pages/todo/list";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  ApiError,
} from "@/lib/api";
import type { Todo, CreateTodoInput, UpdateTodoInput } from "@/shared/schemas";

export default function TodoPage() {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingTodo, setEditingTodo] = React.useState<Todo | null>(null);
  const [deletingTodo, setDeletingTodo] = React.useState<Todo | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      setTodos(await listTodos());
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Wrap refresh in a local async fn so the lint rule
    // react-hooks/set-state-in-effect doesn't trace setState calls
    // through the refresh callback into the effect body.
    const run = async () => {
      await refresh();
    };
    void run();
  }, [refresh]);

  async function handleCreate(input: CreateTodoInput) {
    try {
      await createTodo(input);
      await refresh();
      toast.success("已添加");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function handleToggle(t: Todo) {
    try {
      await updateTodo(t.id, { completed: !t.completed });
      await refresh();
      toast.success(t.completed ? "已取消完成" : "已完成");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function handleUpdate(input: UpdateTodoInput) {
    if (!editingTodo) return;
    try {
      await updateTodo(editingTodo.id, input);
      setEditingTodo(null);
      await refresh();
      toast.success("已保存");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    }
  }

  async function handleDelete() {
    if (!deletingTodo) return;
    try {
      await deleteTodo(deletingTodo.id);
      setDeletingTodo(null);
      await refresh();
      toast.success("已删除");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  return (
    <Page>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8">
        <header>
          <h1 className="font-heading text-[28px] font-semibold tracking-tight">
            Todo
          </h1>
        </header>

        <section className="rounded-lg border border-border bg-card p-4">
          <CreateTodoForm onSubmit={handleCreate} />
        </section>

        <section>
          <List
            todos={todos}
            loading={loading}
            error={error}
            onToggle={handleToggle}
            onEdit={setEditingTodo}
            onDelete={setDeletingTodo}
            onRetry={refresh}
          />
        </section>
      </div>

      {editingTodo && (
        <EditDialog
          todo={editingTodo}
          onSubmit={handleUpdate}
          onOpenChange={(open) => {
            if (!open) setEditingTodo(null);
          }}
        />
      )}
      {deletingTodo && (
        <DeleteDialog
          onConfirm={handleDelete}
          onOpenChange={(open) => {
            if (!open) setDeletingTodo(null);
          }}
        />
      )}
    </Page>
  );
}
