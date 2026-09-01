import { describe, expect, it, vi } from "vitest";
import { collectSchoolTargets, collectSportsCompanyTargets, generateGeminiDraft, updateStibeeEmailContent, validateGeminiDraft } from "./integrations";

describe("integration safety fallbacks", () => {
  it("creates 50 school and 50 company mock rows when source configuration is absent", async () => {
    const neis = process.env.NEIS_API_KEY;
    const dataKey = process.env.DATA_GO_KR_API_KEY;
    const endpoint = process.env.DATA_GO_KR_SPORTS_API_URL;
    delete process.env.NEIS_API_KEY;
    delete process.env.DATA_GO_KR_API_KEY;
    delete process.env.DATA_GO_KR_SPORTS_API_URL;
    const [schools, companies] = await Promise.all([collectSchoolTargets(), collectSportsCompanyTargets()]);
    if (neis) process.env.NEIS_API_KEY = neis;
    if (dataKey) process.env.DATA_GO_KR_API_KEY = dataKey;
    if (endpoint) process.env.DATA_GO_KR_SPORTS_API_URL = endpoint;
    expect(schools.rows).toHaveLength(50);
    expect(companies.rows).toHaveLength(50);
    expect(schools.source).toBe("mock");
    expect(companies.source).toBe("mock");
  });

  it("uses a safe Gemini fallback without a key", async () => {
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const draft = await generateGeminiDraft({ audienceType: "학교 체육부장" });
    if (key) process.env.GEMINI_API_KEY = key;
    expect(draft.source).toBe("fallback");
    expect(draft.subject).toContain("[광고]");
  });

  it("falls back when Gemini returns malformed JSON", async () => {
    const key = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), { status: 200 }));
    const draft = await generateGeminiDraft({ audienceType: "middle" });
    fetchMock.mockRestore();
    if (key) process.env.GEMINI_API_KEY = key; else delete process.env.GEMINI_API_KEY;
    expect(draft.source).toBe("fallback");
    expect(draft.complianceNotes).toHaveLength(2);
  });

  it("requires the complete structured draft and blocks forbidden claims", () => {
    expect(validateGeminiDraft({ subject: "[광고] 제안", preheader: "맞춤형 안내", body: "충분히 긴 본문으로 현장 맥락과 다음 행동을 안내합니다.", cta: "상담 신청", complianceNotes: ["footer"] })).toBe(true);
    expect(validateGeminiDraft({ subject: "[광고] 100% 성과 보장", preheader: "안내", body: "충분히 긴 본문으로 현장 맥락과 다음 행동을 안내합니다.", cta: "상담", complianceNotes: [] })).toBe(false);
    expect(validateGeminiDraft({ subject: "[광고] 제목", body: "본문", cta: "상담" })).toBe(false);
  });

  it("rejects non-compliant campaign subjects before any Stibee request", async () => {
    await expect(updateStibeeEmailContent("123", "스포츠101 제안", "본문")).rejects.toThrow("[광고]");
  });
});
