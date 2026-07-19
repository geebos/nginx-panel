CREATE TABLE `acme_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`hostname` text NOT NULL,
	`type` text NOT NULL,
	`token` text,
	`key_authorization` text,
	`dns_record_name` text,
	`dns_record_value` text,
	`cloudflare_zone_id` text,
	`cloudflare_record_id` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`cleaned_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `acme_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acme_challenges_order_hostname_unique` ON `acme_challenges` (`order_id`,`hostname`);--> statement-breakpoint
CREATE INDEX `acme_challenges_http_lookup_idx` ON `acme_challenges` (`domain_id`,`hostname`,`type`,`expires_at`);--> statement-breakpoint
CREATE TABLE `acme_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`replaces_certificate_id` text,
	`validation_method` text NOT NULL,
	`dns_provider` text,
	`cloudflare_credential_id` text,
	`cloudflare_credential_name` text,
	`account_email` text NOT NULL,
	`environment` text NOT NULL,
	`status` text NOT NULL,
	`order_url` text,
	`identifiers_json` text NOT NULL,
	`unpublished_base_version_id` text,
	`cleanup_status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`next_poll_at` integer,
	`last_polled_at` integer,
	`expires_at` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cloudflare_credential_id`) REFERENCES `cloudflare_credentials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unpublished_base_version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acme_orders_idempotency_key_unique` ON `acme_orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `acme_orders_status_poll_idx` ON `acme_orders` (`status`,`next_poll_at`);--> statement-breakpoint
CREATE TABLE `certificate_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`certificate_id` text NOT NULL,
	`status` text NOT NULL,
	`config_version_id` text,
	`deployment_id` text,
	`error_code` text,
	`error_message` text,
	`next_attempt_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`certificate_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`config_version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificate_activations_certificate_id_unique` ON `certificate_activations` (`certificate_id`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`acme_order_id` text NOT NULL,
	`provider` text NOT NULL,
	`environment` text NOT NULL,
	`status` text NOT NULL,
	`sans_json` text NOT NULL,
	`cert_path` text NOT NULL,
	`key_path` text NOT NULL,
	`cert_file_checksum` text NOT NULL,
	`public_key_spki_checksum` text NOT NULL,
	`not_before` integer,
	`not_after` integer,
	`auto_renew` integer NOT NULL,
	`last_validation_method` text,
	`last_dns_provider` text,
	`cloudflare_credential_id` text,
	`last_error_code` text,
	`issued_at` integer,
	`activated_at` integer,
	`next_check_at` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`acme_order_id`) REFERENCES `acme_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cloudflare_credential_id`) REFERENCES `cloudflare_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_acme_order_id_unique` ON `certificates` (`acme_order_id`);--> statement-breakpoint
CREATE INDEX `certificates_domain_status_idx` ON `certificates` (`domain_id`,`status`);--> statement-breakpoint
CREATE INDEX `certificates_status_expiry_idx` ON `certificates` (`status`,`not_after`);--> statement-breakpoint
CREATE TABLE `cloudflare_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_ciphertext` blob NOT NULL,
	`token_iv` blob NOT NULL,
	`token_auth_tag` blob NOT NULL,
	`token_last4` text NOT NULL,
	`cloudflare_token_id` text,
	`status` text NOT NULL,
	`expires_at` integer,
	`visible_zone_count` integer,
	`last_verified_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloudflare_credentials_name_unique` ON `cloudflare_credentials` (`name`);