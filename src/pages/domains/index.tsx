import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Globe2Icon, MoreHorizontalIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Page } from "@/components/layout/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { deleteDomain, getDomains, type DomainListItem } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function queryValue(value: string | string[] | undefined, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function DomainActions({ domain, onDeleted }: { domain: DomainListItem; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteDomain(domain.id);
      setConfirmOpen(false);
      onDeleted();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`管理 ${domain.primaryHostname}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={`/domains/overview?id=${domain.id}`}>管理</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={Boolean(domain.activeVersionId)}
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2Icon />
              删除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {domain.primaryHostname}？</AlertDialogTitle>
            <AlertDialogDescription>
              该域名尚未发布。删除后会归档 Domain，历史草稿仍保留在数据库中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void remove(); }}>
              {deleting ? "删除中" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DomainList() {
  const router = useRouter();
  const page = Number(queryValue(router.query.page, "1"));
  const status = queryValue(router.query.status, "all");
  const sort = queryValue(router.query.sort, "updated_desc");
  const querySearch = queryValue(router.query.search, "");
  const [search, setSearch] = React.useState(querySearch);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (search === querySearch) return;
      const next = { ...router.query };
      if (search) next.search = search;
      else delete next.search;
      delete next.page;
      void router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [querySearch, router, search]);

  const params = React.useMemo(() => {
    const next = new URLSearchParams({ page: String(page), pageSize: "20", status, sort });
    if (querySearch) next.set("search", querySearch);
    return next;
  }, [page, querySearch, sort, status]);
  const load = React.useCallback(() => getDomains(params), [params]);
  const query = useApiQuery(load);
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  const updateQuery = (name: "status" | "sort", value: string | null) => {
    const next = { ...router.query };
    if (!value || value === "all" || value === "updated_desc") delete next[name];
    else next[name] = value;
    delete next.page;
    void router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  };

  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(nextPage));
    return `/domains?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Domains"
        description="创建、查询和管理所有 Nginx 域名。"
        breadcrumbs={[{ label: "Domains" }]}
        action={
          <Button asChild size="sm">
            <Link href="/domains/create">
              <PlusIcon data-icon="inline-start" />
              添加域名
            </Link>
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_14rem_14rem]">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索域名"
              placeholder="搜索主域名或别名"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
          <Select
            aria-label="筛选运行状态"
            options={[
              { value: "all", label: "全部状态" },
              { value: "running", label: "Running" },
              { value: "failed", label: "Failed" },
              { value: "disabled", label: "Disabled" },
              { value: "unknown", label: "Unknown" },
            ]}
            value={status}
            onChange={(value) => updateQuery("status", value)}
          />
          <Select
            aria-label="排序"
            options={[
              { value: "updated_desc", label: "最近修改" },
              { value: "created_desc", label: "最近创建" },
              { value: "hostname_asc", label: "域名 A-Z" },
            ]}
            value={sort}
            onChange={(value) => updateQuery("sort", value)}
          />
        </div>

        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>域名列表加载失败</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {query.loading && !query.data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton className="h-14" key={index} />
            ))}
          </div>
        ) : query.data?.items.length ? (
          <>
            <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Aliases</TableHead>
                    <TableHead>SSL</TableHead>
                    <TableHead>运行状态</TableHead>
                    <TableHead>当前版本</TableHead>
                    <TableHead>最后修改</TableHead>
                    <TableHead><span className="sr-only">操作</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={`/domains/overview?id=${domain.id}`}>
                          {domain.primaryHostname}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {domain.aliases.length ? domain.aliases.join(", ") : "None"}
                      </TableCell>
                      <TableCell><StatusBadge status={domain.sslStatus} /></TableCell>
                      <TableCell>
                        <StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {domain.activeVersionId ? domain.activeVersionId.slice(0, 8) : "Not published"}
                      </TableCell>
                      <TableCell>{dateFormatter.format(domain.updatedAt)}</TableCell>
                      <TableCell>
                        <DomainActions domain={domain} onDeleted={() => void query.refresh()} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 md:hidden">
              {query.data.items.map((domain) => (
                <Card className="border border-border" key={domain.id}>
                  <CardHeader>
                    <CardTitle>
                      <Link href={`/domains/overview?id=${domain.id}`}>{domain.primaryHostname}</Link>
                    </CardTitle>
                    <CardDescription>
                      {domain.aliases.length ? domain.aliases.join(", ") : "无别名"}
                    </CardDescription>
                    <CardAction>
                      <DomainActions domain={domain} onDeleted={() => void query.refresh()} />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {dateFormatter.format(domain.updatedAt)}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>

            {totalPages > 1 ? (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      text="上一页"
                      href={page > 1 ? pageHref(page - 1) : pageHref(1)}
                      aria-disabled={page <= 1}
                      onClick={(event) => page <= 1 && event.preventDefault()}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-3 font-mono text-sm text-muted-foreground">
                      {page} / {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      text="下一页"
                      href={page < totalPages ? pageHref(page + 1) : pageHref(totalPages)}
                      aria-disabled={page >= totalPages}
                      onClick={(event) => page >= totalPages && event.preventDefault()}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </>
        ) : (
          <Empty className="min-h-80 border border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Globe2Icon /></EmptyMedia>
              <EmptyTitle>{querySearch || status !== "all" ? "没有匹配项" : "还没有域名"}</EmptyTitle>
              <EmptyDescription>
                {querySearch || status !== "all"
                  ? "调整搜索或筛选条件后重试。"
                  : "创建第一个域名和 v1 草稿，线上 Nginx 不会立即改变。"}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {querySearch || status !== "all" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    void router.replace("/domains");
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Button asChild><Link href="/domains/create">创建第一个域名</Link></Button>
              )}
            </EmptyContent>
          </Empty>
        )}
      </div>
    </>
  );
}

export default function DomainsPage() {
  return (
    <Page className="px-0 pb-16">
      <DomainList />
    </Page>
  );
}
