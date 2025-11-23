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
  word | pos | zh | example | example_zh | cefr
- 說明：
  - word：單字本身
  - pos：詞性，n. / v. / adj. / adv. 其中一種（或兩種用逗號分隔也可以）
  - zh：自然的繁體中文解釋即可
  - example：8–20 字自然英文例句
  - example_zh：例句的繁體中文翻譯
  - cefr：請在 A1~C2 中選一個最接近的等級（例如 A2 / B1）

【第二部分：給使用者看的詳細說明】
- 從下一行開始，你可以自由用多行說明，但請盡量維持下面結構：
  詞性：
  中文：
  英文解釋（簡短一點）：
  同義字：
  例句：
  → 中文翻譯：

⚠ 重點：
- 第一行一定要是「資料行」，中間用 | 分隔。
- 第二部分開始可以排版漂亮一點，但不要再出現 JSON。
  `.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text.split("\n").map(l => l.trim());
  const firstLine = lines.find(l => l.length > 0) || "";
  const restText = lines.slice(lines.indexOf(firstLine) + 1).join("\n").trim();

  // 解析第一行：word | pos | zh | example | example_zh | cefr
  const parts = firstLine.split("|").map(p => p.trim());
  if (parts.length < 5) {
    console.warn("⚠ 查單字：無法解析第一行，回傳原始文字");
    return {
      lineText: text,   // 退而求其次，直接把整段回給 LINE
      item: null
    };
  }

  const [w, pos, zh, example, example_zh, cefrRaw] = parts;
  const cefr = (cefrRaw || "").toUpperCase();

  // 統一成跟 /today 一樣的欄位
  const item = {
    theme: "lookup",     // 也可以改成 "查字"
    word: w || word,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || ""
  };

  // 給 LINE 的回覆文字（你可以之後再微調排版）
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

  // 把下面 Gemini 自由發揮的內容接在後面（選擇性）
  if (restText) {
    replyLines.push("", restText);
  }

  const lineText = replyLines
    .filter(l => l !== "")
    .join("\n");

  return { lineText, item };
}