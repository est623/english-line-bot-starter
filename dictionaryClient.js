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

// 跟 /today 一樣的主題清單
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

/**
 * 查單字：
 * 回傳：
 * {
 *   lineText: "要回給 LINE 的文字",
 *   item: { theme, word, pos, zh, example, example_zh, cefr } | null
 * }
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();

  const themesText = THEMES.map((t) => `- ${t}`).join("\n");

  const prompt = `
你是一位友善的雙語英文老師，現在要幫學習者解釋英文單字「${word}」。

請務必照下面格式輸出：

第 1 行（給程式用，只能有一行）：
theme | word | pos | zh | example | example_zh | cefr

說明：
- theme：從下列主題中選一個最適合的（字串必須完全一致）：
${themesText}
- word：單字本身
- pos：詞性（例如 n. / v. / adj. / adv.）
- zh：繁體中文解釋
- example：8–20 字英文例句
- example_zh：例句的中文翻譯
- cefr：從 A1~C2 中選一個（例如 A2 / B1）

第 2 行之後，你可以用自然語言補充說明，但程式只會讀取「第一行」。
請不要在第一行前面加任何問候語或說明文字。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  // 逐行切開，找「第一個有 | 的那一行」當資料行，比較保險
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const dataLine = lines.find((l) => l.includes("|")) || "";
  if (!dataLine) {
    console.warn("⚠ 查單字：找不到含有 '|' 的資料行，實際回應：", text);
    const fallbackText =
      `😵 我沒辦法好好解析「${word}」這個字的解釋，` +
      `可以先檢查一下拼字，再試一次看看嗎？`;
    return { lineText: fallbackText, item: null };
  }

  // 解析：theme | word | pos | zh | example | example_zh | cefr
  const parts = dataLine.split("|").map((p) => p.trim());
  if (parts.length < 7) {
    console.warn("⚠ 查單字：資料行欄位不足，dataLine =", dataLine);
    const fallbackText =
      `😵 我沒辦法好好解析「${word}」這個字的解釋，` +
      `可以先檢查一下拼字，再試一次看看嗎？`;
    return { lineText: fallbackText, item: null };
  }

  const [themeRaw, w, pos, zh, example, example_zh, cefrRaw] = parts;

  // 主題如果不在清單裡，就 fallback 成 "lookup"
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";
  const cefr = (cefrRaw || "").toUpperCase();

  const item = {
    theme,
    word: w || word,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  // 給 LINE 用的簡潔卡片：不再附上 Gemini 自由發揮的一大段說明
  const replyLines = [
    `📚 Word: ${item.word}`,
    item.pos ? `詞性：${item.pos}` : "",
    item.zh ? `中文：${item.zh}` : "",
    item.cefr ? `CEFR：${item.cefr}` : "",
    "",
    "例句：",
    item.example ? `- ${item.example}` : "",
    item.example_zh ? `→ ${item.example_zh}` : "",
  ];

  const lineText = replyLines.filter((l) => l !== "").join("\n");

  return { lineText, item };
}
