import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, targetOrganizations, TargetOrganization, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type TargetFilters = { organizationTypes?: string[]; provinces?: string[]; industries?: string[] };

export async function getTargetOrganizations(filters: TargetFilters = {}): Promise<TargetOrganization[]> {
  const db = await getDb();
  if (!db) return [];
  const clauses = [eq(targetOrganizations.unsubscribed, 0)];
  if (filters.organizationTypes?.length) clauses.push(inArray(targetOrganizations.organizationType, filters.organizationTypes as any));
  if (filters.provinces?.length) clauses.push(inArray(targetOrganizations.regionProvince, filters.provinces));
  if (filters.industries?.length) clauses.push(inArray(targetOrganizations.industry, filters.industries));
  return db.select().from(targetOrganizations).where(and(...clauses));
}

export async function insertTargetOrganizations(rows: Array<Omit<TargetOrganization, "id" | "createdAt" | "updatedAt" | "lastSentAt">>) {
  const db = await getDb();
  if (!db || !rows.length) return 0;
  const emails = rows.map(row => row.contactEmail).filter(Boolean);
  const existing = emails.length ? await db.select({ id: targetOrganizations.id, email: targetOrganizations.contactEmail }).from(targetOrganizations).where(inArray(targetOrganizations.contactEmail, emails)) : [];
  const existingByEmail = new Map(existing.map(row => [row.email, row.id]));
  const fresh = rows.filter(row => !existingByEmail.has(row.contactEmail));
  if (fresh.length) await db.insert(targetOrganizations).values(fresh);
  for (const row of rows) {
    const id = existingByEmail.get(row.contactEmail);
    if (id) await db.update(targetOrganizations).set({ ...row, updatedAt: new Date() }).where(eq(targetOrganizations.id, id));
  }
  return rows.length;
}

export async function getSendableTargetsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || !ids.length) return [];
  return db.select({ id: targetOrganizations.id, email: targetOrganizations.contactEmail, name: targetOrganizations.contactName, organizationName: targetOrganizations.organizationName }).from(targetOrganizations).where(and(inArray(targetOrganizations.id, ids), eq(targetOrganizations.unsubscribed, 0)));
}
