import { TargetOrganization } from "../drizzle/schema";

const NEIS_URL = "https://open.neis.go.kr/hub/schoolInfo";
const STIBEE_BASE = "https://api.stibee.com/v2";

type TargetInput = Omit<TargetOrganization, "id" | "createdAt" | "updatedAt" | "lastSentAt">;

function mockTargets(type: "school" | "company"): TargetInput[] {
  return Array.from({ length: 50 }, (_, index) => {
    const n = index + 1;
    const isSchool = type === "school";
    return {
      organizationType: isSchool ? (n % 3 === 0 ? "high" : n % 2 === 0 ? "middle" : "elementary") : "sports_company",
      industry: isSchool ? "학교" : n % 2 ? "유소년 스포츠" : "스포츠테크",
      organizationName: isSchool ? `스포츠101 테스트 학교 ${n}` : `스포츠101 테스트 기업 ${n}`,
      regionProvince: ["서울", "경기", "부산", "대전", "광주"][n % 5],
      regionDistrict: `${n}구`,
      contactEmail: `${type}${n}@example.invalid`,
      contactPhone: `02-0000-${String(n).padStart(4, "0")}`,
      contactName: null,
      source: "mock",
      unsubscribed: 0,
    };
  });
}

function normalizeSchool(row: any): TargetInput {
  const schoolType = String(row.SCHUL_KND_SC_NM ?? row.SCHUL_KND_SC ?? "");
  return {
    organizationType: schoolType.includes("초") ? "elementary" : schoolType.includes("고") ? "high" : "middle",
    industry: "학교",
    organizationName: String(row.SCHUL_NM ?? "학교명 미상"),
    regionProvince: String(row.LCTN_SC_NM ?? row.ATPT_OFCDC_SC_NM ?? "미상"),
    regionDistrict: row.LCTN_SC_NM ? String(row.LCTN_SC_NM) : null,
    contactEmail: String(row.ORG_RDNMA ?? row.HMPG_ADRES ?? "").includes("@") ? String(row.ORG_RDNMA) : "",
    contactPhone: row.ORG_TELNO ? String(row.ORG_TELNO) : null,
    contactName: null,
    source: "NEIS",
    unsubscribed: 0,
  };
}

