ALTER TABLE `config_versions` ADD `updated_at` integer;--> statement-breakpoint
UPDATE `config_versions` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_one_draft_per_domain` ON `config_versions` (`domain_id`) WHERE "config_versions"."status" = 'draft';
