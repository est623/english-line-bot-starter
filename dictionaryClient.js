// dictionaryClient.js

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 填入金鑰");
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// 和 /today 共用的主題列表
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
 * 查單字：
 * 回傳：
 * {
 *   lineText: 要回給 LINE 的文字（固定短格式）
 *   item: { theme, word, pos, zh, example, example_zh, cefr } | null
 * }
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();

  const prompt = `
你是一位友善的雙語英文老師，現在要協助使用者查單字「${word}」。

【輸出要求】

第一行：只輸出一行，使用半形直線 | 分隔，格式必須完全如下：
status | theme | word | pos | zh | example | example_zh | cefr

說明：
- status：REAL（正常單字）或 NOT_WORD（亂碼、打錯、罕見不當作學習單字）
- theme：請務必從下列主題中挑選一個（字串必須完全一致）：
${themesText}
- word：單字本身（小寫）
- pos：詞性（n. / v. / adj. / adv.）
- zh：最核心的繁體中文解釋（只給一個）
- example：8–20 字英文例句
- example_zh：例句的繁體中文翻譯
- cefr：A1~C2

如果 status = NOT_WORD，其餘欄位可以留空。

第一行之後，你可以輸出說明，但這些內容不會被程式解析。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 🔍 尋找「真正的資料行」：包含 | 且至少切出 8 欄
  const dataLine =
    lines.find((l) => l.includes("|") && l.split("|").length >= 8) || "";

  if (!dataLine) {
    console.warn("⚠ 查單字：找不到包含 8 欄以上的資料行");
    return {
      lineText:
        "剛剛在查這個單字時模型回覆有點怪怪的，" +
        "可以先稍後再試一次，或換一個單字看看～",
      item: null,
    };
  }

  const parts = dataLine.split("|").map((p) => p.trim());
  if (parts.length < 8) {
    console.warn("⚠ 查單字：資料行欄位不足 8 個");
    return {
      lineText:
        "剛剛在查這個單字時模型回覆有點怪怪的，" +
        "可以先稍後再試一次，或換一個單字看看～",
      item: null,
    };
  }

  const [statusRaw, themeRaw, wRaw, pos, zh, example, example_zh, cefrRaw] =
    parts;

  const status = (statusRaw || "").toUpperCase();

  // ❌ 不是正常單字
  if (status !== "REAL") {
    return {
      lineText:
        `看起來「${word}」不是常見的英文單字，\n` +
        `可能是打錯字或自創字喔！\n\n` +
        `可以再檢查看看拼字～`,
      item: null,
    };
  }

  // ✅ 正常單字 → 整理 item
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";
  const w = wRaw || word;
  const cefr = (cefrRaw || "").toUpperCase();

  const item = {
    theme,
    word: w,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  // 給 LINE 的簡潔卡片（不再用模型第二部分，完全自己排版）
  const replyLines = [
    `📚 Word: ${item.word}`,
    item.pos ? `詞性：${item.pos}` : "詞性：",
    item.zh ? `中文：${item.zh}` : "中文：",
    item.cefr ? `CEFR：${item.cefr}` : "CEFR：",
    "",
    "例句：",
    item.example ? `- ${item.example}` : "- （例句取得失敗 QQ）",
    item.example_zh ? `→ ${item.example_zh}` : "→ （翻譯取得失敗 QQ）",
  ];

  const lineText = replyLines.join("\n");

  return { lineText, item };
}
