DROP INDEX `job_scores_unique`;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `dimensions` text;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `profile_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `preferences_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `job_scores_unique` ON `job_scores` (`job_id`,`content_hash`,`rubric_version`,`model`,`profile_hash`,`preferences_hash`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `gate_result` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `prescore` real;