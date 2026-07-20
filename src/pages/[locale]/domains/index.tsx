import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "@/hooks/use-router";
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
import { formatErrorMessage } from "@/lib/i18n/error";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";

function queryValue(value: string | string[] | undefined, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function DomainActions({ domain, onDeleted }: { domain: DomainListItem; onDeleted: () => void }) {
  const { t } = useTranslation(["common", "domains"]);
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
      setError(formatErrorMessage(t, nextError, "domains:common.errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t("domains:list.actions.manageAria", { hostname: domain.primaryHostname })}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <LocalizedLink href={`/domains/overview?id=${domain.id}`}>{t("domains:common.actions.manage")}</LocalizedLink>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={Boolean(domain.activeVersionId)}
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2Icon />
              {t("domains:common.actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("domains:list.actions.deleteTitle", { hostname: domain.primaryHostname })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("domains:list.actions.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("domains:common.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void remove(); }}>
              {deleting ? t("domains:common.actions.deleting") : t("domains:common.actions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DomainList() {
  const { t } = useTranslation(["common", "domains"]);
  const router = useRouter();
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
        title={t("domains:list.title")}
        description={t("domains:list.description")}
        breadcrumbs={[{ label: t("domains:list.title") }]}
        action={
          <Button asChild size="sm">
            <LocalizedLink href="/domains/create">
              <PlusIcon data-icon="inline-start" />
              {t("domains:list.addDomain")}
            </LocalizedLink>
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
              aria-label={t("domains:list.search.ariaLabel")}
              placeholder={t("domains:list.search.placeholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
          <Select
            aria-label={t("domains:list.filters.statusAriaLabel")}
            options={[
              { value: "all", label: t("domains:list.filters.all") },
              { value: "running", label: t("common:status.running") },
              { value: "failed", label: t("common:status.failed") },
              { value: "disabled", label: t("common:status.disabled") },
              { value: "unknown", label: t("common:status.unknown") },
            ]}
            value={status}
            onChange={(value) => updateQuery("status", value)}
          />
          <Select
            aria-label={t("domains:list.filters.sortAriaLabel")}
            options={[
              { value: "updated_desc", label: t("domains:list.filters.sortUpdatedDesc") },
              { value: "created_desc", label: t("domains:list.filters.sortCreatedDesc") },
              { value: "hostname_asc", label: t("domains:list.filters.sortHostnameAsc") },
            ]}
            value={sort}
            onChange={(value) => updateQuery("sort", value)}
          />
        </div>

        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("domains:list.loadFailed")}</AlertTitle>
            <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
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
                    <TableHead>{t("domains:list.columns.domain")}</TableHead>
                    <TableHead>{t("domains:list.columns.aliases")}</TableHead>
                    <TableHead>{t("domains:list.columns.ssl")}</TableHead>
                    <TableHead>{t("domains:list.columns.runtime")}</TableHead>
                    <TableHead>{t("domains:list.columns.version")}</TableHead>
                    <TableHead>{t("domains:list.columns.updated")}</TableHead>
                    <TableHead><span className="sr-only">{t("domains:list.columns.actions")}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell>
                        <LocalizedLink className="font-medium hover:underline" href={`/domains/overview?id=${domain.id}`}>
                          {domain.primaryHostname}
                        </LocalizedLink>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {domain.aliases.length ? domain.aliases.join(", ") : t("domains:common.status.none")}
                      </TableCell>
                      <TableCell><StatusBadge status={domain.sslStatus} /></TableCell>
                      <TableCell>
                        <StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {domain.activeVersionId ? domain.activeVersionId.slice(0, 8) : t("domains:common.status.notPublished")}
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
                      <LocalizedLink href={`/domains/overview?id=${domain.id}`}>{domain.primaryHostname}</LocalizedLink>
                    </CardTitle>
                    <CardDescription>
                      {domain.aliases.length ? domain.aliases.join(", ") : t("domains:list.noAlias")}
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
                      text={t("domains:list.pagination.previous")}
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
                      text={t("domains:list.pagination.next")}
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
              <EmptyTitle>{querySearch || status !== "all" ? t("domains:list.empty.filteredTitle") : t("domains:list.empty.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {querySearch || status !== "all"
                  ? t("domains:list.empty.filteredDescription")
                  : t("domains:list.empty.emptyDescription")}
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
                  {t("domains:list.empty.clearFilters")}
                </Button>
              ) : (
                <Button asChild><LocalizedLink href="/domains/create">{t("domains:list.empty.createFirst")}</LocalizedLink></Button>
              )}
            </EmptyContent>
          </Empty>
        )}
      </div>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainsPage() {
  return (
    <Page className="px-0 pb-16">
      <DomainList />
    </Page>
  );
}
