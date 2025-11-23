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

// ====== 查單字可用主題（與 /today 主題一致）======
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
  "customer service"
];

const themesText = THEMES.map((t) => `- ${t}`).join("\n");

/**
 * 查單字：
 * 回傳：
 * {
 *   lineText: 給 LINE 顯示的文字（短格式）
 *   item: { theme, word, pos, zh, example, example_zh, cefr } | null
 * }
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();

  const prompt = `
你是一位友善的雙語英文老師，現在要協助使用者查單字「${word}」。

請務必嚴格依照以下格式輸出：

【第一行（給程式用）】
請只輸出一行，使用半形直線 | 分隔，格式 **必須完全如下**：

status | theme | word | pos | zh | example | example_zh | cefr

說明：
- status：REAL（正常單字）或 NOT_WORD（無效、打錯、罕見字）
- theme：請務必從下列主題中挑選一個（字串必須完全一致）：
${themesText}
- word：單字本身（小寫）
- pos：詞性（n. / v. / adj. / adv.）
- zh：最核心的繁體中文意思（只給一個）
- example：8–20 字英文例句
- example_zh：例句翻譯
- cefr：A1~C2

⚠ 若 status = NOT_WORD，其餘欄位可以留空。

【第二部分：給使用者看的內容（只有 REAL 時需要）】
請輸出以下固定格式，不得多加任何內容：

📚 Word: word
詞性：pos
中文：zh
CEFR：cefr
例句：
- example
→ example_zh

⚠ 禁止加任何額外的說明、補充、Markdown、符號。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const firstLine = lines[0] || "";
  const parts = firstLine.split("|").map((p) => p.trim());

  if (parts.length < 8) {
    console.warn("⚠ 查單字：第一行解析失敗");
    return {
      lineText: text,
      item: null
    };
  }

  const [statusRaw, themeRaw, wRaw, pos, zh, example, example_zh, cefrRaw] = parts;
  const status = (statusRaw || "").toUpperCase();

  // ========== ❌ NOT_WORD → 不寫入試算表 ==========
  if (status !== "REAL") {
    return {
      lineText:
        `看起來「${word}」不是常見的英文單字，\n` +
        `可能是打錯字或自創字喔！\n\n` +
        `可以再檢查看看拼字～`,
      item: null
    };
  }

  // ========== ✅ REAL → 整理成 item ==========
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";
  const w = wRaw || word;
  const cefr = (cefrRaw || "").toUpperCase();

  const item = {
    theme,
    word: w,
    pos,
    zh,
    example,
    example_zh,
    cefr
  };

  // ========== LINE 使用者看到的短格式 ==========
  const replyLines = [
    `📚 Word: ${item.word}`,
    `詞性：${item.pos}`,
    `中文：${item.zh}`,
    `CEFR：${item.cefr}`,
    "",
    "例句：",
    `- ${item.example}`,
    `→ ${item.example_zh}`
  ];

  const lineText = replyLines.join("\n");

  return { lineText, item };
}
