import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getSendableTargetsByIds, getTargetOrganizations, insertTargetOrganizations } from "./db";
import { collectSchoolTargets, collectSportsCompanyTargets, generateGeminiDraft, sendStibeeEmail, syncStibeeSubscribers } from "./integrations";
import { z } from "zod";

const filterSchema = z.object({ organizationTypes: z.array(z.string()).optional(), provinces: z.array(z.string()).optional(), industries: z.array(z.string()).optional() });
const targetInput = z.object({ id: z.number(), email: z.string().email(), name: z.string().optional(), organizationName: z.string().optional() });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  targets: router({
    list: protectedProcedure.input(filterSchema.optional()).query(({ input }) => getTargetOrganizations(input ?? {})),
    collect: protectedProcedure.mutation(async () => {
      const [schools, companies] = await Promise.all([collectSchoolTargets(), collectSportsCompanyTargets()]);
      const inserted = await insertTargetOrganizations([...schools.rows, ...companies.rows]);
      return { inserted, schools: schools.rows.length, companies: companies.rows.length, sources: { schools: schools.source, companies: companies.source }, warnings: [schools.warning, companies.warning].filter(Boolean) };
    }),
  }),
  ai: router({
    draft: protectedProcedure.input(z.object({ audienceType: z.string(), organizationName: z.string().optional(), offer: z.string().optional(), campaignGoal: z.string().optional() })).mutation(({ input }) => generateGeminiDraft(input)),
  }),
  stibee: router({
    sync: protectedProcedure.input(z.object({ listId: z.string().min(1), targets: z.array(targetInput).min(1) })).mutation(({ input }) => syncStibeeSubscribers(input.listId, input.targets.map(target => ({ email: target.email, name: target.name, organizationName: target.organizationName })))),
    send: protectedProcedure.input(z.object({ emailId: z.string().min(1), listId: z.string().min(1), targets: z.array(targetInput).min(1), subject: z.string().min(1), body: z.string().min(1), confirmed: z.literal(true) })).mutation(async ({ input }) => { const sendable = await getSendableTargetsByIds(input.targets.map(target => target.id)); if (!sendable.length) throw new Error("DB에서 발송 가능한 타깃을 찾지 못했습니다. 수신거부 또는 최신 필터 상태를 확인하세요."); const sync = await syncStibeeSubscribers(input.listId, sendable.map(target => ({ ...target, name: target.name ?? undefined }))); const sent = await sendStibeeEmail(input.emailId, input.subject, input.body); return { sync, sent, sendableCount: sendable.length }; }),
  }),
});

export type AppRouter = typeof appRouter;
