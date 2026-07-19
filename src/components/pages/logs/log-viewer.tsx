import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon, FileTextIcon, GripVerticalIcon, PauseIcon, PlayIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { followLogs, getLogDomains, getLogs, type LogDomainItem, type LogFilters, type LogRecord } from "@/lib/api";
import { logColumnPreferenceSchema, type LogColumnId, type LogColumnPreference, type LogStreamRecord, type LogType } from "@/shared/schemas";

type ConnectionStatus = "off" | "connecting" | "live" | "paused";
type FilterInputs = { keyword: string; method: string; statusText: string };

const connectionLabels: Record<ConnectionStatus, string> = { off: "历史模式", connecting: "连接中", live: "实时", paused: "已暂停" };
const columnLabels: Record<LogColumnId, string> = {
  timestamp: "Time", log_type: "Type", domain: "Domain", method: "Method", status: "Status", path: "Path", request_uri: "Request URI", request_time: "Duration", client_ip: "Client IP", upstream_addr: "Upstream", upstream_status: "Upstream Status", upstream_time: "Upstream Time", level: "Level", message: "Message", raw: "Raw",
};
const allColumnIds = Object.keys(columnLabels) as LogColumnId[];

function defaultPreference(global: boolean): LogColumnPreference {
  const visible = global
    ? ["timestamp", "domain", "log_type", "method", "status", "request_uri", "request_time"]
    : ["timestamp", "log_type", "method", "status", "request_uri", "request_time"];
  return { schemaVersion: 1, columns: allColumnIds.map((id) => ({ id, visible: visible.includes(id) })) };
}

function readPreference(key: string, fallback: LogColumnPreference) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as { schemaVersion?: unknown; columns?: unknown } | null;
    if (stored?.schemaVersion !== 1 || !Array.isArray(stored.columns)) throw new Error("invalid preference");
    const allowed = new Set<unknown>(allColumnIds);
    const parsed = logColumnPreferenceSchema.parse({
      schemaVersion: 1,
      columns: stored.columns.filter((column) => column && typeof column === "object" && allowed.has((column as { id?: unknown }).id)),
    });
    if (!parsed.columns.some((column) => column.visible)) throw new Error("no visible columns");
    const known = new Map(parsed.columns.map((column) => [column.id, column]));
    return { schemaVersion: 1 as const, columns: [...parsed.columns, ...fallback.columns.filter((column) => !known.has(column.id))] };
  } catch {
    window.localStorage.removeItem(key);
    return fallback;
  }
}

function toFilters(inputs: FilterInputs): { value?: LogFilters; error?: string } {
  const status = inputs.statusText ? Number(inputs.statusText) : undefined;
  if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) return { error: "Status Code 必须是 100-599 的整数" };
  return { value: { keyword: inputs.keyword.trim(), method: inputs.method, ...(status ? { status } : {}) } };
}

export function resolveFilterSubmission(live: boolean, inputs: FilterInputs) {
  const parsed = toFilters(inputs);
  if (!parsed.value) return { error: parsed.error };
  return { target: live ? "live" as const : "history" as const, filters: parsed.value };
}

function fieldValue(record: LogRecord, column: LogColumnId) {
  if (!record.parsed && column !== "raw") return "-";
  if (column === "timestamp") return record.timestamp ?? "-";
  if (column === "log_type") return record.type;
  if (column === "domain") return record.hostname;
  if (column === "raw") return record.raw;
  if (column === "request_uri") return record.fields.request_uri ?? record.fields.message ?? "-";
  return record.fields[column] ?? "-";
}

