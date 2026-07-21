import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, LoaderCircleIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useApiQuery } from "@/hooks/use-api-query";
import { useRouter } from "@/hooks/use-router";
import {
	getCloudflareCredentials,
	getManagerSettings,
	type ManagerSettingsResponse,
	updateManagerSettings,
} from "@/lib/api";
import {
	formatErrorMessage,
	formatMessageKey,
	zodIssueParams,
} from "@/lib/i18n/error";
import { hostnameSchema } from "@/shared/schemas";
import { managerSslConfigSchema } from "@/shared/schemas/manager";
import {
	ManagerSslFields,
	type ManagerSslFieldsValue,
} from "@/components/pages/settings/forms/manager-ssl-fields";

function parseAliases(value: string) {
	return [
		...new Set(
			value
				.split(/[\n,]/)
				.map((item) => item.trim().toLowerCase().replace(/\.$/, ""))
				.filter(Boolean),
		),
	];
}

function defaultSslFields(): ManagerSslFieldsValue {
	return {
		email: "",
		autoRenew: true,
		forceHttps: true,
		validation: { method: "dns-01", provider: "manual" },
	};
}

function initialFromConfig(config: ManagerSettingsResponse["config"]) {
	if (!config?.bound) {
		return {
			primaryHostname: "",
			aliases: "",
			enableSsl: false,
			ssl: defaultSslFields(),
		};
	}
	return {
		primaryHostname: config.primaryHostname,
		aliases: config.aliases.join(", "),
		enableSsl: config.ssl.enabled,
		ssl: {
			email: config.ssl.email,
			autoRenew: config.ssl.autoRenew,
			forceHttps: config.ssl.forceHttps,
			validation: config.ssl.validation,
		} satisfies ManagerSslFieldsValue,
	};
}

