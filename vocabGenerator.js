import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);
const DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
];

const configuredModels = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const modelCandidates = configuredModels.length > 0 ? configuredModels : DEFAULT_MODELS;

export function isGeminiLocationUnsupportedError(err) {
  const msg = String(err?.message || "");
  return msg.includes("User location is not supported for the API use");
}

function isModelNotFoundError(err) {
  const msg = String(err?.message || "");
  return msg.includes("is not found for API version") || msg.includes("[404 Not Found]");
}

function normalizeCefr(value) {
  const v = String(value || "").toUpperCase();
  return ["A1", "A2", "B1", "B2", "C1", "C2"].includes(v) ? v : "";
}

function buildPrompt({ theme, count, bannedWords }) {
  const bannedText = bannedWords.length
    ? `Do not use these words: ${bannedWords.slice(0, 2000).join(", ")}`
    : "Avoid repeating common textbook words.";

  return [
    "Generate TOEIC-friendly English vocabulary items for traditional Chinese learners.",
    `Theme: ${theme}`,
    `Count: ${count}`,
    bannedText,
    "Output only plain lines in this exact format:",
    "word | pos | zh | example | example_zh | cefr",
    "No numbering, no markdown, no extra text.",
    "CEFR must be one of A2, B1, B2.",
  ].join("\n");
}

function parseGeneratedText({ text, theme, count }) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) continue;

    const [word, pos, zh, example, example_zh, cefrRaw] = parts;
    if (!word) continue;

    items.push({
      theme,
      word,
      pos: pos || "",
      zh: zh || "",
      example: example || "",
      example_zh: example_zh || "",
      cefr: normalizeCefr(cefrRaw),
    });

    if (items.length >= count) break;
  }

  return items;
}

export async function generateVocab({ theme, count, bannedWords = [] }) {
  const prompt = buildPrompt({ theme, count, bannedWords });

  let lastErr = null;
  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent(prompt);
      const text = res.response.text().trim();
      const items = parseGeneratedText({ text, theme, count });
      if (items.length === 0) {
        throw new Error(`Gemini returned unparsable output (model=${modelName})`);
      }
      console.log(`[gemini] success model=${modelName}, items=${items.length}`);
      return items;
    } catch (err) {
      lastErr = err;
      if (isGeminiLocationUnsupportedError(err)) throw err;
      if (isModelNotFoundError(err)) {
        console.warn(`[gemini] model unsupported: ${modelName}, trying next`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("Gemini generation failed on all model candidates");
}
