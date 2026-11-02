CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'prepped' NOT NULL,
	`resume_html` text,
	`resume_pdf_path` text,
	`cover_note` text,
	`answers` text,
	`fill_report` text,
	`submitted_at` text,
	`follow_up_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_id_unique` ON `applications` (`job_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ats` text NOT NULL,
	`token` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_ats_token_unique` ON `companies` (`ats`,`token`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer,
	`job_id` integer,
	`type` text NOT NULL,
	`payload` text,
	`at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `events_at_idx` ON `events` (`at`);--> statement-breakpoint
CREATE TABLE `job_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`rubric_version` text NOT NULL,
	`model` text NOT NULL,
	`score` integer NOT NULL,
	`verdict` text NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`red_flags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_scores_unique` ON `job_scores` (`job_id`,`content_hash`,`rubric_version`,`model`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`ats` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`location_raw` text,
	`remote_type` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text,
	`url` text NOT NULL,
	`apply_url` text,
	`description_text` text DEFAULT '' NOT NULL,
	`comp_min` integer,
	`comp_max` integer,
	`comp_currency` text,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`closed_at` text,
	`content_hash` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`duplicate_of` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`filter_reason` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_of`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_ats_external_unique` ON `jobs` (`ats`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer,
	`stats` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `runs_kind_idx` ON `runs` (`kind`);