function LogColumnPreferences({ global, preference, onChange }: { global: boolean; preference: LogColumnPreference; onChange: (value: LogColumnPreference) => void }) {
  const [dragging, setDragging] = React.useState<LogColumnId>();
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= preference.columns.length) return;
    const columns = [...preference.columns];
    [columns[index], columns[target]] = [columns[target]!, columns[index]!];
    onChange({ ...preference, columns });
  };
  const reorder = (targetId: LogColumnId) => {
    if (!dragging || dragging === targetId) return;
    const columns = [...preference.columns];
    const from = columns.findIndex((item) => item.id === dragging);
    const to = columns.findIndex((item) => item.id === targetId);
    const [item] = columns.splice(from, 1);
    if (item) columns.splice(to, 0, item);
    onChange({ ...preference, columns });
    setDragging(undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline"><Columns3Icon data-icon="inline-start" />字段显示</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <PopoverHeader><PopoverTitle>日志字段</PopoverTitle><PopoverDescription>选择显示字段并调整顺序。仅保存在当前浏览器。</PopoverDescription></PopoverHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {preference.columns.map((column, index) => (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5" draggable onDragStart={() => setDragging(column.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(column.id)} key={column.id}>
              <GripVerticalIcon className="cursor-grab text-muted-foreground" aria-hidden="true" />
              <Checkbox
                aria-label={`${column.visible ? "隐藏" : "显示"} ${columnLabels[column.id]}`}
                checked={column.visible}
                onCheckedChange={(checked) => {
                  if (!checked && preference.columns.filter((item) => item.visible).length === 1) { toast.error("至少保留一个可见字段"); return; }
                  onChange({ ...preference, columns: preference.columns.map((item) => item.id === column.id ? { ...item, visible: Boolean(checked) } : item) });
                }}
              />
              <span className="min-w-0 flex-1 truncate">{columnLabels[column.id]}</span>
              <Button size="icon-xs" variant="ghost" aria-label={`上移 ${columnLabels[column.id]}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpIcon /></Button>
              <Button size="icon-xs" variant="ghost" aria-label={`下移 ${columnLabels[column.id]}`} disabled={index === preference.columns.length - 1} onClick={() => move(index, 1)}><ArrowDownIcon /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" onClick={() => onChange(defaultPreference(global))}>恢复默认顺序</Button>
      </PopoverContent>
    </Popover>
  );
}

export function LogViewer({ domainId: fixedDomainId }: { domainId?: string }) {
  const global = !fixedDomainId;
  const preferenceKey = global ? "nginx-manager:log-columns:global:v1" : "nginx-manager:log-columns:domain:v1";
  const fallbackPreference = React.useMemo(() => defaultPreference(global), [global]);
  const [preference, setPreference] = React.useState(fallbackPreference);
  const [domains, setDomains] = React.useState<LogDomainItem[]>([]);
  const [domainId, setDomainId] = React.useState(fixedDomainId ?? "");
  const [types, setTypes] = React.useState<LogType[]>(["access", "error"]);
  const [records, setRecords] = React.useState<LogRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();
  const [statusError, setStatusError] = React.useState<string>();
  const [unpublished, setUnpublished] = React.useState(false);
  const [filterInputs, setFilterInputs] = React.useState<FilterInputs>({ keyword: "", method: "", statusText: "" });
  const [historyFilters, setHistoryFilters] = React.useState<LogFilters>({});
  const [liveFilters, setLiveFilters] = React.useState<LogFilters>({});
  const [live, setLive] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [connection, setConnection] = React.useState<ConnectionStatus>("off");
  const [pausedCount, setPausedCount] = React.useState(0);
  const [droppedCount, setDroppedCount] = React.useState(0);
  const pausedRef = React.useRef(false);
  const pausedBufferRef = React.useRef<LogRecord[]>([]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPreference(readPreference(preferenceKey, fallbackPreference)));
    return () => window.cancelAnimationFrame(frame);
  }, [fallbackPreference, preferenceKey]);
  const updatePreference = (value: LogColumnPreference) => { setPreference(value); try { window.localStorage.setItem(preferenceKey, JSON.stringify(value)); } catch {} };

  const load = React.useCallback(async (selectedId: string, selectedTypes: LogType[], selectedFilters: LogFilters) => {
    if (!selectedId) return;
    setLoading(true); setError(undefined);
    try {
      const result = await getLogs({ domainId: selectedId, types: selectedTypes, ...selectedFilters });
      setRecords(result.items); setUnpublished(result.unpublished);
      if (result.unpublished) setLive(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "日志加载失败"); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    void getLogDomains().then((result) => {
      setDomains(result.items);
      const initial = fixedDomainId ?? result.items.find((item) => item.activeVersionId)?.id ?? result.items[0]?.id ?? "";
      setDomainId(initial);
      if (initial) void load(initial, ["access", "error"], {}); else setLoading(false);
    }).catch((caught) => { setError(caught instanceof Error ? caught.message : "Domain 列表加载失败"); setLoading(false); });
  }, [fixedDomainId, load]);

  React.useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => {
      const parsed = toFilters(filterInputs);
      setStatusError(parsed.error);
      if (parsed.value) setLiveFilters(parsed.value);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filterInputs, live]);

  const handleStreamRecord = React.useCallback((record: LogStreamRecord) => {
    if (record.type === "heartbeat") { if (!pausedRef.current) setConnection("live"); return; }
    if (record.type === "dropped") { setDroppedCount((current) => current + record.count); return; }
    if (record.type === "error") { setError(record.code === "file_unavailable" ? "日志文件暂时不可用，请关闭实时模式后重试。" : "实时日志游标已失效。"); return; }
    if (record.type === "end") { setConnection("off"); return; }
    if (record.type !== "entry") return;
    if (!pausedRef.current) setConnection("live");
    const entry: LogRecord = { id: record.cursor, domainId: record.domainId, hostname: record.hostname, type: record.logType, timestamp: record.timestamp, parsed: record.parsed, raw: record.raw, fields: record.fields };
    if (pausedRef.current) {
      if (pausedBufferRef.current.length >= 1000) { pausedBufferRef.current.shift(); setDroppedCount((current) => current + 1); }
      pausedBufferRef.current.push(entry); setPausedCount(pausedBufferRef.current.length); return;
    }
    setRecords((current) => [...current, entry].slice(-2000));
  }, []);

  React.useEffect(() => {
    if (!live || !domainId || unpublished) return;
    const controller = new AbortController();
    setConnection(pausedRef.current ? "paused" : "connecting"); setError(undefined);
    void followLogs({ domainId, types, ...liveFilters }, controller.signal, handleStreamRecord, () => setDroppedCount((current) => current + 1)).then(() => {
      if (!controller.signal.aborted) { setConnection("off"); setLive(false); }
    }).catch((caught) => { if (!controller.signal.aborted) { setConnection("off"); setLive(false); setError(caught instanceof Error ? caught.message : "实时日志连接失败"); } });
    return () => controller.abort();
  }, [domainId, handleStreamRecord, live, liveFilters, types, unpublished]);

  const submitHistory = (event: React.FormEvent) => {
    event.preventDefault();
    const submission = resolveFilterSubmission(live, filterInputs);
    setStatusError(submission.error);
    if (!submission.filters) return;
    if (submission.target === "live") { setLiveFilters(submission.filters); return; }
    setHistoryFilters(submission.filters); void load(domainId, types, submission.filters);
  };

  const togglePause = () => {
    if (paused) {
      const buffered = pausedBufferRef.current.splice(0); pausedRef.current = false; setPaused(false); setPausedCount(0); setConnection("live");
      if (buffered.length) setRecords((current) => [...current, ...buffered].slice(-2000)); return;
    }
    pausedRef.current = true; setPaused(true); setConnection("paused");
  };

  const toggleLive = (checked: boolean) => {
    if (checked) {
      const parsed = toFilters(filterInputs); setStatusError(parsed.error); if (!parsed.value) return; setLiveFilters(parsed.value);
    }
    setLive(checked);
    if (!checked) { pausedRef.current = false; pausedBufferRef.current = []; setPaused(false); setPausedCount(0); setConnection("off"); }
  };

  const visibleColumns = preference.columns.filter((column) => column.visible);
  const liveFiltersDiffer = live && JSON.stringify(liveFilters) !== JSON.stringify(historyFilters);

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4" onSubmit={submitHistory}>
        {!fixedDomainId ? <Field className="w-64"><FieldLabel>Domain</FieldLabel><Select options={domains.map((domain) => ({ label: domain.hostname, value: domain.id }))} placeholder="选择 Domain" value={domainId} onChange={(value) => { const next = value ?? ""; setDomainId(next); if (next) void load(next, types, historyFilters); }} /></Field> : null}
        <Field className="w-48"><FieldLabel>日志类型</FieldLabel><Select className="min-w-0" multiple options={[{ label: "Access", value: "access" }, { label: "Error", value: "error" }]} value={types} onChange={(value) => { const next = value as LogType[]; if (!next.length) { toast.error("至少选择一种日志类型"); return; } setTypes(next); if (!live) void load(domainId, next, historyFilters); }} /></Field>
        <Field className="w-44"><FieldLabel>Method</FieldLabel><Select showClear options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ label: value, value }))} placeholder="全部" value={filterInputs.method || null} onChange={(value) => setFilterInputs((current) => ({ ...current, method: value ?? "" }))} /></Field>
        <Field className="w-36" data-invalid={Boolean(statusError)}><FieldLabel htmlFor="log-status">Status</FieldLabel><Input id="log-status" aria-invalid={Boolean(statusError)} inputMode="numeric" max="599" min="100" placeholder="全部" value={filterInputs.statusText} onChange={(event) => { setStatusError(undefined); setFilterInputs((current) => ({ ...current, statusText: event.target.value })); }} />{statusError ? <FieldError>{statusError}</FieldError> : null}</Field>
        <Field className="min-w-56 flex-1"><FieldLabel htmlFor="log-keyword">Path / 关键字</FieldLabel><Input id="log-keyword" maxLength={256} placeholder="普通文本匹配" value={filterInputs.keyword} onChange={(event) => setFilterInputs((current) => ({ ...current, keyword: event.target.value }))} /></Field>
        <Button type="submit" disabled={!domainId || loading}><SearchIcon data-icon="inline-start" />{live ? "应用筛选" : "查询"}</Button>
      </form>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        <Field className="w-auto" orientation="horizontal"><Switch id="live-logs" checked={live} disabled={!domainId || unpublished} onCheckedChange={toggleLive} /><FieldLabel htmlFor="live-logs">实时日志</FieldLabel></Field>
        <Button variant="outline" onClick={togglePause} disabled={!live}>{paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}{paused ? `继续${pausedCount ? ` (${pausedCount})` : ""}` : "暂停"}</Button>
        <Button variant="outline" onClick={() => { setRecords([]); pausedBufferRef.current = []; setPausedCount(0); }}><Trash2Icon data-icon="inline-start" />清屏</Button>
        <LogColumnPreferences global={global} preference={preference} onChange={updatePreference} />
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={connection === "live" ? "default" : "outline"}>{connectionLabels[connection]}</Badge>{liveFiltersDiffer ? <span>实时条件已更新</span> : null}<span>{records.length} 行</span>{droppedCount ? <span>已丢弃 {droppedCount}</span> : null}</div>
      </div>

      {error ? <Alert variant="destructive"><AlertTitle>日志读取异常</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {loading ? <Skeleton className="h-80" /> : records.length ? (
        <div className="overflow-x-auto rounded-md border border-border bg-card"><Table><TableHeader><TableRow>{visibleColumns.map((column) => <TableHead key={column.id}>{columnLabels[column.id]}</TableHead>)}</TableRow></TableHeader><TableBody>{records.map((record) => <TableRow key={record.id}>{visibleColumns.map((column) => <TableCell className="max-w-xl whitespace-nowrap font-mono text-xs" title={column.id === "raw" ? record.raw : undefined} key={column.id}>{String(fieldValue(record, column.id))}</TableCell>)}</TableRow>)}</TableBody></Table></div>
      ) : <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>{unpublished ? "Domain 尚未发布" : "还没有日志"}</EmptyTitle><EmptyDescription>{unpublished ? "发布 Domain 后才会创建运行日志。" : "向该 Domain 发起请求后，在这里查询或开启实时日志。"}</EmptyDescription></EmptyHeader></Empty>}
    </div>
  );
}
