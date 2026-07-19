import * as React from "react";
import { diffChars, diffLines, type Change } from "diff";

type InlinePart = { text: string; type: "equal" | "added" | "removed" };

// 每行渲染为左右两个 cell：equal/modified 行两侧都有内容并按 token 上色；
// removed-only 行只填左列（整行删除底色），added-only 行只填右列（整行新增底色）。
type Row =
  | { kind: "equal"; left: InlinePart[]; right: InlinePart[] }
  | { kind: "modified"; left: InlinePart[]; right: InlinePart[] }
  | { kind: "removed"; left: InlinePart[]; right: null }
  | { kind: "added"; left: null; right: InlinePart[] };

const CELL_BASE = "whitespace-pre px-2 py-0.5";

function toInlineParts(tokens: Change[], side: "left" | "right"): InlinePart[] {
  const parts: InlinePart[] = [];
  for (const token of tokens) {
    if (token.added) {
      if (side === "right") parts.push({ text: token.value, type: "added" });
    } else if (token.removed) {
      if (side === "left") parts.push({ text: token.value, type: "removed" });
    } else {
      parts.push({ text: token.value, type: "equal" });
    }
  }
  return parts;
}

// 先行级 diff，再把相邻的 removed/added 行配对，对配对行做字符级 inline diff。
function buildRows(oldText: string, newText: string): Row[] {
  const changes = diffLines(oldText, newText, { stripTrailingCr: true, oneChangePerToken: true });
  const lines = changes.map((change) => ({
    text: change.value.replace(/\n$/, ""),
    type: (change.added ? "added" : change.removed ? "removed" : "equal") as "equal" | "added" | "removed",
  }));

  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === "equal") {
      const text = lines[i].text;
      rows.push({ kind: "equal", left: [{ text, type: "equal" }], right: [{ text, type: "equal" }] });
      i += 1;
      continue;
    }
    const removed: string[] = [];
    while (i < lines.length && lines[i].type === "removed") {
      removed.push(lines[i].text);
      i += 1;
    }
    const added: string[] = [];
    while (i < lines.length && lines[i].type === "added") {
      added.push(lines[i].text);
      i += 1;
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
      const r = removed[k];
      const a = added[k];
      if (r !== undefined && a !== undefined) {
        const tokens = diffChars(r, a);
        rows.push({ kind: "modified", left: toInlineParts(tokens, "left"), right: toInlineParts(tokens, "right") });
      } else if (r !== undefined) {
        rows.push({ kind: "removed", left: [{ text: r, type: "removed" }], right: null });
      } else {
        rows.push({ kind: "added", left: null, right: [{ text: a as string, type: "added" }] });
      }
    }
  }
  return rows;
}

function DiffCell({ parts, rowKind, side }: { parts: InlinePart[] | null; rowKind: Row["kind"]; side: "left" | "right" }) {
  if (!parts) return <div className={CELL_BASE}>{" "}</div>;
  const toneClass =
    rowKind === "removed" && side === "left"
      ? "bg-destructive/10 text-destructive"
      : rowKind === "added" && side === "right"
        ? "bg-success/10 text-success"
        : rowKind === "modified" && side === "left"
          ? "bg-destructive/5"
          : rowKind === "modified" && side === "right"
            ? "bg-success/5"
            : undefined;
  const cellClass = toneClass ? `${CELL_BASE} ${toneClass}` : CELL_BASE;
  return (
    <div className={cellClass}>
      {parts.map((part, index) => {
        const spanClass =
          part.type === "added"
            ? "bg-success/15 text-success"
            : part.type === "removed"
              ? "bg-destructive/15 text-destructive"
              : undefined;
        return (
          <span className={spanClass} key={index}>
            {part.text}
          </span>
        );
      })}
    </div>
  );
}

export interface TextDiffProps {
  oldText: string;
  newText: string;
  className?: string;
}

export function TextDiff({ oldText, newText, className }: TextDiffProps) {
  const rows = React.useMemo(() => buildRows(oldText, newText), [oldText, newText]);
  return (
    <div className={`overflow-auto rounded-lg border border-border bg-muted/30 font-mono text-xs ${className ?? ""}`}>
      <div className="grid grid-cols-[minmax(min-content,1fr)_minmax(min-content,1fr)]">
        <div className="border-b border-border bg-muted/60 px-2 py-1 text-muted-foreground">Base</div>
        <div className="border-b border-border bg-muted/60 px-2 py-1 text-muted-foreground">Target</div>
        {rows.map((row, index) => (
          <React.Fragment key={index}>
            <DiffCell parts={row.left} rowKind={row.kind} side="left" />
            <DiffCell parts={row.right} rowKind={row.kind} side="right" />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
