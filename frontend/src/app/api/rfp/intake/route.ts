import { NextRequest, NextResponse } from "next/server";
import { AGENT_MODEL } from "@/lib/openrouter";
import { guardedOpenRouterChatJSON } from "@/lib/llmGuard";
import { RFP_QUESTIONS, FINAL_INTAKE_KEY, RFP_SECTIONS, SECTION_LABELS, getCategoryQuestionLabel, getFinalIntakeQuestionLabel } from "@/lib/rfp/config";

const REQUIRED_KEYS = RFP_QUESTIONS.map((question) => question.key);

const CATEGORY_VALUES = ["software", "manufacturing", "logistics", "construction", "other"] as const;
const MAX_INTAKE_MESSAGE_CHARS = 1000;

const QUESTION_LABELS: Record<string, string> = Object.fromEntries(
  RFP_QUESTIONS.map((question) => [question.key, question.label]),
);

function looksLikeGreeting(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 40) return false;
  return /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)([!,.?\s]+.*)?$/.test(normalized);
}

function normalizeAssistantText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\b(greeting received|follow[- ]?up|follow up)\b[:\s-]*/gi, "")
    .replace(/\b(i couldn't capture that|i could not capture that|i wasn't able to capture that)\b[:\s-]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface IntakeRequestBody {
  message?: string;
  answers?: Record<string, string>;
  currentQuestionKey?: string | null;
  mandatorySections?: string[];
}

interface IntakeResponse {
  extractedAnswers: Record<string, string>;
  nextQuestionKey: string | null;
  nextQuestion: string | null;
  readyForGeneration: boolean;
  summary: string;
  clarifyingQuestion?: string | null;
  chatReply?: string | null;
  missingRequired: string[];
}

function normalizeCategory(value: string): string {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return "";
  for (const option of CATEGORY_VALUES) {
    if (cleaned === option || cleaned.includes(option)) return option;
  }
  return "other";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function getSectionLabel(key: string): string {
  return SECTION_LABELS[key as keyof typeof SECTION_LABELS] || key;
}

function getNextRequiredKey(values: Record<string, string>): string | null {
  for (const key of REQUIRED_KEYS) {
    const current = normalizeText(values[key]);
    if (!current) return key;
  }
  return null;
}

function getNextMandatoryKey(values: Record<string, string>, mandatorySections: string[]): string | null {
  for (const key of mandatorySections) {
    if (key === FINAL_INTAKE_KEY) continue;
    if (!RFP_SECTIONS.includes(key as never)) continue;
    if (!normalizeText(values[key])) return key;
  }
  return null;
}

function getNextSupplementaryKey(values: Record<string, string>): string | null {
  if (!normalizeText(values[FINAL_INTAKE_KEY])) return FINAL_INTAKE_KEY;
  return null;
}

function getNextKeyAfter(currentKey: string, values: Record<string, string>, mandatorySections: string[]): string | null {
  const currentIdx = REQUIRED_KEYS.indexOf(currentKey);
  if (currentIdx < 0) return getNextRequiredKey(values);
  for (let i = currentIdx + 1; i < REQUIRED_KEYS.length; i += 1) {
    const key = REQUIRED_KEYS[i];
    if (!normalizeText(values[key])) return key;
  }
  const mandatoryKey = getNextMandatoryKey(values, mandatorySections);
  if (mandatoryKey) return mandatoryKey;

  // After all REQUIRED_KEYS and mandatory org sections are answered, check for supplementary key (extra details)
  return getNextSupplementaryKey(values);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as IntakeRequestBody;
  const message = (body.message || "").trim();
  const answers = body.answers || {};
  const requestedKey = typeof body.currentQuestionKey === "string" ? body.currentQuestionKey : null;
  const mandatorySections = Array.isArray(body.mandatorySections)
    ? body.mandatorySections.map(normalizeSectionKey).filter((key) => RFP_SECTIONS.includes(key as never))
    : [];

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  if (message.length > MAX_INTAKE_MESSAGE_CHARS) {
    const defaultCurrentKey = getNextRequiredKey(answers) || getNextMandatoryKey(answers, mandatorySections) || getNextSupplementaryKey(answers);
    const nextQuestion = defaultCurrentKey
      ? defaultCurrentKey === FINAL_INTAKE_KEY
        ? getFinalIntakeQuestionLabel()
        : mandatorySections.includes(defaultCurrentKey)
          ? getSectionLabel(defaultCurrentKey)
        : getCategoryQuestionLabel(answers.category, defaultCurrentKey, QUESTION_LABELS[defaultCurrentKey] || defaultCurrentKey)
      : null;

    return NextResponse.json({
      extractedAnswers: {},
      nextQuestionKey: defaultCurrentKey,
      nextQuestion,
      readyForGeneration: false,
      summary: "",
      clarifyingQuestion: null,
      chatReply: `Please keep it under ${MAX_INTAKE_MESSAGE_CHARS} characters. A shorter version will work better here.`,
      missingRequired: [],
    } satisfies IntakeResponse);
  }

  try {
    const mergedBase = { ...answers };
    if (mergedBase.organization_name) mergedBase.organization_name = normalizeText(mergedBase.organization_name);
    if (mergedBase.project_title) mergedBase.project_title = normalizeText(mergedBase.project_title);
    if (mergedBase.category) mergedBase.category = normalizeCategory(mergedBase.category);

    const defaultCurrentKey = getNextRequiredKey(mergedBase) || getNextMandatoryKey(mergedBase, mandatorySections) || getNextSupplementaryKey(mergedBase);
    const currentQuestionIsValid = !!requestedKey && (REQUIRED_KEYS.includes(requestedKey) || mandatorySections.includes(requestedKey) || requestedKey === FINAL_INTAKE_KEY);
    const currentQuestionKey = currentQuestionIsValid ? requestedKey : defaultCurrentKey;
    const currentQuestionLabel = currentQuestionKey
      ? currentQuestionKey === FINAL_INTAKE_KEY
        ? getFinalIntakeQuestionLabel()
        : mandatorySections.includes(currentQuestionKey)
          ? getSectionLabel(currentQuestionKey)
        : getCategoryQuestionLabel(mergedBase.category, currentQuestionKey, QUESTION_LABELS[currentQuestionKey] || currentQuestionKey)
      : "";

    const normalizedExtracted: Record<string, string> = {};
    let clarifyingQuestion: string | null = null;
    let nextQuestionKey: string | null = currentQuestionKey;
    let summary = "";

    if (currentQuestionKey) {
      const extractPrompt = `You are a warm, natural RFP intake assistant.

    Behavior rules:
    - Talk like a real person, not a robot.
    - Ask one topic at a time.
    - Keep responses short and conversational, usually under 3 sentences.
    - If the user answers a different question, goes off topic, or writes something unrelated, gently guide them back.
    - If the answer is vague or too short, ask one natural follow-up to get more detail.
    - If the user seems confused, give a simple example of what would help.
    - Do not use robotic phrases like "I couldn't capture that" or "Please answer this directly." 
    - Never write phrases like "Greeting received" or "Follow-up".
    - If the message is only a greeting, answer with a natural greeting and continue to the current question.
    - When you are satisfied with the answer for the current topic, smoothly move to the next topic.

    You are analyzing one reply in a conversational RFP intake.

Current question key: ${currentQuestionKey}
Current question label: ${currentQuestionLabel}

Return JSON only in this exact shape:
{
  "value": <string|null>,
  "summary": <string>
}

Output rules:
- "value" must be a short, direct answer, ideally under 12 words.
- "summary" must be a single short sentence, ideally under 20 words.
- Do not include any extra keys, markdown, code fences, or explanations.

Rules:
- Read the latest user message in context and interpret it like a procurement assistant.
- Extract the best concise answer for the current question.
- If the user answers indirectly, infer the answer if it is still clearly usable.
  - If the message is only a question, greeting, or unrelated note, set value to null and make summary a short natural follow-up that gently brings the user back to the current topic.
  - If the answer is vague or too short, make summary a single natural follow-up that asks for one more detail.
  - If the user is confused, make summary include a brief example of the kind of answer that would help.
- Make summary one sentence that reflects what you understood from the message.
- Do not invent facts.`;

      const extracted = await guardedOpenRouterChatJSON<any>(
        {
          model: AGENT_MODEL.INTAKE_EXTRACTION,
          messages: [
            { role: "system", content: extractPrompt },
            { role: "user", content: `Current known answers: ${JSON.stringify(mergedBase)}\n\nLatest user message: ${message}` },
          ],
          temperature: 0.1,
          max_tokens: 256,
          response_format: { type: "json_object" },
        }
      );

      const rawValue = extracted && typeof extracted === "object" ? extracted.value : null;
      const rawSummary = extracted && typeof extracted === "object" ? extracted.summary : "";
      const normalized = normalizeText(rawValue);
      const normalizedSummary = normalizeAssistantText(normalizeText(rawSummary));
      if (normalized) {
        normalizedExtracted[currentQuestionKey] = currentQuestionKey === "category" ? normalizeCategory(normalized) : normalized;
        summary = normalizedSummary;
      } else {
        clarifyingQuestion = normalizedSummary || `Could you tell me ${currentQuestionLabel.toLowerCase()}?`;
      }
    }

    const merged = { ...mergedBase, ...normalizedExtracted };
    if (merged.organization_name) merged.organization_name = normalizeText(merged.organization_name);
    if (merged.project_title) merged.project_title = normalizeText(merged.project_title);
    if (merged.category) merged.category = normalizeCategory(merged.category);

    const missingRequired = REQUIRED_KEYS.filter((key) => !normalizeText(merged[key]));
    for (const key of mandatorySections) {
      if (!normalizeText(merged[key])) missingRequired.push(key);
    }
    if (!normalizeText(merged[FINAL_INTAKE_KEY])) {
      missingRequired.push(FINAL_INTAKE_KEY);
    }
    const answeredCurrent = !!(currentQuestionKey && normalizeText(merged[currentQuestionKey]));
    if (currentQuestionKey && currentQuestionKey !== FINAL_INTAKE_KEY) {
      nextQuestionKey = answeredCurrent ? getNextKeyAfter(currentQuestionKey, merged, mandatorySections) : currentQuestionKey;
    } else {
      nextQuestionKey = getNextRequiredKey(merged) || getNextMandatoryKey(merged, mandatorySections) || getNextSupplementaryKey(merged);
    }

    const nextQuestion = nextQuestionKey
      ? nextQuestionKey === FINAL_INTAKE_KEY
        ? getFinalIntakeQuestionLabel()
        : mandatorySections.includes(nextQuestionKey)
          ? getSectionLabel(nextQuestionKey)
        : getCategoryQuestionLabel(merged.category, nextQuestionKey, QUESTION_LABELS[nextQuestionKey] || nextQuestionKey)
      : null;
    const readyForGeneration = missingRequired.length === 0;

    let chatReply: string | null = null;
    if (readyForGeneration) {
      chatReply = "Great. I have all 19 answers. Click **Generate RFP** to continue.";
    } else if (nextQuestion) {
      if (answeredCurrent) {
        const leadIn = normalizeAssistantText(summary) || "Thanks, that helps.";
        chatReply = `${leadIn} ${nextQuestion}`.trim();
      } else {
        chatReply = clarifyingQuestion || (looksLikeGreeting(message) ? `Hi there. ${nextQuestion}` : nextQuestion);
      }
    }

    if (!summary) {
      summary = answeredCurrent
        ? `Captured 1 field: ${currentQuestionKey}.`
        : "No field captured from this message.";
    }

    const payload: IntakeResponse = {
      extractedAnswers: {
        ...normalizedExtracted,
        category: merged.category || normalizedExtracted.category || "",
      },
      nextQuestionKey,
      nextQuestion,
      readyForGeneration,
      summary,
      missingRequired,
      clarifyingQuestion: null,
      chatReply,
    };

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: messageText || "Failed to extract RFP intake fields" },
      { status: 500 },
    );
  }
}