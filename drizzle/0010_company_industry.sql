CREATE TABLE `company_industry` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`industry_id` text,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`input_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `company_industry_company_idx` ON `company_industry` (`company_id`);--> statement-breakpoint
CREATE INDEX `company_industry_industry_idx` ON `company_industry` (`industry_id`);
