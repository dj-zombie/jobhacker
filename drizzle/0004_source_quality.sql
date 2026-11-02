ALTER TABLE `jobs` ADD `source_kind` text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_quality` text DEFAULT 'high' NOT NULL;--> statement-breakpoint
UPDATE `jobs` SET `source_name` = `ats` WHERE `source_name` = '';--> statement-breakpoint
CREATE TABLE `source_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_name` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`est_cost_usd` real DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `source_usage_source_day_unique` ON `source_usage` (`source_name`,`day`);
