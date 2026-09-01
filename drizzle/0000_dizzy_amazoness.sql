CREATE TABLE `email_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`audienceType` varchar(120),
	`subject` varchar(300) NOT NULL,
	`previewText` varchar(300),
	`body` text NOT NULL,
	`status` enum('draft','ready','sent') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `target_organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationType` enum('elementary','middle','high','sports_company') NOT NULL,
	`industry` varchar(120),
	`organizationName` varchar(240) NOT NULL,
	`regionProvince` varchar(80) NOT NULL,
	`regionDistrict` varchar(120),
	`contactEmail` varchar(320) NOT NULL,
	`contactPhone` varchar(40),
	`contactName` varchar(120),
	`source` varchar(80),
	`unsubscribed` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `target_organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
