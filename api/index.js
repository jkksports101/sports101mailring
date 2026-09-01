// server/app.ts
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var targetOrganizations = mysqlTable("target_organizations", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var emailCampaigns = mysqlTable("email_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  audienceType: varchar("audienceType", { length: 120 }),
  subject: varchar("subject", { length: 300 }).notNull(),
  previewText: varchar("previewText", { length: 300 }),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["draft", "ready", "sent"]).default("draft").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  for (const field of ["name", "email", "loginMethod"]) {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function getTargetOrganizations(filters = {}) {
  const db = await getDb();
  if (!db) return [];
  const clauses = [eq(targetOrganizations.unsubscribed, 0)];
  if (filters.organizationTypes?.length) clauses.push(inArray(targetOrganizations.organizationType, filters.organizationTypes));
  if (filters.provinces?.length) clauses.push(inArray(targetOrganizations.regionProvince, filters.provinces));
  if (filters.industries?.length) clauses.push(inArray(targetOrganizations.industry, filters.industries));
  return db.select().from(targetOrganizations).where(and(...clauses));
}
async function insertTargetOrganizations(rows) {
  const db = await getDb();
  if (!db || !rows.length) return 0;
  const emails = rows.map((row) => row.contactEmail).filter(Boolean);
  const existing = emails.length ? await db.select({ id: targetOrganizations.id, email: targetOrganizations.contactEmail }).from(targetOrganizations).where(inArray(targetOrganizations.contactEmail, emails)) : [];
  const existingByEmail = new Map(existing.map((row) => [row.email, row.id]));
  const fresh = rows.filter((row) => !existingByEmail.has(row.contactEmail));
  if (fresh.length) await db.insert(targetOrganizations).values(fresh);
  for (const row of rows) {
    const id = existingByEmail.get(row.contactEmail);
    if (id) await db.update(targetOrganizations).set({ ...row, updatedAt: /* @__PURE__ */ new Date() }).where(eq(targetOrganizations.id, id));
  }
  return rows.length;
}
async function getSendableTargetsByIds(ids) {
  const db = await getDb();
  if (!db || !ids.length) return [];
  return db.select({ id: targetOrganizations.id, email: targetOrganizations.contactEmail, name: targetOrganizations.contactName, organizationName: targetOrganizations.organizationName }).from(targetOrganizations).where(and(inArray(targetOrganizations.id, ids), eq(targetOrganizations.unsubscribed, 0)));
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app2) {
  app2.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/integrations.ts
var NEIS_URL = "https://open.neis.go.kr/hub/schoolInfo";
var STIBEE_BASE = "https://api.stibee.com/v2";
function mockTargets(type) {
  return Array.from({ length: 50 }, (_, index) => {
    const n = index + 1;
    const isSchool = type === "school";
    return {
      organizationType: isSchool ? n % 3 === 0 ? "high" : n % 2 === 0 ? "middle" : "elementary" : "sports_company",
      industry: isSchool ? "\uD559\uAD50" : n % 2 ? "\uC720\uC18C\uB144 \uC2A4\uD3EC\uCE20" : "\uC2A4\uD3EC\uCE20\uD14C\uD06C",
      organizationName: isSchool ? `\uC2A4\uD3EC\uCE20101 \uD14C\uC2A4\uD2B8 \uD559\uAD50 ${n}` : `\uC2A4\uD3EC\uCE20101 \uD14C\uC2A4\uD2B8 \uAE30\uC5C5 ${n}`,
      regionProvince: ["\uC11C\uC6B8", "\uACBD\uAE30", "\uBD80\uC0B0", "\uB300\uC804", "\uAD11\uC8FC"][n % 5],
      regionDistrict: `${n}\uAD6C`,
      contactEmail: `${type}${n}@example.invalid`,
      contactPhone: `02-0000-${String(n).padStart(4, "0")}`,
      contactName: null,
      source: "mock",
      unsubscribed: 0
    };
  });
}
function normalizeSchool(row) {
  const schoolType = String(row.SCHUL_KND_SC_NM ?? row.SCHUL_KND_SC ?? "");
  return {
    organizationType: schoolType.includes("\uCD08") ? "elementary" : schoolType.includes("\uACE0") ? "high" : "middle",
    industry: "\uD559\uAD50",
    organizationName: String(row.SCHUL_NM ?? "\uD559\uAD50\uBA85 \uBBF8\uC0C1"),
    regionProvince: String(row.LCTN_SC_NM ?? row.ATPT_OFCDC_SC_NM ?? "\uBBF8\uC0C1"),
    regionDistrict: row.LCTN_SC_NM ? String(row.LCTN_SC_NM) : null,
    contactEmail: String(row.ORG_RDNMA ?? row.HMPG_ADRES ?? "").includes("@") ? String(row.ORG_RDNMA) : "",
    contactPhone: row.ORG_TELNO ? String(row.ORG_TELNO) : null,
    contactName: null,
    source: "NEIS",
    unsubscribed: 0
  };
}
async function collectSchoolTargets() {
  const key = process.env.NEIS_API_KEY;
  if (!key) return { rows: mockTargets("school"), source: "mock", warning: "NEIS_API_KEY\uAC00 \uC5C6\uC5B4 Mock \uD559\uAD50 \uB370\uC774\uD130 50\uAC74\uC744 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4." };
  try {
    const url = new URL(NEIS_URL);
    url.searchParams.set("KEY", key);
    url.searchParams.set("Type", "json");
    url.searchParams.set("pIndex", "1");
    url.searchParams.set("pSize", "1000");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NEIS ${response.status}`);
    const payload = await response.json();
    const rows = payload.schoolInfo?.[1]?.row ?? [];
    if (!rows.length) throw new Error("NEIS \uC751\uB2F5\uC5D0 \uD559\uAD50 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    return { rows: rows.map(normalizeSchool).filter((row) => row.organizationName && row.contactEmail), source: "NEIS" };
  } catch (error) {
    return { rows: mockTargets("school"), source: "mock", warning: `NEIS \uC218\uC9D1 \uC2E4\uD328\uB85C Mock \uD559\uAD50 \uB370\uC774\uD130 50\uAC74\uC744 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4: ${String(error)}` };
  }
}
async function collectSportsCompanyTargets() {
  const key = process.env.DATA_GO_KR_API_KEY;
  const endpoint = process.env.DATA_GO_KR_SPORTS_API_URL;
  if (!key || !endpoint) return { rows: mockTargets("company"), source: "mock", warning: "DATA_GO_KR_API_KEY \uB610\uB294 DATA_GO_KR_SPORTS_API_URL\uC774 \uC5C6\uC5B4 Mock \uC2A4\uD3EC\uCE20 \uAE30\uC5C5 \uB370\uC774\uD130 50\uAC74\uC744 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4." };
  try {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("type", "json");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`data.go.kr ${response.status}`);
    const payload = await response.json();
    const rows = payload.response?.body?.items?.item ?? payload.items ?? [];
    const normalized = rows.map((row) => ({ organizationType: "sports_company", industry: String(row.indutyNm ?? row.industry ?? "\uC2A4\uD3EC\uCE20\uC0B0\uC5C5"), organizationName: String(row.bizesNm ?? row.companyName ?? "\uAE30\uC5C5\uBA85 \uBBF8\uC0C1"), regionProvince: String(row.ctprvnNm ?? row.region ?? "\uBBF8\uC0C1"), regionDistrict: row.signguNm ? String(row.signguNm) : null, contactEmail: String(row.email ?? row.emailAddr ?? ""), contactPhone: row.telno ? String(row.telno) : null, contactName: null, source: "data.go.kr", unsubscribed: 0 })).filter((row) => row.contactEmail.includes("@"));
    if (!normalized.length) throw new Error("\uC2A4\uD3EC\uCE20 \uAE30\uC5C5 \uC774\uBA54\uC77C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    return { rows: normalized, source: "data.go.kr" };
  } catch (error) {
    return { rows: mockTargets("company"), source: "mock", warning: `\uACF5\uACF5\uB370\uC774\uD130 \uC218\uC9D1 \uC2E4\uD328\uB85C Mock \uC2A4\uD3EC\uCE20 \uAE30\uC5C5 \uB370\uC774\uD130 50\uAC74\uC744 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4: ${String(error)}` };
  }
}
var segmentProfiles = {
  elementary: { role: "\uCD08\uB4F1\uD559\uAD50 \uCCB4\uC721 \uB2F4\uB2F9 \uAD50\uC0AC", pain: "\uD559\uC0DD\uBCC4 \uCCB4\uB825 \uCC28\uC774\uC640 \uC218\uC5C5 \uCC38\uC5EC\uB3C4 \uAD00\uB9AC", value: "\uC548\uC804\uD558\uACE0 \uC7AC\uBBF8\uC788\uB294 \uAE30\uCD08 \uCCB4\uB825\xB7\uC9D1\uC911\uB825 \uD5A5\uC0C1 \uD504\uB85C\uADF8\uB7A8", proof: "\uD559\uAD50 \uD604\uC7A5\uC5D0\uC11C \uBC14\uB85C \uC801\uC6A9 \uAC00\uB2A5\uD55C \uB2E8\uACC4\uD615 \uC6B4\uC601", cta: "\uD559\uAD50 \uB9DE\uCDA4 \uC81C\uC548\uC11C \uC694\uCCAD\uD558\uAE30" },
  middle: { role: "\uC911\uD559\uAD50 \uCCB4\uC721\uBD80\uC7A5 \uB610\uB294 \uCCB4\uC721\uAD50\uC0AC", pain: "\uC81C\uD55C\uB41C \uC218\uC5C5 \uC2DC\uAC04 \uC548\uC5D0\uC11C \uD559\uC0DD \uCC38\uC5EC\uC640 \uC6B4\uB3D9 \uD6A8\uACFC\uB97C \uD568\uAED8 \uD655\uBCF4", value: "\uCE21\uC815 \uAC00\uB2A5\uD55C \uD6C8\uB828 \uB8E8\uD2F4\uACFC \uD559\uC0DD \uCC38\uC5EC\uB97C \uB192\uC774\uB294 \uC2A4\uD3EC\uCE20 \uC194\uB8E8\uC158", proof: "\uAD50\uC0AC \uC5C5\uBB34 \uBD80\uB2F4\uC744 \uB298\uB9AC\uC9C0 \uC54A\uB294 \uB3C4\uC785 \uBC29\uC2DD", cta: "\uC911\uD559\uAD50 \uB9DE\uCDA4 \uC0C1\uB2F4 \uC2E0\uCCAD\uD558\uAE30" },
  high: { role: "\uACE0\uB4F1\uD559\uAD50 \uCCB4\uC721\uBD80\uC7A5 \uB610\uB294 \uCCB4\uC721\uAD50\uC0AC", pain: "\uC785\uC2DC\xB7\uD6C8\uB828 \uC77C\uC815 \uC18D \uACBD\uAE30\uB825 \uAD00\uB9AC\uC640 \uD559\uC0DD \uCEE8\uB514\uC158 \uD3B8\uCC28", value: "\uC120\uC218\xB7\uD559\uC0DD\uC758 \uC9D1\uC911\uB825\uACFC \uD37C\uD3EC\uBA3C\uC2A4\uB97C \uCCB4\uACC4\uC801\uC73C\uB85C \uAD00\uB9AC\uD558\uB294 \uD504\uB85C\uADF8\uB7A8", proof: "\uD6C8\uB828 \uC804\uD6C4 \uB8E8\uD2F4\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC788\uB294 \uC6B4\uC601 \uBAA8\uB378", cta: "\uACE0\uAD50 \uD37C\uD3EC\uBA3C\uC2A4 \uC81C\uC548 \uBC1B\uAE30" },
  sports_company: { role: "\uC2A4\uD3EC\uCE20 \uAE30\uC5C5 \uB300\uD45C \uB610\uB294 \uC0AC\uC5C5\uAC1C\uBC1C \uCC45\uC784\uC790", pain: "\uCC28\uBCC4\uD654\uB41C \uC0C1\uD488 \uACBD\uC7C1\uB825\uACFC \uC2E0\uADDC B2B \uD310\uB85C \uD655\uBCF4", value: "\uC2A4\uD3EC\uCE20101 \uD50C\uB7AB\uD3FC\uACFC \uC5F0\uACB0\uB41C \uACF5\uB3D9 \uCEA0\uD398\uC778\xB7\uC81C\uD734 \uAE30\uD68C", proof: "\uD0C0\uAE43 \uACE0\uAC1D\uAD70\uC5D0 \uB9DE\uCD98 \uACF5\uB3D9 \uC81C\uC548 \uBC0F \uC2E4\uBB34 \uD611\uC5C5", cta: "\uC81C\uD734 \uBBF8\uD305 \uC81C\uC548\uD558\uAE30" }
};
function fallbackDraft(input) {
  const profile = segmentProfiles[input.audienceType] ?? segmentProfiles.sports_company;
  return { subject: `[\uAD11\uACE0] ${profile.role}\uC744 \uC704\uD55C \uC2A4\uD3EC\uCE20101 \uC81C\uC548`, preheader: `${profile.pain}\uC744 \uC904\uC774\uB294 \uB9DE\uCDA4\uD615 \uC194\uB8E8\uC158\uC744 \uD655\uC778\uD558\uC138\uC694.`, body: `\uC548\uB155\uD558\uC138\uC694, ${input.organizationName ?? "\uB2F4\uB2F9\uC790"} ${profile.role}\uB2D8.

${profile.pain}\uC73C\uB85C \uACE0\uBBFC\uD558\uACE0 \uACC4\uC2E0\uAC00\uC694? \uC2A4\uD3EC\uCE20101\uC740 ${profile.value}\uC744 \uC81C\uC548\uB4DC\uB9BD\uB2C8\uB2E4.

${profile.proof}\uC744 \uBC14\uD0D5\uC73C\uB85C ${input.offer ?? "\uB9DE\uCDA4\uD615 \uC0C1\uB2F4"}\uC744 \uC548\uB0B4\uD574 \uB4DC\uB9AC\uACA0\uC2B5\uB2C8\uB2E4.

\uBD80\uB2F4 \uC5C6\uC774 \uD604\uC7AC \uC0C1\uD669\uC744 \uC54C\uB824\uC8FC\uC2DC\uBA74 \uC801\uD569\uD55C \uB2E4\uC74C \uB2E8\uACC4\uB97C \uD568\uAED8 \uC124\uACC4\uD558\uACA0\uC2B5\uB2C8\uB2E4.`, cta: profile.cta, complianceNotes: ["\uC81C\uBAA9\uC5D0 [\uAD11\uACE0] \uD45C\uAE30", "\uC2DC\uC2A4\uD15C footer\uC5D0 \uBB34\uB8CC \uC218\uC2E0\uAC70\uBD80 \uB9C1\uD06C \uC0BD\uC785"], source: "fallback" };
}
var forbiddenPhrases = ["100%", "\uBB34\uC870\uAC74", "\uD655\uC2E4\uD55C \uC131\uACFC", "\uB300\uBC15", "\uCD5C\uACE0\uC758 \uACB0\uACFC", "\uC131\uACFC \uBCF4\uC7A5", "\uC808\uB300"];
function validateGeminiDraft(value) {
  if (!value || typeof value.subject !== "string" || typeof value.preheader !== "string" || typeof value.body !== "string" || typeof value.cta !== "string" || !Array.isArray(value.complianceNotes)) return false;
  const text2 = `${value.subject} ${value.preheader} ${value.body} ${value.cta}`;
  return value.subject.includes("[\uAD11\uACE0]") && value.preheader.length <= 80 && value.body.trim().length >= 20 && value.cta.trim().length > 0 && !forbiddenPhrases.some((phrase) => text2.includes(phrase));
}
async function generateGeminiDraft(input) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackDraft(input);
  const profile = segmentProfiles[input.audienceType] ?? segmentProfiles.sports_company;
  const prompt = `\uB2F9\uC2E0\uC740 \uC2A4\uD3EC\uCE20101\uC758 10\uB144 \uCC28 B2B CRM \uCE74\uD53C\uB77C\uC774\uD130\uC785\uB2C8\uB2E4. \uC544\uB798 \uC870\uAC74\uC73C\uB85C \uD55C\uAD6D\uC5B4 \uC774\uBA54\uC77C \uCD08\uC548\uC744 \uC791\uC131\uD558\uC138\uC694.

[\uC218\uC2E0\uC790] ${profile.role}
[\uAE30\uAD00\uBA85] ${input.organizationName ?? "\uAE30\uAD00\uBA85 \uBBF8\uC0C1"}
[\uD575\uC2EC \uD398\uC778\uD3EC\uC778\uD2B8] ${profile.pain}
[\uC81C\uC548 \uAC00\uCE58] ${profile.value}
[\uC2E0\uB8B0 \uADFC\uAC70] ${profile.proof}
[\uCEA0\uD398\uC778 \uBAA9\uC801] ${input.campaignGoal ?? "\uCCAB \uC0C1\uB2F4 \uC804\uD658"}
[\uC81C\uACF5 \uD61C\uD0DD] ${input.offer ?? "\uB9DE\uCDA4 \uC0C1\uB2F4"}

\uC791\uC131 \uADDC\uCE59:
1. \uC81C\uBAA9\uC740 28\uC790 \uC774\uB0B4\uC774\uBA70 \uB9E8 \uC55E\uC5D0 \uBC18\uB4DC\uC2DC [\uAD11\uACE0]\uB97C \uB123\uC2B5\uB2C8\uB2E4. \uACFC\uC7A5\xB7\uACF5\uD3EC\xB7\uC131\uACFC \uBCF4\uC7A5 \uD45C\uD604\uC740 \uAE08\uC9C0\uD569\uB2C8\uB2E4.
2. \uD504\uB9AC\uD5E4\uB354\uB294 45\uC790 \uC774\uB0B4\uB85C \uC81C\uBAA9\uC744 \uBCF4\uC644\uD558\uACE0 \uAD6C\uCCB4\uC801\uC778 \uC774\uC775\uC744 \uC81C\uC2DC\uD569\uB2C8\uB2E4.
3. \uBCF8\uBB38\uC740 5~7\uAC1C\uC758 \uC9E7\uC740 \uBB38\uB2E8\uC73C\uB85C \uC791\uC131\uD558\uACE0, \uD55C \uBB38\uB2E8\uC740 2\uBB38\uC7A5\uC744 \uB118\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC804\uBB38\uC801\uC774\uB418 \uC2A4\uD3EC\uCE20 \uD604\uC7A5 \uB3D9\uB8CC\uC5D0\uAC8C \uB9D0\uD558\uB4EF \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uC501\uB2C8\uB2E4.
4. \uC218\uC2E0\uC790\uC758 \uC5ED\uD560\uACFC \uC2E4\uC81C \uC5C5\uBB34 \uB9E5\uB77D\uC744 \uCCAB \uB450 \uBB38\uB2E8 \uC548\uC5D0 \uBC18\uC601\uD569\uB2C8\uB2E4. \uAE30\uB2A5 \uB098\uC5F4\uBCF4\uB2E4 \uBB38\uC81C-\uD574\uACB0-\uB2E4\uC74C \uD589\uB3D9 \uC21C\uC11C\uB85C \uC501\uB2C8\uB2E4.
5. \uD655\uC778\uB418\uC9C0 \uC54A\uC740 \uACE0\uAC1D\uC0AC\xB7\uC120\uC218\xB7\uAD6D\uAC00\uB300\uD45C\xB7\uC218\uCE58\xB7\uC131\uACFC\xB7\uD6C4\uAE30\xB7\uC778\uC99D\uC744 \uB9CC\uB4E4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
6. \uBCF8\uBB38\uC5D0\uB294 \uC218\uC2E0\uAC70\uBD80 \uB9C1\uD06C\uB97C \uC9C1\uC811 \uB9CC\uB4E4\uC9C0 \uB9D0\uACE0 \uC2DC\uC2A4\uD15C footer\uAC00 \uC0BD\uC785\uD558\uB3C4\uB85D \uB461\uB2C8\uB2E4.
7. CTA\uB294 \uBD80\uB2F4\uC774 \uB0AE\uC740 \uC0C1\uB2F4\xB7\uC81C\uC548\uC11C \uD655\uC778 \uD589\uB3D9\uC73C\uB85C 1\uAC1C\uB9CC \uC81C\uC548\uD569\uB2C8\uB2E4.

\uBC18\uB4DC\uC2DC JSON\uB9CC \uBC18\uD658\uD558\uC138\uC694. \uD0A4\uB294 subject, preheader, body, cta, complianceNotes\uC785\uB2C8\uB2E4. complianceNotes\uC5D0\uB294 \uAD11\uACE0 \uD45C\uAE30\uC640 \uC218\uC2E0\uAC70\uBD80 footer \uC0BD\uC785 \uD544\uC694 \uC5EC\uBD80\uB97C \uBC30\uC5F4\uB85C \uC801\uC2B5\uB2C8\uB2E4.`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { subject: { type: "STRING" }, preheader: { type: "STRING" }, body: { type: "STRING" }, cta: { type: "STRING" }, complianceNotes: { type: "ARRAY", items: { type: "STRING" } } }, required: ["subject", "preheader", "body", "cta", "complianceNotes"] } } }) });
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const payload = await response.json();
  const text2 = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text2.replace(/^```json\\s*|\\s*```$/g, ""));
    if (!validateGeminiDraft(parsed)) return fallbackDraft(input);
    return { ...parsed, source: "gemini" };
  } catch {
    return fallbackDraft(input);
  }
}
async function stibeeRequest(path, init = {}) {
  const key = process.env.STIBEE_API_KEY;
  if (!key) throw new Error("STIBEE_API_KEY\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
  const response = await fetch(`${STIBEE_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", AccessToken: key, ...init.headers ?? {} } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Stibee ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function syncStibeeSubscribers(listId, rows) {
  if (!listId) throw new Error("Stibee \uC8FC\uC18C\uB85D ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const subscribers = rows.filter((row) => row.email && !row.email.endsWith(".invalid")).map((row) => ({ email: row.email, name: row.name ?? row.organizationName ?? "\uB2F4\uB2F9\uC790" }));
  if (!subscribers.length) return { added: 0, skipped: rows.length };
  const result = await stibeeRequest(`/lists/${encodeURIComponent(listId)}/subscribers/batch`, { method: "POST", body: JSON.stringify({ subscribers }) });
  return { added: subscribers.length, skipped: rows.length - subscribers.length, result };
}
function buildCompliantHtml(body) {
  if (!body.trim()) throw new Error("\uC774\uBA54\uC77C \uBCF8\uBB38\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
  return `<div>${body.replace(/\n/g, "<br />")}</div><hr /><p style="font-size:12px;color:#777">\uBCF8 \uBA54\uC77C\uC740 \uC815\uBCF4\uD1B5\uC2E0\uB9DD\uBC95\uC5D0 \uB530\uB978 \uAD11\uACE0\uC131 \uC815\uBCF4\uC785\uB2C8\uB2E4.</p><p style="font-size:12px;color:#777"><a href="{{unsubscribe}}">\uBB34\uB8CC \uC218\uC2E0\uAC70\uBD80</a></p>`;
}
async function updateStibeeEmailContent(emailId, subject, body) {
  if (!emailId) throw new Error("Stibee \uC774\uBA54\uC77C ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  if (!subject.includes("[\uAD11\uACE0]")) throw new Error("\uAD11\uACE0\uC131 \uC774\uBA54\uC77C \uC81C\uBAA9\uC5D0\uB294 [\uAD11\uACE0] \uD45C\uAE30\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const html = buildCompliantHtml(body);
  return stibeeRequest(`/emails/${encodeURIComponent(emailId)}`, { method: "PUT", body: JSON.stringify({ subject, content: { html } }) });
}
async function sendStibeeEmail(emailId, subject, body) {
  await updateStibeeEmailContent(emailId, subject, body);
  return stibeeRequest(`/emails/${encodeURIComponent(emailId)}/send`, { method: "POST", body: JSON.stringify({}) });
}

// server/routers.ts
import { z as z2 } from "zod";
var filterSchema = z2.object({ organizationTypes: z2.array(z2.string()).optional(), provinces: z2.array(z2.string()).optional(), industries: z2.array(z2.string()).optional() });
var targetInput = z2.object({ id: z2.number(), email: z2.string().email(), name: z2.string().optional(), organizationName: z2.string().optional() });
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  targets: router({
    list: protectedProcedure.input(filterSchema.optional()).query(({ input }) => getTargetOrganizations(input ?? {})),
    collect: protectedProcedure.mutation(async () => {
      const [schools, companies] = await Promise.all([collectSchoolTargets(), collectSportsCompanyTargets()]);
      const inserted = await insertTargetOrganizations([...schools.rows, ...companies.rows]);
      return { inserted, schools: schools.rows.length, companies: companies.rows.length, sources: { schools: schools.source, companies: companies.source }, warnings: [schools.warning, companies.warning].filter(Boolean) };
    })
  }),
  ai: router({
    draft: protectedProcedure.input(z2.object({ audienceType: z2.string(), organizationName: z2.string().optional(), offer: z2.string().optional(), campaignGoal: z2.string().optional() })).mutation(({ input }) => generateGeminiDraft(input))
  }),
  stibee: router({
    sync: protectedProcedure.input(z2.object({ listId: z2.string().min(1), targets: z2.array(targetInput).min(1) })).mutation(({ input }) => syncStibeeSubscribers(input.listId, input.targets.map((target) => ({ email: target.email, name: target.name, organizationName: target.organizationName })))),
    send: protectedProcedure.input(z2.object({ emailId: z2.string().min(1), listId: z2.string().min(1), targets: z2.array(targetInput).min(1), subject: z2.string().min(1), body: z2.string().min(1), confirmed: z2.literal(true) })).mutation(async ({ input }) => {
      const sendable = await getSendableTargetsByIds(input.targets.map((target) => target.id));
      if (!sendable.length) throw new Error("DB\uC5D0\uC11C \uBC1C\uC1A1 \uAC00\uB2A5\uD55C \uD0C0\uAE43\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC218\uC2E0\uAC70\uBD80 \uB610\uB294 \uCD5C\uC2E0 \uD544\uD130 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.");
      const sync = await syncStibeeSubscribers(input.listId, sendable.map((target) => ({ ...target, name: target.name ?? void 0 })));
      const sent = await sendStibeeEmail(input.emailId, input.subject, input.body);
      return { sync, sent, sendableCount: sendable.length };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/app.ts
function createApiApp() {
  const app2 = express();
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app2);
  registerOAuthRoutes(app2);
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}

// api/index.ts
var app = createApiApp();
var index_default = app;
export {
  index_default as default
};
