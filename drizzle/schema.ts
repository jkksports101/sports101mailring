import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const targetOrganizations = mysqlTable("target_organizations", {
  id: int("id").autoincrement().primaryKey(),
  organizationType: mysqlEnum("organizationType", ["elementary", "middle", "high", "sports_company"]).notNull(),
  industry: varchar("industry", { length: 120 }),
  organizationName: varchar("organizationName", { length: 240 }).notNull(),
  regionProvince: varchar("regionProvince", { length: 80 }).notNull(),
  regionDistrict: varchar("regionDistrict", { length: 120 }),
  contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
  contactPhone: varchar("contactPhone", { length: 40 }),
  contactName: varchar("contactName", { length: 120 }),
  source: varchar("source", { length: 80 }),
  unsubscribed: int("unsubscribed").default(0).notNull(),
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TargetOrganization = typeof targetOrganizations.$inferSelect;
export type InsertTargetOrganization = typeof targetOrganizations.$inferInsert;

export const emailCampaigns = mysqlTable("email_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  audienceType: varchar("audienceType", { length: 120 }),
  subject: varchar("subject", { length: 300 }).notNull(),
  previewText: varchar("previewText", { length: 300 }),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["draft", "ready", "sent"]).default("draft").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type InsertEmailCampaign = typeof emailCampaigns.$inferInsert;
