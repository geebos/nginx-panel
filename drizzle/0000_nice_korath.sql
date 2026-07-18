CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
