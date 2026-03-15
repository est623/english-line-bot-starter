import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildLookupWordText } from "./messageFormatters.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY. Please set it in .env");
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// Shared theme list with /today
const THEMES = [
  "daily life",
  "travel",
  "school",
  "work",
  "health",
  "small talk",
  "food",
  "email",
  "presentation",
  "customer service",
];

const themesText = THEMES.map((t) => `- ${t}`).join("\n");

/**
 * Lookup a single English word via Gemini.
 *
 * @returns {Promise<{lineText: string, item: {theme: string, word: string, pos: string, zh: string, example: string, example_zh: string, cefr: string} | null}>}
 */
export async function lookupWord(rawWord) {
  const word = String(rawWord || "").trim().toLowerCase();

  const prompt = `
你是一個英文學習助理。請判斷使用者輸入是否為「真實英文單字」，並只用一行 pipe 分隔格式回覆。

輸入單字：${word}

請輸出格式（固定 8 欄）：
status | theme | word | pos | zh | example | example_zh | cefr

規則：
- status: REAL 或 NOT_WORD
- theme: 請從以下主題中選一個
${themesText}
- word: 單字原型
- pos: 例如 n. / v. / adj. / adv.
- zh: 繁體中文意思
- example: 英文例句（1 句）
- example_zh: 例句中文翻譯
- cefr: A1~C2

若 status = NOT_WORD，後面欄位仍請保留 7 個欄位（可留空），總共 8 欄。
只輸出資料列，不要額外說明。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("Gemini lookup response:\n", text);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const dataLine = lines.find((l) => l.includes("|") && l.split("|").length >= 8) || "";
  if (!dataLine) {
    console.warn("Lookup parse failed: no data line with 8 fields.");
    return {
      lineText: "目前無法解析查詢結果，請稍後再試一次。",
      item: null,
    };
  }

  const parts = dataLine.split("|").map((p) => p.trim());
  if (parts.length < 8) {
    console.warn("Lookup parse failed: field count < 8.");
    return {
      lineText: "目前無法解析查詢結果，請稍後再試一次。",
      item: null,
    };
  }

  const [statusRaw, themeRaw, wRaw, pos, zh, example, example_zh, cefrRaw] = parts;
  const status = String(statusRaw || "").toUpperCase();

  if (status !== "REAL") {
    return {
      lineText: `「${word}」看起來不是有效英文單字，請再確認拼字後重試。`,
      item: null,
    };
  }

  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";
  const w = wRaw || word;
  const cefr = String(cefrRaw || "").toUpperCase();

  const item = {
    theme,
    word: w,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  const lineText = buildLookupWordText(item);
  return { lineText, item };
}
