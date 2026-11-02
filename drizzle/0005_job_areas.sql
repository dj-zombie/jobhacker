CREATE TABLE `job_areas` (
	`job_id` integer NOT NULL,
	`area` text NOT NULL,
	PRIMARY KEY(`job_id`, `area`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `job_areas_area_idx` ON `job_areas` (`area`);
