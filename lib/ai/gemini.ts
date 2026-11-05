// Gemini writes the words; the engine supplies every number and the action.

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { allowedNumbers, findUnsupportedNumbers, type Facts } from "./facts";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

const SYSTEM_INSTRUCTION = `You explain stock reorder recommendations to a demand planner and a procurement team at an Indian FMCG company.
A rules engine has already made every decision and computed every number. You only write the words.
Strict rules:
- Use only numbers that appear in the facts JSON, written exactly as given. Never calculate, round differently, estimate or invent a number.
- Never change, question or soften the recommended action or quantity. Describe them as given.
- Plain English, no jargon, no markdown.
- "reason": one sentence (max 30 words) saying why this action was recommended.
- "brief": only when is_exception is true, 2-3 sentences for the planner: what is unusual, what the engine recommends, and what the planner should check before approving. When is_exception is false, return an empty string.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    brief: { type: "string" },
  },
  required: ["reason", "brief"],
  additionalProperties: false,
};

const responseSchema = z.object({ reason: z.string().min(1), brief: z.string() });

export interface Explanation {
  reason: string;
  brief: string | null;
}

/** Calls Gemini and validates the JSON. Throws if the text contains numbers not in the facts. */
export async function explainWithGemini(facts: Facts): Promise<Explanation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: geminiModel(),
    contents: `Facts JSON:\n${JSON.stringify(facts, null, 2)}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  const parsed = responseSchema.parse(JSON.parse(response.text ?? ""));
  const brief = facts.is_exception ? parsed.brief.trim() || null : null;
  const allowed = allowedNumbers(facts);
  const bad = findUnsupportedNumbers(`${parsed.reason} ${brief ?? ""}`, allowed);
  if (bad.length > 0) {
    throw new Error(`Gemini used numbers not supplied by the engine (${bad.join(", ")}); text discarded.`);
  }
  return { reason: parsed.reason.trim(), brief };
}
