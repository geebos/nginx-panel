ALTER TABLE `domains` ADD `type` text DEFAULT 'domain' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `domains_one_manager` ON `domains` (`type`) WHERE type = 'manager' AND deleted_at IS NULL;
