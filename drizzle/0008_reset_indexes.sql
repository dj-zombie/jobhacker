CREATE INDEX `jobs_duplicate_of_idx` ON `jobs` (`duplicate_of`);--> statement-breakpoint
CREATE INDEX `events_job_idx` ON `events` (`job_id`);
