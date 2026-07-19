CREATE TABLE `auth_attempts` (
	`username_ip_hash` text PRIMARY KEY NOT NULL,
	`failure_count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`source_version_id` text,
	`source_certificate_id` text,
	`change_summary` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshot_checksum` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_domain_version_unique` ON `config_versions` (`domain_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_source_certificate_unique` ON `config_versions` (`source_certificate_id`);--> statement-breakpoint
CREATE TABLE `deployment_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`log_excerpt` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_steps_deployment_sequence_idx` ON `deployment_steps` (`deployment_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text,
	`config_version_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`previous_version_id` text,
	`input_json` text,
	`error_code` text,
	`error_message` text,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`config_version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_idempotency_key_unique` ON `deployments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `deployments_status_created_idx` ON `deployments` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_domain_created_idx` ON `deployments` (`domain_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `domain_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`hostname` text NOT NULL,
	`display_hostname` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_aliases_hostname_unique` ON `domain_aliases` (`hostname`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_hostname` text NOT NULL,
	`display_hostname` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`runtime_status` text DEFAULT 'unknown' NOT NULL,
	`active_version_id` text,
	`draft_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_primary_hostname_unique` ON `domains` (`primary_hostname`);