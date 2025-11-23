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

// 跟 /today 一樣的一組主題
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

const themesText = THEMES.map(t => `- ${t}`).join("\n");

/**
 * 查單字：
 * 回傳：
 * {
 *   lineText: "要回給 LINE 的文字",
 *   item: { theme, word, pos, zh, example, example_zh, cefr }
 * }
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();

  const prompt = `
你是一位友善的雙語英文老師，幫學習者解釋單字「${word}」。

請用「兩個區塊」輸出：

【第一部分：一行資料，給程式用】
- 僅一行，格式如下（用半形直線 | 分隔）：
  theme | word | pos | zh | example | example_zh | cefr
- 說明：
  - theme：從下列主題列表中挑選其一（字串需完全一致）：
${themesText}
  - word：單字本身
  - pos：詞性，n. / v. / adj. / adv. 等
  - zh：繁體中文解釋
  - example：8–20 字英文例句
  - example_zh：例句的翻譯
  - cefr：A1~C2 之間選一個

【第二部分：給使用者看的詳細說明】
- 詞性：
- 中文：
- 英文解釋（簡短）：
- 同義字：
- 例句：
→ 中文翻譯：

⚠ 重點：
- 第一行一定要是「資料行」，且一定要有 7 個欄位。
- 第二部分開始排版自由。
  `.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text.split("\n").map(l => l.trim());
  const firstLine = lines.find(l => l.length > 0) || "";
  const restText = lines.slice(lines.indexOf(firstLine) + 1).join("\n").trim();

  // 解析第一行：theme | word | pos | zh | example | example_zh | cefr
  const parts = firstLine.split("|").map(p => p.trim());
  if (parts.length < 7) {
    console.warn("⚠ 查單字：無法解析第一行，回傳原始文字");
    return {
      lineText: text,
      item: null
    };
  }

  const [themeRaw, w, pos, zh, example, example_zh, cefrRaw] = parts;
  const cefr = (cefrRaw || "").toUpperCase();

  // 保護：AI 亂給主題時 fallback
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";

  // ✅ 唯一的一個 item（不要再宣告第二次了）
  const item = {
    theme,                 // 這裡就已經是「自動歸類主題」
    word: w || word,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || ""
  };

  // 給 LINE 的回覆文字
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

  // 把 Gemini 第二部分的說明接在後面（有就加，沒有就算了）
  if (restText) {
    replyLines.push("", restText);
  }

  const lineText = replyLines
    .filter(l => l !== "")
    .join("\n");

  return { lineText, item };
}