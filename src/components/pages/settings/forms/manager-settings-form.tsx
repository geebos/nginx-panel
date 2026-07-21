import * as React from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircleIcon, PencilIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useApiQuery } from "@/hooks/use-api-query";
import { useRouter } from "@/hooks/use-router";
import {
	createManagerCertificateOrder,
	getDeployment,
	getManagerCertificateOrders,
	getManagerCertificates,
	getManagerSettings,
	publishManagerSettings,
	renewManagerCertificate,
	resetManagerSettings,
	rollbackManagerSettings,
} from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { terminalOrderStatuses } from "@/shared/schemas";
import { cn } from "@/lib/utils";
import { validationMethodLabel } from "@/components/pages/settings/forms/manager-ssl-fields";

function statusBadgeClass(status: string) {
	switch (status) {
		case "bound":
			return "bg-emerald-50 text-emerald-800 border-emerald-200";
		case "draft":
			return "bg-amber-50 text-amber-900 border-amber-200";
		case "unbound":
			return "bg-stone-100 text-stone-700 border-stone-200";
		default:
			return "bg-stone-100 text-stone-600 border-stone-200";
	}
}

export function ManagerSettingsForm() {
	const { t } = useTranslation(["common"]);
	const router = useRouter();
	const query = useApiQuery(getManagerSettings);
	const [serverError, setServerError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState<
		"publish" | "reset" | "rollback" | "cert" | null
	>(null);
	const [deploymentId, setDeploymentId] = React.useState<string | null>(null);

	const canIssue =
		query.data?.status === "bound" && Boolean(query.data.config?.bound);
	const certsQuery = useApiQuery(
		React.useCallback(
			() =>
				canIssue
					? getManagerCertificates()
					: Promise.resolve({
							domainId: "",
							items: [] as Awaited<
								ReturnType<typeof getManagerCertificates>
							>["items"],
						}),
			[canIssue],
		),
	);
	const ordersQuery = useApiQuery(
		React.useCallback(
			() =>
				canIssue
					? getManagerCertificateOrders()
					: Promise.resolve({
							domainId: "",
							items: [] as Awaited<
								ReturnType<typeof getManagerCertificateOrders>
							>["items"],
						}),
			[canIssue],
		),
	);

	React.useEffect(() => {
		if (!deploymentId) return;
		let cancelled = false;
		const tick = async () => {
			try {
				const detail = await getDeployment(deploymentId);
				if (cancelled) return;
				if (detail.deployment.status === "succeeded") {
					toast.success(t("common:settings.manager.publishSucceeded"));
					setDeploymentId(null);
					setBusy(null);
					void query.refresh();
					return;
				}
				if (detail.deployment.status === "failed") {
					setServerError(
						detail.deployment.errorMessage ||
							t("common:settings.manager.publishFailed"),
					);
					setDeploymentId(null);
					setBusy(null);
					return;
				}
				window.setTimeout(() => void tick(), 1200);
			} catch (error) {
				if (!cancelled) {
					setServerError(
						formatErrorMessage(
							t,
							error,
							"common:settings.manager.publishFailed",
						),
					);
					setDeploymentId(null);
					setBusy(null);
				}
			}
		};
		void tick();
		return () => {
			cancelled = true;
		};
	}, [deploymentId, query, t]);

	const publish = async () => {
		setServerError(null);
		setBusy("publish");
		try {
			const result = await publishManagerSettings();
			setDeploymentId(result.deploymentId);
			toast.message(t("common:settings.manager.publishing"));
		} catch (error) {
			setServerError(
				formatErrorMessage(t, error, "common:settings.manager.publishFailed"),
			);
			setBusy(null);
		}
	};

	const reset = async () => {
		setServerError(null);
		setBusy("reset");
		try {
			await resetManagerSettings();
			toast.success(t("common:settings.manager.resetDraftCreated"));
			void query.refresh();
		} catch (error) {
			setServerError(
				formatErrorMessage(t, error, "common:settings.manager.resetFailed"),
			);
		} finally {
			setBusy(null);
		}
	};

	const rollback = async (sourceVersionId: string) => {
		setServerError(null);
		setBusy("rollback");
		try {
			const result = await rollbackManagerSettings(sourceVersionId);
			setDeploymentId(result.deploymentId);
			toast.message(t("common:settings.manager.rollingBack"));
		} catch (error) {
			setServerError(
				formatErrorMessage(t, error, "common:settings.manager.rollbackFailed"),
			);
			setBusy(null);
		}
	};

	const requestCertificate = async () => {
		const config = query.data?.config;
		if (!config?.bound || !config.ssl.enabled) return;
		setServerError(null);
		setBusy("cert");
		try {
			const raw = config.ssl.validation;
			const validation =
				raw.provider === "cloudflare" && raw.cloudflareCredentialId
					? {
							method: "dns-01" as const,
							provider: "cloudflare" as const,
							cloudflareCredentialId: raw.cloudflareCredentialId,
						}
					: { method: "dns-01" as const, provider: "manual" as const };
			const result = await createManagerCertificateOrder({
				accountEmail: config.ssl.email,
				environment: "production",
				validation,
			});
			toast.success(t("common:settings.manager.sslOrderCreated"));
			await router.push(`/settings/manager/ssl?orderId=${result.order.id}`);
		} catch (error) {
			setServerError(
				formatErrorMessage(t, error, "common:settings.manager.sslOrderFailed"),
			);
			setBusy(null);
		}
	};

	if (query.loading && !query.data) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		);
	}

	if (query.error && !query.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>{t("common:settings.manager.loadFailed")}</AlertTitle>
				<AlertDescription>
					{formatErrorMessage(t, query.error)}
				</AlertDescription>
			</Alert>
		);
	}

	const data = query.data!;
	const statusLabel = t(`common:settings.manager.status.${data.status}`);
	const config = data.config;
	const activeCertificate = certsQuery.data?.items.find(
		(item) => item.status === "active",
	);
	const activeOrder = ordersQuery.data?.items.find(
		(item) => !terminalOrderStatuses.includes(item.status),
	);
	const sslEnabled = Boolean(config?.bound && config.ssl.enabled);

	return (
		<div className="space-y-6">
			{serverError ? (
				<Alert variant="destructive">
					<AlertTitle>
						{t("common:settings.manager.operationFailed")}
					</AlertTitle>
					<AlertDescription>{serverError}</AlertDescription>
				</Alert>
			) : null}

			<Card className="border-border shadow-none">
				<CardHeader>
					<div className="flex flex-wrap items-center gap-3">
						<CardTitle className="font-normal tracking-tight text-[22px]">
							{t("common:settings.manager.statusTitle")}
						</CardTitle>
						<Badge
							variant="outline"
							className={cn(
								"rounded-full uppercase tracking-wider text-[11px] font-semibold",
								statusBadgeClass(data.status),
							)}
						>
							{statusLabel}
						</Badge>
					</div>
					<CardDescription>
						{t("common:settings.manager.statusDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm text-muted-foreground">
					<p>
						{t("common:settings.manager.localEntrypoints")}:{" "}
						<span className="font-mono text-foreground">
							{data.localEntrypoints
								.map((host) => `http://${host}`)
								.join(" · ")}
						</span>
					</p>
					{deploymentId ? (
						<p className="flex items-center gap-2 text-foreground">
							<LoaderCircleIcon className="size-4 animate-spin" />
							{t("common:settings.manager.deploymentRunning")}{" "}
							<LocalizedLink
								className="text-primary underline-offset-4 hover:underline"
								href={`/deployments?id=${deploymentId}`}
							>
								{deploymentId.slice(0, 8)}
							</LocalizedLink>
						</p>
					) : null}
				</CardContent>
				{data.canPublish ? (
					<CardFooter className="border-t border-border">
						<Button
							type="button"
							disabled={busy !== null}
							onClick={() => void publish()}
						>
							{busy === "publish" ? (
								<LoaderCircleIcon className="size-4 animate-spin" />
							) : null}
							{t("common:settings.manager.publish")}
						</Button>
					</CardFooter>
				) : null}
			</Card>

			<Card className="border-border shadow-none">
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<CardTitle className="text-lg font-semibold">
								{t("common:settings.manager.summary.title")}
							</CardTitle>
							<CardDescription>
								{t("common:settings.manager.summary.description")}
							</CardDescription>
						</div>
						<Button type="button" size="sm" variant="outline" asChild>
							<LocalizedLink href="/settings/manager/edit">
								<PencilIcon data-icon="inline-start" />
								{t("common:settings.manager.summary.edit")}
							</LocalizedLink>
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-4 sm:grid-cols-2">
						<div>
							<dt className="text-xs text-muted-foreground">
								{t("common:settings.manager.primaryHostname")}
							</dt>
							<dd className="mt-1 font-mono text-sm">
								{config?.bound
									? config.primaryHostname
									: t("common:settings.manager.summary.notBound")}
							</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">
								{t("common:settings.manager.aliases")}
							</dt>
							<dd className="mt-1 font-mono text-sm">
								{config?.bound && config.aliases.length
									? config.aliases.join(", ")
									: "—"}
							</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">
								{t("common:settings.manager.sslForm.enableHttps")}
							</dt>
							<dd className="mt-1 text-sm">
								{sslEnabled
									? t("common:settings.manager.sslForm.on")
									: t("common:settings.manager.sslForm.off")}
							</dd>
						</div>
						{sslEnabled && config?.bound ? (
							<>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslForm.acmeEmail")}
									</dt>
									<dd className="mt-1 break-all text-sm">
										{config.ssl.email || "—"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslForm.environment")}
									</dt>
									<dd className="mt-1 text-sm">
										{t("common:settings.manager.sslForm.environmentProduction")}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslForm.validationMethod")}
									</dt>
									<dd className="mt-1 text-sm">
										{validationMethodLabel(t, config.ssl.validation)}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslForm.autoRenew")}
									</dt>
									<dd className="mt-1 text-sm">
										{config.ssl.autoRenew
											? t("common:settings.manager.sslForm.on")
											: t("common:settings.manager.sslForm.off")}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslForm.forceHttps")}
									</dt>
									<dd className="mt-1 text-sm">
										{config.ssl.forceHttps
											? t("common:settings.manager.sslForm.on")
											: t("common:settings.manager.sslForm.off")}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t("common:settings.manager.summary.certificate")}
									</dt>
									<dd className="mt-1 flex items-center gap-2 text-sm">
										{activeCertificate ? (
											<StatusBadge status={activeCertificate.status} />
										) : (
											t("common:settings.manager.summary.noCertificate")
										)}
									</dd>
								</div>
							</>
						) : null}
					</dl>
					{!config?.bound ? (
						<p className="mt-4 text-sm text-muted-foreground">
							{t("common:settings.manager.unconfiguredHint")}
						</p>
					) : null}
				</CardContent>
				{canIssue && sslEnabled && !activeCertificate ? (
					<CardFooter className="flex flex-wrap gap-2 border-t border-border">
						<Button
							type="button"
							disabled={busy !== null || Boolean(activeOrder)}
							onClick={() => void requestCertificate()}
						>
							{busy === "cert" ? (
								<LoaderCircleIcon className="size-4 animate-spin" />
							) : (
								<ShieldCheckIcon data-icon="inline-start" />
							)}
							{t("common:settings.manager.sslForm.requestCertificate")}
						</Button>
					</CardFooter>
				) : null}
				{canIssue && activeCertificate ? (
					<CardFooter className="flex flex-wrap gap-2 border-t border-border">
						<Button
							type="button"
							variant="outline"
							disabled={busy !== null || Boolean(activeOrder)}
							onClick={() => {
								setBusy("cert");
								void renewManagerCertificate()
									.then((result) =>
										router.push(
											`/settings/manager/ssl?orderId=${result.order.id}`,
										),
									)
									.catch((error: Error) => {
										setServerError(
											formatErrorMessage(
												t,
												error,
												"common:settings.manager.sslOrderFailed",
											),
										);
										setBusy(null);
									});
							}}
						>
							{busy === "cert" ? (
								<LoaderCircleIcon className="size-4 animate-spin" />
							) : null}
							{t("common:settings.manager.sslRenew")}
						</Button>
					</CardFooter>
				) : null}
			</Card>

			{canIssue &&
			(ordersQuery.data?.items.length || certsQuery.data?.items.length) ? (
				<Card className="border-border shadow-none">
					<CardHeader>
						<CardTitle className="text-lg font-semibold">
							{t("common:settings.manager.sslPage.ordersCard.title")}
						</CardTitle>
						<CardDescription>
							{t("common:settings.manager.sslPage.ordersCard.description")}
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						{(ordersQuery.data?.items ?? []).slice(0, 5).map((order) => (
							<LocalizedLink
								className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/40"
								href={`/settings/manager/ssl?orderId=${order.id}`}
								key={order.id}
							>
								<span className="text-sm">
									{order.replacesCertificateId
										? t("common:settings.manager.sslPage.ordersCard.renewal")
										: t(
												"common:settings.manager.sslPage.ordersCard.apply",
											)}{" "}
									· {order.validationMethod}
								</span>
								<StatusBadge status={order.status} />
							</LocalizedLink>
						))}
						{!ordersQuery.data?.items.length ? (
							<p className="text-sm text-muted-foreground">
								{t("common:settings.manager.sslPage.ordersCard.empty")}
							</p>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{data.status !== "unconfigured" ? (
				<Card className="border-border shadow-none">
					<CardHeader>
						<CardTitle className="text-lg font-semibold">
							{t("common:settings.manager.versionsTitle")}
						</CardTitle>
						<CardDescription>
							{t("common:settings.manager.versionsDescription")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						{data.versions.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("common:settings.manager.noVersions")}
							</p>
						) : (
							<ul className="divide-y divide-border rounded-lg border border-border">
								{data.versions.map((version) => (
									<li
										key={version.id}
										className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
									>
										<div className="min-w-0">
											<p className="font-medium text-foreground">
												v{version.versionNumber}{" "}
												<span className="font-mono text-muted-foreground">
													{version.primaryHostname}
												</span>
											</p>
											<p className="text-muted-foreground">
												{version.status}
												{version.changeSummary
													? ` · ${version.changeSummary}`
													: ""}
											</p>
										</div>
										{version.status !== "active" && data.activeVersion ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={busy !== null}
												onClick={() => void rollback(version.id)}
											>
												{t("common:settings.manager.rollback")}
											</Button>
										) : (
											<Badge variant="secondary">
												{t("common:settings.manager.activeBadge")}
											</Badge>
										)}
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			) : null}

			{data.canReset ? (
				<Card className="border-border shadow-none">
					<CardHeader>
						<CardTitle className="text-lg font-semibold">
							{t("common:settings.manager.resetTitle")}
						</CardTitle>
						<CardDescription>
							{t("common:settings.manager.resetDescription")}
						</CardDescription>
					</CardHeader>
					<CardFooter>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									type="button"
									variant="destructive"
									disabled={busy !== null}
								>
									{t("common:settings.manager.resetAction")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("common:settings.manager.resetConfirmTitle")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t("common:settings.manager.resetConfirmDescription")}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>
										{t("common:settings.manager.cancel")}
									</AlertDialogCancel>
									<AlertDialogAction onClick={() => void reset()}>
										{t("common:settings.manager.resetAction")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</CardFooter>
				</Card>
			) : null}
		</div>
	);
}