export async function collectSchoolTargets(): Promise<{ rows: TargetInput[]; source: "NEIS" | "mock"; warning?: string }> {
  const key = process.env.NEIS_API_KEY;
  if (!key) return { rows: mockTargets("school"), source: "mock", warning: "NEIS_API_KEY가 없어 Mock 학교 데이터 50건을 사용했습니다." };
  try {
    const url = new URL(NEIS_URL);
    url.searchParams.set("KEY", key); url.searchParams.set("Type", "json"); url.searchParams.set("pIndex", "1"); url.searchParams.set("pSize", "1000");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NEIS ${response.status}`);
    const payload = await response.json();
    const rows = payload.schoolInfo?.[1]?.row ?? [];
    if (!rows.length) throw new Error("NEIS 응답에 학교 데이터가 없습니다.");
    return { rows: rows.map(normalizeSchool).filter((row: TargetInput) => row.organizationName && row.contactEmail), source: "NEIS" };
  } catch (error) {
    return { rows: mockTargets("school"), source: "mock", warning: `NEIS 수집 실패로 Mock 학교 데이터 50건을 사용했습니다: ${String(error)}` };
  }
}

export async function collectSportsCompanyTargets(): Promise<{ rows: TargetInput[]; source: "data.go.kr" | "mock"; warning?: string }> {
  const key = process.env.DATA_GO_KR_API_KEY;
  const endpoint = process.env.DATA_GO_KR_SPORTS_API_URL;
  if (!key || !endpoint) return { rows: mockTargets("company"), source: "mock", warning: "DATA_GO_KR_API_KEY 또는 DATA_GO_KR_SPORTS_API_URL이 없어 Mock 스포츠 기업 데이터 50건을 사용했습니다." };
  try {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", key); url.searchParams.set("pageNo", "1"); url.searchParams.set("numOfRows", "1000"); url.searchParams.set("type", "json");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`data.go.kr ${response.status}`);
    const payload = await response.json();
    const rows = payload.response?.body?.items?.item ?? payload.items ?? [];
    const normalized = rows.map((row: any): TargetInput => ({ organizationType: "sports_company", industry: String(row.indutyNm ?? row.industry ?? "스포츠산업"), organizationName: String(row.bizesNm ?? row.companyName ?? "기업명 미상"), regionProvince: String(row.ctprvnNm ?? row.region ?? "미상"), regionDistrict: row.signguNm ? String(row.signguNm) : null, contactEmail: String(row.email ?? row.emailAddr ?? ""), contactPhone: row.telno ? String(row.telno) : null, contactName: null, source: "data.go.kr", unsubscribed: 0 })).filter((row: TargetInput) => row.contactEmail.includes("@"));
    if (!normalized.length) throw new Error("스포츠 기업 이메일 데이터가 없습니다.");
    return { rows: normalized, source: "data.go.kr" };
  } catch (error) {
    return { rows: mockTargets("company"), source: "mock", warning: `공공데이터 수집 실패로 Mock 스포츠 기업 데이터 50건을 사용했습니다: ${String(error)}` };
  }
}

const segmentProfiles: Record<string, { role: string; pain: string; value: string; proof: string; cta: string }> = {
  elementary: { role: "초등학교 체육 담당 교사", pain: "학생별 체력 차이와 수업 참여도 관리", value: "안전하고 재미있는 기초 체력·집중력 향상 프로그램", proof: "학교 현장에서 바로 적용 가능한 단계형 운영", cta: "학교 맞춤 제안서 요청하기" },
  middle: { role: "중학교 체육부장 또는 체육교사", pain: "제한된 수업 시간 안에서 학생 참여와 운동 효과를 함께 확보", value: "측정 가능한 훈련 루틴과 학생 참여를 높이는 스포츠 솔루션", proof: "교사 업무 부담을 늘리지 않는 도입 방식", cta: "중학교 맞춤 상담 신청하기" },
  high: { role: "고등학교 체육부장 또는 체육교사", pain: "입시·훈련 일정 속 경기력 관리와 학생 컨디션 편차", value: "선수·학생의 집중력과 퍼포먼스를 체계적으로 관리하는 프로그램", proof: "훈련 전후 루틴에 연결할 수 있는 운영 모델", cta: "고교 퍼포먼스 제안 받기" },
  sports_company: { role: "스포츠 기업 대표 또는 사업개발 책임자", pain: "차별화된 상품 경쟁력과 신규 B2B 판로 확보", value: "스포츠101 플랫폼과 연결된 공동 캠페인·제휴 기회", proof: "타깃 고객군에 맞춘 공동 제안 및 실무 협업", cta: "제휴 미팅 제안하기" },
};

function fallbackDraft(input: { audienceType: string; organizationName?: string; offer?: string }) {
  const profile = segmentProfiles[input.audienceType] ?? segmentProfiles.sports_company;
  return { subject: `[광고] ${profile.role}을 위한 스포츠101 제안`, preheader: `${profile.pain}을 줄이는 맞춤형 솔루션을 확인하세요.`, body: `안녕하세요, ${input.organizationName ?? "담당자"} ${profile.role}님.\n\n${profile.pain}으로 고민하고 계신가요? 스포츠101은 ${profile.value}을 제안드립니다.\n\n${profile.proof}을 바탕으로 ${input.offer ?? "맞춤형 상담"}을 안내해 드리겠습니다.\n\n부담 없이 현재 상황을 알려주시면 적합한 다음 단계를 함께 설계하겠습니다.`, cta: profile.cta, complianceNotes: ["제목에 [광고] 표기", "시스템 footer에 무료 수신거부 링크 삽입"], source: "fallback" as const };
}

const forbiddenPhrases = ["100%", "무조건", "확실한 성과", "대박", "최고의 결과", "성과 보장", "절대"];

export function validateGeminiDraft(value: any): value is { subject: string; preheader: string; body: string; cta: string; complianceNotes: string[] } {
  if (!value || typeof value.subject !== "string" || typeof value.preheader !== "string" || typeof value.body !== "string" || typeof value.cta !== "string" || !Array.isArray(value.complianceNotes)) return false;
  const text = `${value.subject} ${value.preheader} ${value.body} ${value.cta}`;
  return value.subject.includes("[광고]") && value.preheader.length <= 80 && value.body.trim().length >= 20 && value.cta.trim().length > 0 && !forbiddenPhrases.some(phrase => text.includes(phrase));
}

export async function generateGeminiDraft(input: { audienceType: string; organizationName?: string; offer?: string; campaignGoal?: string }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackDraft(input);
  const profile = segmentProfiles[input.audienceType] ?? segmentProfiles.sports_company;
  const prompt = `당신은 스포츠101의 10년 차 B2B CRM 카피라이터입니다. 아래 조건으로 한국어 이메일 초안을 작성하세요.\n\n[수신자] ${profile.role}\n[기관명] ${input.organizationName ?? "기관명 미상"}\n[핵심 페인포인트] ${profile.pain}\n[제안 가치] ${profile.value}\n[신뢰 근거] ${profile.proof}\n[캠페인 목적] ${input.campaignGoal ?? "첫 상담 전환"}\n[제공 혜택] ${input.offer ?? "맞춤 상담"}\n\n작성 규칙:\n1. 제목은 28자 이내이며 맨 앞에 반드시 [광고]를 넣습니다. 과장·공포·성과 보장 표현은 금지합니다.\n2. 프리헤더는 45자 이내로 제목을 보완하고 구체적인 이익을 제시합니다.\n3. 본문은 5~7개의 짧은 문단으로 작성하고, 한 문단은 2문장을 넘기지 않습니다. 전문적이되 스포츠 현장 동료에게 말하듯 자연스럽게 씁니다.\n4. 수신자의 역할과 실제 업무 맥락을 첫 두 문단 안에 반영합니다. 기능 나열보다 문제-해결-다음 행동 순서로 씁니다.\n5. 확인되지 않은 고객사·선수·국가대표·수치·성과·후기·인증을 만들지 않습니다.\n6. 본문에는 수신거부 링크를 직접 만들지 말고 시스템 footer가 삽입하도록 둡니다.\n7. CTA는 부담이 낮은 상담·제안서 확인 행동으로 1개만 제안합니다.\n\n반드시 JSON만 반환하세요. 키는 subject, preheader, body, cta, complianceNotes입니다. complianceNotes에는 광고 표기와 수신거부 footer 삽입 필요 여부를 배열로 적습니다.`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { subject: { type: "STRING" }, preheader: { type: "STRING" }, body: { type: "STRING" }, cta: { type: "STRING" }, complianceNotes: { type: "ARRAY", items: { type: "STRING" } } }, required: ["subject", "preheader", "body", "cta", "complianceNotes"] } } }) });
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text.replace(/^```json\\s*|\\s*```$/g, ""));
    if (!validateGeminiDraft(parsed)) return fallbackDraft(input);
    return { ...parsed, source: "gemini" as const };
  } catch { return fallbackDraft(input); }
}

async function stibeeRequest(path: string, init: RequestInit = {}) {
  const key = process.env.STIBEE_API_KEY;
  if (!key) throw new Error("STIBEE_API_KEY가 설정되지 않았습니다.");
  const response = await fetch(`${STIBEE_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", AccessToken: key, ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Stibee ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function syncStibeeSubscribers(listId: string, rows: Array<{ email: string; name?: string; organizationName?: string }>) {
  if (!listId) throw new Error("Stibee 주소록 ID가 필요합니다.");
  const subscribers = rows.filter(row => row.email && !row.email.endsWith(".invalid")).map(row => ({ email: row.email, name: row.name ?? row.organizationName ?? "담당자" }));
  if (!subscribers.length) return { added: 0, skipped: rows.length };
  const result = await stibeeRequest(`/lists/${encodeURIComponent(listId)}/subscribers/batch`, { method: "POST", body: JSON.stringify({ subscribers }) });
  return { added: subscribers.length, skipped: rows.length - subscribers.length, result };
}

function buildCompliantHtml(body: string) {
  if (!body.trim()) throw new Error("이메일 본문이 비어 있습니다.");
  return `<div>${body.replace(/\n/g, "<br />")}</div><hr /><p style="font-size:12px;color:#777">본 메일은 정보통신망법에 따른 광고성 정보입니다.</p><p style="font-size:12px;color:#777"><a href="{{unsubscribe}}">무료 수신거부</a></p>`;
}

export async function updateStibeeEmailContent(emailId: string, subject: string, body: string) {
  if (!emailId) throw new Error("Stibee 이메일 ID가 필요합니다.");
  if (!subject.includes("[광고]")) throw new Error("광고성 이메일 제목에는 [광고] 표기가 필요합니다.");
  const html = buildCompliantHtml(body);
  return stibeeRequest(`/emails/${encodeURIComponent(emailId)}`, { method: "PUT", body: JSON.stringify({ subject, content: { html } }) });
}

export async function sendStibeeEmail(emailId: string, subject: string, body: string) {
  await updateStibeeEmailContent(emailId, subject, body);
  return stibeeRequest(`/emails/${encodeURIComponent(emailId)}/send`, { method: "POST", body: JSON.stringify({}) });
}
