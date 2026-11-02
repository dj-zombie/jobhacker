CREATE TABLE `company_domains` (
	`company_key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`brand_id` text,
	`updated_at` text NOT NULL
);
