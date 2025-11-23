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
 *   item: { theme, word, pos, zh, example, example_zh, cefr } | null
 * }
 *
 * item 為 null 表示：不是正常單字（打錯 / 虛構），不要寫入試算表
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();

  const prompt = `
你是一位友善的雙語英文老師，現在要協助使用者查單字「${word}」。

第一步：請先判斷這是不是正常的英文單字。

【第一行：一行資料，給程式用】
只輸出一行，使用半形直線 | 分隔，格式必須完全符合：

status | word | pos | zh | example | example_zh | cefr

說明：
- status：如果是正常英文單字，請輸出 REAL；如果不是正常英文單字或很罕見的亂碼，請輸出 NOT_WORD。
- word：單字本身（小寫即可）
- pos：詞性（n. / v. / adj. / adv. 其一，必要時可以 n., v. 這樣）
- zh：最常用、最核心的繁體中文意思（只給一個簡短解釋）
- example：一個 8–20 字自然英文例句
- example_zh：例句的繁體中文翻譯
- cefr：A1~C2 中選一個最適合的等級

如果 status 為 NOT_WORD，其餘欄位可以留空。

【第二部分：給使用者看的成品（只在 REAL 時需要）】
在第一行之後，請輸出以下「固定格式」，不要多加任何其他文字、說明或條列：

📚 Word: word
詞性：pos
中文：zh
CEFR：cefr
例句：
- example
→ example_zh

⚠ 禁止輸出任何額外說明、其他例句、星號、Markdown 標記或段落。
⚠ 只允許以上 6 行內容。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  // 先抓第一行（status | word | pos | zh | example | example_zh | cefr）
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const firstLine = lines[0] || "";

  const parts = firstLine.split("|").map((p) => p.trim());
  if (parts.length < 7) {
    console.warn("⚠ 查單字：無法解析第一行，回傳原始文字");
    return {
      lineText: text,
      item: null,
    };
  }

  const [statusRaw, wRaw, pos, zh, example, example_zh, cefrRaw] = parts;
  const status = (statusRaw || "").toUpperCase();
  const cefr = (cefrRaw || "").toUpperCase();
  const w = wRaw || word;

  // ========= 情況一：不是正常單字（NOT_WORD） =========
  if (status !== "REAL") {
    const lineText =
      `看起來「${word}」不是常見的英文單字，` +
      `可能是打錯字或是自創字喔！\n\n` +
      `可以再檢查看看拼字，或改查另一個單字～`;

    return {
      lineText,
      item: null, // 🔴 不寫入試算表
    };
  }

  // ========= 情況二：正常單字，整理成統一格式 =========
  const item = {
    theme: "lookup",          // 查單字就統一歸類在 lookup
    word: w,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  // 回給 LINE 的簡潔卡片
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
