import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedAnalysisPromptTemplate = null;

function loadAnalysisPromptTemplate() {
  if (cachedAnalysisPromptTemplate) return cachedAnalysisPromptTemplate;
  const filePath = path.join(__dirname, "prompts", "analysis.md");
  cachedAnalysisPromptTemplate = readFileSync(filePath, "utf8");
  return cachedAnalysisPromptTemplate;
}
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

export class AiClientError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "AiClientError";
    this.status = status;
  }
}

function anonymizeStudentToken(token) {
  return createHash("sha256").update(String(token)).digest("hex").slice(0, 12);
}

function getReasoning(value) {
  const candidates = [value?.reasoning, value?.justification, value?.explanation, value?.text];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 1200);
  }
  return null;
}

function normalizeAnswer(question, value) {
  if (question.type === "multiple_choice") {
    const idx = Number(value?.choice);
    const labels = question.options?.choices || [];
    return {
      type: "multiple_choice",
      choiceIndex: Number.isInteger(idx) ? idx : null,
      choiceLabel: Number.isInteger(idx) && idx >= 0 && idx < labels.length ? labels[idx] : null,
      reasoning: getReasoning(value),
    };
  }
  if (question.type === "number_guess") {
    return {
      type: "number_guess",
      guess: Number.isFinite(value?.guess) ? Math.trunc(Number(value.guess)) : null,
      reasoning: getReasoning(value),
    };
  }
  if (question.type === "slider") {
    return {
      type: "slider",
      percentages: Array.isArray(value?.percentages) ? value.percentages : [],
      reasoning: getReasoning(value),
    };
  }
  if (question.type === "ranking") {
    return {
      type: "ranking",
      order: Array.isArray(value?.order) ? value.order : [],
      reasoning: getReasoning(value),
    };
  }
  return { type: "unknown", reasoning: getReasoning(value) };
}

export function buildAnalysisInput(question, responses) {
  return {
    question: {
      id: question.id,
      type: question.type,
      text: question.text,
      options: question.options,
    },
    responses: responses.map((row) => ({
      respondentId: anonymizeStudentToken(row.student_token),
      answer: normalizeAnswer(question, row.value || {}),
    })),
  };
}

export function buildPrompt(inputData, instruction = "") {
  const dataJson = JSON.stringify(inputData);
  const main = loadAnalysisPromptTemplate().replace(/\{\{DATA\}\}/g, dataJson);
  return `${main.trim()}\n\nDopl\u0148kov\u00fd pokyn od lektora:\n${instruction || "(bez doplnku)"}`;
}

export async function analyzeWithClaude(question, responses, instruction = "") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiClientError("AI anal\u00fdza nen\u00ed nakonfigurovan\u00e1 na serveru.", 503);
  }

  const inputData = buildAnalysisInput(question, responses);
  const prompt = buildPrompt(inputData, instruction);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1400,
        temperature: 0.2,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg =
        data?.error?.message ||
        (res.status === 429
          ? "AI je te\u010f p\u0159et\u00ed\u017een\u00e1, zkus to pros\u00edm za chv\u00edli."
          : "AI anal\u00fdza selhala.");
      throw new AiClientError(msg, res.status);
    }

    const summary = Array.isArray(data?.content)
      ? data.content
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n\n")
          .trim()
      : "";

    return {
      summary: summary || "AI vr\u00e1tila pr\u00e1zdn\u00fd v\u00fdsledek.",
      usage: data?.usage || null,
      model: data?.model || DEFAULT_MODEL,
      responseCount: inputData.responses.length,
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new AiClientError("AI anal\u00fdza vypr\u0161ela (timeout). Zkus to pros\u00edm znovu.", 504);
    }
    if (err instanceof AiClientError) throw err;
    throw new AiClientError("Nepoda\u0159ilo se zavolat AI slu\u017ebu.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
