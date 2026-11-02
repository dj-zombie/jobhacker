ALTER TABLE `jobs` ADD `score_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_score_state_idx` ON `jobs` (`score_state`);