function ManagerEditFormLoaded({
	manager,
	credentials,
}: {
	manager: ManagerSettingsResponse;
	credentials: Awaited<ReturnType<typeof getCloudflareCredentials>>["items"];
}) {
	const { t } = useTranslation(["common"]);
	const router = useRouter();
	const initial = initialFromConfig(manager.config);
	const [primaryHostname, setPrimaryHostname] = React.useState(
		initial.primaryHostname,
	);
	const [aliases, setAliases] = React.useState(initial.aliases);
	const [enableSsl, setEnableSsl] = React.useState(initial.enableSsl);
	const [ssl, setSsl] = React.useState<ManagerSslFieldsValue>(initial.ssl);
	const [hostnameError, setHostnameError] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const [submitting, setSubmitting] = React.useState(false);

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(undefined);
		setHostnameError(undefined);

		const hostParsed = hostnameSchema.safeParse(
			primaryHostname.trim().toLowerCase().replace(/\.$/, ""),
		);
		if (!hostParsed.success) {
			const issue = hostParsed.error.issues[0];
			setHostnameError(
				formatMessageKey(
					t,
					issue?.message ?? "errors:validation.hostnamePattern",
					zodIssueParams(issue),
				),
			);
			return;
		}

		let sslPatch:
			| {
					enabled: boolean;
					email?: string;
					autoRenew?: boolean;
					forceHttps?: boolean;
					environment?: "production";
					validation?: ManagerSslFieldsValue["validation"];
			  }
			| undefined;

		if (enableSsl) {
			const parsed = managerSslConfigSchema.safeParse({
				enabled: true,
				provider: "letsencrypt",
				environment: "production",
				email: ssl.email,
				autoRenew: ssl.autoRenew,
				forceHttps: ssl.forceHttps,
				validation: ssl.validation,
			});
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				setError(
					formatMessageKey(
						t,
						issue?.message ?? "errors:sslFormInvalid",
						zodIssueParams(issue),
					),
				);
				return;
			}
			sslPatch = {
				enabled: true,
				email: parsed.data.email,
				autoRenew: parsed.data.autoRenew,
				forceHttps: parsed.data.forceHttps,
				environment: "production",
				validation: parsed.data.validation,
			};
		} else {
			sslPatch = { enabled: false, forceHttps: false };
		}

		setSubmitting(true);
		try {
			await updateManagerSettings({
				primaryHostname: hostParsed.data,
				aliases: parseAliases(aliases),
				ssl: sslPatch,
			});
			toast.success(t("common:settings.manager.draftSaved"));
			await router.push("/settings/manager");
		} catch (caught) {
			setError(
				formatErrorMessage(t, caught, "common:settings.manager.saveFailed"),
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={(event) => void save(event)} className="space-y-6">
			{error ? (
				<Alert variant="destructive">
					<AlertTitle>
						{t("common:settings.manager.operationFailed")}
					</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<Card className="border-border shadow-none">
				<CardHeader>
					<CardTitle className="text-lg font-semibold">
						{manager.status === "unconfigured"
							? t("common:settings.manager.bindTitle")
							: t("common:settings.manager.rebindTitle")}
					</CardTitle>
					<CardDescription>
						{manager.status === "unconfigured"
							? t("common:settings.manager.bindDescription")
							: t("common:settings.manager.rebindDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field data-invalid={Boolean(hostnameError)}>
							<FieldLabel htmlFor="managerPrimaryHostname">
								{t("common:settings.manager.primaryHostname")}
							</FieldLabel>
							<Input
								id="managerPrimaryHostname"
								placeholder="panel.example.com"
								autoComplete="off"
								value={primaryHostname}
								onChange={(event) => setPrimaryHostname(event.target.value)}
								aria-invalid={Boolean(hostnameError)}
							/>
							<FieldDescription>
								{t("common:settings.manager.primaryHostnameDesc")}
							</FieldDescription>
							{hostnameError ? <FieldError>{hostnameError}</FieldError> : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="managerAliases">
								{t("common:settings.manager.aliases")}
							</FieldLabel>
							<Input
								id="managerAliases"
								placeholder="admin.example.com"
								autoComplete="off"
								value={aliases}
								onChange={(event) => setAliases(event.target.value)}
							/>
							<FieldDescription>
								{t("common:settings.manager.aliasesDesc")}
							</FieldDescription>
						</Field>
						<Field
							orientation="horizontal"
							className="items-center justify-between rounded-lg border border-border p-4"
						>
							<div>
								<FieldLabel htmlFor="manager-enable-ssl">
									{t("common:settings.manager.editForm.enableSsl")}
								</FieldLabel>
								<FieldDescription>
									{t("common:settings.manager.editForm.enableSslDesc")}
								</FieldDescription>
							</div>
							<Switch
								id="manager-enable-ssl"
								checked={enableSsl}
								onCheckedChange={setEnableSsl}
							/>
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>

			{enableSsl ? (
				<Card className="border-border shadow-none">
					<CardHeader>
						<CardTitle className="text-lg font-semibold">
							{t("common:settings.manager.sslForm.cardTitle")}
						</CardTitle>
						<CardDescription>
							{t("common:settings.manager.sslForm.cardDescription")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ManagerSslFields
							value={ssl}
							credentials={credentials}
							onChange={setSsl}
						/>
					</CardContent>
				</Card>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="outline" asChild disabled={submitting}>
					<LocalizedLink href="/settings/manager">
						<ArrowLeftIcon data-icon="inline-start" />
						{t("common:settings.manager.editForm.back")}
					</LocalizedLink>
				</Button>
				<Button type="submit" disabled={submitting}>
					{submitting ? (
						<LoaderCircleIcon className="size-4 animate-spin" />
					) : (
						<SaveIcon data-icon="inline-start" />
					)}
					{t("common:settings.manager.saveDraft")}
				</Button>
			</div>
		</form>
	);
}

export function ManagerEditForm() {
	const { t } = useTranslation(["common"]);
	const managerQuery = useApiQuery(getManagerSettings);
	const credentialsQuery = useApiQuery(getCloudflareCredentials);

	if (
		(managerQuery.loading && !managerQuery.data) ||
		(credentialsQuery.loading && !credentialsQuery.data)
	) {
		return <Skeleton className="h-96 w-full" />;
	}

	if (managerQuery.error && !managerQuery.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>{t("common:settings.manager.loadFailed")}</AlertTitle>
				<AlertDescription>
					{formatErrorMessage(t, managerQuery.error)}
				</AlertDescription>
			</Alert>
		);
	}

	const manager = managerQuery.data!;
	const credentials =
		credentialsQuery.data?.items.filter((item) => item.status === "active") ??
		[];
	const formKey = `${manager.draftVersion?.id ?? manager.activeVersion?.id ?? "none"}:${manager.config?.bound ?? false}:${manager.config?.ssl.enabled ?? false}`;

	return (
		<ManagerEditFormLoaded
			key={formKey}
			manager={manager}
			credentials={credentials}
		/>
	);
}
