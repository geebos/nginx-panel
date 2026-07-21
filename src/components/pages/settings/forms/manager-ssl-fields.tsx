import { useTranslation } from "react-i18next";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
	CloudflareCredentialSummary,
	ManagerSettingsResponse,
} from "@/lib/api";
import { LocalizedLink } from "@/components/i18n/localized-link";

export type ManagerSslConfig = NonNullable<
	ManagerSettingsResponse["config"]
>["ssl"];

export type ManagerSslFieldsValue = {
	email: string;
	autoRenew: boolean;
	forceHttps: boolean;
	validation: ManagerSslConfig["validation"];
};

export function validationMethodLabel(
	t: (key: string) => string,
	validation: ManagerSslConfig["validation"],
) {
	if (validation.provider === "cloudflare") {
		return t("common:settings.manager.sslForm.validationDnsCloudflare");
	}
	return t("common:settings.manager.sslForm.validationDnsManual");
}

export function ManagerSslFields({
	value,
	credentials,
	onChange,
}: {
	value: ManagerSslFieldsValue;
	credentials: CloudflareCredentialSummary[];
	onChange: (next: ManagerSslFieldsValue) => void;
}) {
	const { t } = useTranslation(["common"]);
	const validationValue =
		value.validation.provider === "manual" ? "dns-manual" : "dns-cloudflare";

	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="manager-ssl-email">
					{t("common:settings.manager.sslForm.acmeEmail")}
				</FieldLabel>
				<Input
					id="manager-ssl-email"
					type="email"
					value={value.email}
					onChange={(event) =>
						onChange({ ...value, email: event.target.value })
					}
				/>
				<FieldDescription>
					{t("common:settings.manager.sslForm.acmeEmailDesc")}
				</FieldDescription>
			</Field>
			<Field>
				<FieldLabel>
					{t("common:settings.manager.sslForm.environment")}
				</FieldLabel>
				<p className="text-sm text-muted-foreground">
					{t("common:settings.manager.sslForm.environmentProductionFixed")}
				</p>
			</Field>
			<Field>
				<FieldLabel>
					{t("common:settings.manager.sslForm.validationMethod")}
				</FieldLabel>
				<Select
					options={[
						{
							value: "dns-manual",
							label: t("common:settings.manager.sslForm.validationDnsManual"),
						},
						{
							value: "dns-cloudflare",
							label: t(
								"common:settings.manager.sslForm.validationDnsCloudflare",
							),
							disabled: !credentials.length,
						},
					]}
					value={validationValue}
					onChange={(next) =>
						onChange({
							...value,
							validation:
								next === "dns-cloudflare" && credentials[0]
									? {
											method: "dns-01",
											provider: "cloudflare",
											cloudflareCredentialId:
												value.validation.provider === "cloudflare"
													? value.validation.cloudflareCredentialId
													: credentials[0].id,
										}
									: { method: "dns-01", provider: "manual" },
						})
					}
				/>
				<FieldDescription>
					{credentials.length ? (
						t("common:settings.manager.sslForm.validationDescCloudflare")
					) : (
						<>
							{t("common:settings.manager.sslForm.validationDescEmpty")}{" "}
							<LocalizedLink
								className="text-primary underline-offset-4 hover:underline"
								href="/settings/cloudflare"
							>
								Cloudflare DNS
							</LocalizedLink>
						</>
					)}
				</FieldDescription>
			</Field>
			{value.validation.method === "dns-01" &&
			value.validation.provider === "cloudflare" ? (
				<Field>
					<FieldLabel>
						{t("common:settings.manager.sslForm.cloudflareCredential")}
					</FieldLabel>
					<Select
						options={credentials.map((credential) => ({
							value: credential.id,
							label: `${credential.name} · •••• ${credential.tokenLast4}`,
						}))}
						value={value.validation.cloudflareCredentialId}
						onChange={(credentialId) =>
							credentialId &&
							onChange({
								...value,
								validation: {
									method: "dns-01",
									provider: "cloudflare",
									cloudflareCredentialId: credentialId,
								},
							})
						}
					/>
				</Field>
			) : null}
			<Field orientation="horizontal">
				<FieldLabel htmlFor="manager-ssl-auto-renew">
					{t("common:settings.manager.sslForm.autoRenew")}
				</FieldLabel>
				<Switch
					id="manager-ssl-auto-renew"
					checked={value.autoRenew}
					onCheckedChange={(autoRenew) => onChange({ ...value, autoRenew })}
				/>
			</Field>
			<Field orientation="horizontal">
				<FieldLabel htmlFor="manager-ssl-force">
					{t("common:settings.manager.sslForm.forceHttps")}
				</FieldLabel>
				<Switch
					id="manager-ssl-force"
					checked={value.forceHttps}
					onCheckedChange={(forceHttps) => onChange({ ...value, forceHttps })}
				/>
			</Field>
		</FieldGroup>
	);
}
