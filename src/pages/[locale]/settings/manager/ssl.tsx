import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { useRouter } from "@/hooks/use-router";
import {
	getManagerCertificateOrder,
	recheckManagerCertificateOrder,
	retryManagerCertificateActivation,
} from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { recheckableOrderStatuses, terminalOrderStatuses } from "@/shared/schemas";

function ManagerSslOrderDetail({ orderId }: { orderId: string }) {
	const { t } = useTranslation(["common"]);
	const locale = useLocale();
	const dateFormatter = new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	const load = React.useCallback(
		() => getManagerCertificateOrder(orderId),
		[orderId],
	);
	const query = useApiQuery(load);
	const [error, setError] = React.useState<string>();

	React.useEffect(() => {
		const detail = query.data;
		if (!detail) return;
		const activationRunning =
			detail.order.status === "succeeded" &&
			(!detail.activation ||
				detail.activation.status === "pending" ||
				["queued", "running"].includes(detail.deployment?.status ?? ""));
		if (terminalOrderStatuses.includes(detail.order.status) && !activationRunning)
			return;
		const timer = window.setInterval(() => void query.refresh(), 3000);
		return () => window.clearInterval(timer);
	}, [orderId, query]);

	const detail = query.data;

	return (
		<>
			<PageHeader
				title={
					detail
						? `${detail.order.replacesCertificateId ? t("common:settings.manager.sslPage.orderDetail.titleRenewal") : t("common:settings.manager.sslPage.orderDetail.titleOrder")} ${detail.order.id.slice(0, 8)}`
						: t("common:settings.manager.sslPage.orderDetail.titleFallback")
				}
				description={t(
					"common:settings.manager.sslPage.orderDetail.description",
				)}
				breadcrumbs={[
					{
						label: t("common:settings.breadcrumbs.settings"),
						href: "/settings/general",
					},
					{
						label: t("common:settings.manager.breadcrumb"),
						href: "/settings/manager",
					},
					{
						label: t("common:settings.manager.sslPage.orderDetail.breadcrumb"),
					},
				]}
				action={
					<Button size="sm" variant="outline" asChild>
						<LocalizedLink href="/settings/manager">
							<ArrowLeftIcon data-icon="inline-start" />
							{t("common:settings.manager.sslPage.orderDetail.backToSsl")}
						</LocalizedLink>
					</Button>
				}
			/>
			<SettingsTabs active="manager" />
			<div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
				{query.error ? (
					<Alert variant="destructive">
						<AlertTitle>
							{t("common:settings.manager.sslPage.orderDetail.loadFailed")}
						</AlertTitle>
						<AlertDescription>
							{formatErrorMessage(t, query.error)}
						</AlertDescription>
					</Alert>
				) : null}
				{!detail ? (
					<Skeleton className="h-80" />
				) : (
					<>
						<Card className="border border-border shadow-none">
							<CardHeader>
								<div className="flex items-center justify-between gap-3">
									<CardTitle>
										{t(
											"common:settings.manager.sslPage.orderDetail.statusCard.title",
										)}
									</CardTitle>
									<StatusBadge status={detail.order.status} />
								</div>
								<CardDescription>
									production · {detail.order.validationMethod}
									{detail.order.dnsProvider
										? ` / ${detail.order.dnsProvider}`
										: ""}
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-4 sm:grid-cols-2">
								<div>
									<p className="text-xs text-muted-foreground">
										{t(
											"common:settings.manager.sslPage.orderDetail.identifiers",
										)}
									</p>
									<p className="mt-1 text-sm">
										{detail.order.identifiers.join(", ")}
									</p>
								</div>
								<div>
									<p className="text-xs text-muted-foreground">
										{t("common:settings.manager.sslPage.orderDetail.createdAt")}
									</p>
									<p className="mt-1 text-sm">
										{dateFormatter.format(detail.order.createdAt)}
									</p>
								</div>
							</CardContent>
						</Card>

						{detail.order.errorMessage &&
						detail.order.status !== "succeeded" ? (
							<Alert variant="destructive">
								<AlertTitle>
									{t(
										"common:settings.manager.sslPage.orderDetail.processFailed",
									)}
								</AlertTitle>
								<AlertDescription>{detail.order.errorMessage}</AlertDescription>
							</Alert>
						) : null}

						{detail.order.status === "preparing" ? (
							<Alert>
								<ShieldCheckIcon />
								<AlertTitle>
									{t(
										"common:settings.manager.sslPage.orderDetail.preparingTitle",
									)}
								</AlertTitle>
								<AlertDescription>
									{t(
										"common:settings.manager.sslPage.orderDetail.preparingDesc",
									)}
								</AlertDescription>
							</Alert>
						) : null}

						{detail.challenges.length ? (
							<Card className="border border-border shadow-none">
								<CardHeader>
									<div className="flex items-center justify-between gap-3">
										<div>
											<CardTitle>
												{t(
													"common:settings.manager.sslPage.orderDetail.challengesTitle",
												)}
											</CardTitle>
											<CardDescription>
												{t(
													"common:settings.manager.sslPage.orderDetail.challengesDescDns",
												)}
											</CardDescription>
										</div>
										{recheckableOrderStatuses.includes(detail.order.status) ? (
											<Button
												size="sm"
												variant="outline"
												onClick={() => {
													void recheckManagerCertificateOrder(orderId)
														.then((result) => {
															toast.success(
																result.debounced
																	? t(
																			"common:settings.manager.sslPage.orderDetail.toastDebounced",
																		)
																	: t(
																			"common:settings.manager.sslPage.orderDetail.toastScheduled",
																		),
															);
															return query.refresh();
														})
														.catch((caught: Error) =>
															setError(
																formatErrorMessage(
																	t,
																	caught,
																	"common:settings.manager.sslPage.orderDetail.operationFailed",
																),
															),
														);
												}}
											>
												<RefreshCwIcon data-icon="inline-start" />
												{t(
													"common:settings.manager.sslPage.orderDetail.recheck",
												)}
											</Button>
										) : null}
									</div>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									{detail.challenges.map((challenge) => (
										<div
											className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
											key={challenge.id}
										>
											<div>
												<p className="font-medium">{challenge.hostname}</p>
												{challenge.dnsRecordName ? (
													<>
														<p className="mt-2 font-mono text-xs">
															{challenge.dnsRecordName}
														</p>
														<p className="mt-1 break-all font-mono text-xs text-muted-foreground">
															{challenge.dnsRecordValue}
														</p>
													</>
												) : (
													<p className="mt-1 text-sm text-muted-foreground">
														{t(
															"common:settings.manager.sslPage.orderDetail.waitingChallenge",
														)}
													</p>
												)}
											</div>
											<StatusBadge status={challenge.status} />
										</div>
									))}
								</CardContent>
							</Card>
						) : null}

						{detail.certificate ? (
							<Card className="border border-border shadow-none">
								<CardHeader>
									<div className="flex items-center justify-between gap-3">
										<div>
											<CardTitle>
												{t(
													"common:settings.manager.sslPage.orderDetail.activationTitle",
												)}
											</CardTitle>
											<CardDescription>
												{t(
													"common:settings.manager.sslPage.orderDetail.activationDesc",
												)}
											</CardDescription>
										</div>
										<StatusBadge
											status={
												detail.deployment?.status ??
												detail.activation?.status ??
												detail.certificate.status
											}
										/>
									</div>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									<div className="grid gap-3 text-sm sm:grid-cols-2">
										<div>
											<p className="text-xs text-muted-foreground">
												{t(
													"common:settings.manager.sslPage.orderDetail.certificate",
												)}
											</p>
											<p className="mt-1 font-mono">
												{detail.certificate.id.slice(0, 8)}
											</p>
										</div>
										<div>
											<p className="text-xs text-muted-foreground">
												{t(
													"common:settings.manager.sslPage.orderDetail.configVersion",
												)}
											</p>
											<p className="mt-1 font-mono">
												{detail.activation?.configVersionId?.slice(0, 8) ??
													t(
														"common:settings.manager.sslPage.orderDetail.waitingCreate",
													)}
											</p>
										</div>
									</div>
									{detail.deployment ? (
										<Button variant="outline" asChild>
											<LocalizedLink
												href={`/deployments/detail?id=${detail.deployment.id}`}
											>
												{t(
													"common:settings.manager.sslPage.orderDetail.viewDeployment",
													{
														status: detail.deployment.status,
													},
												)}
											</LocalizedLink>
										</Button>
									) : null}
									{detail.activation?.errorMessage ||
									detail.deployment?.errorMessage ? (
										<Alert variant="destructive">
											<AlertTitle>
												{t(
													"common:settings.manager.sslPage.orderDetail.activationFailed",
												)}
											</AlertTitle>
											<AlertDescription>
												{detail.activation?.errorMessage ??
													detail.deployment?.errorMessage}
											</AlertDescription>
										</Alert>
									) : null}
									{detail.activation?.status === "failed" ||
									detail.deployment?.status === "failed" ? (
										<Button
											onClick={() => {
												setError(undefined);
												void retryManagerCertificateActivation(orderId)
													.then(() => {
														toast.success(
															t(
																"common:settings.manager.sslPage.orderDetail.activationRetried",
															),
														);
														return query.refresh();
													})
													.catch((caught: Error) =>
														setError(
															formatErrorMessage(
																t,
																caught,
																"common:settings.manager.sslPage.orderDetail.operationFailed",
															),
														),
													);
											}}
										>
											<RefreshCwIcon data-icon="inline-start" />
											{t(
												"common:settings.manager.sslPage.orderDetail.retryActivation",
											)}
										</Button>
									) : null}
								</CardContent>
							</Card>
						) : null}

						{error ? (
							<Alert variant="destructive">
								<AlertTitle>
									{t(
										"common:settings.manager.sslPage.orderDetail.operationFailed",
									)}
								</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
					</>
				)}
			</div>
		</>
	);
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function ManagerSslPage() {
	const router = useRouter();
	const orderId =
		typeof router.query.orderId === "string" ? router.query.orderId : "";

	React.useEffect(() => {
		if (router.isReady && !orderId) {
			void router.replace("/settings/manager");
		}
	}, [orderId, router]);

	if (!router.isReady || !orderId) {
		return (
			<Page className="px-0 pb-16">
				<Skeleton className="m-8 h-96" />
			</Page>
		);
	}

	return (
		<Page className="px-0 pb-16">
			<ManagerSslOrderDetail orderId={orderId} />
		</Page>
	);
}
