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

// 這個主題清單要跟你 /today 用的一樣
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

⚠ 請務必只輸出「精簡格式」，不能輸出多餘解釋、不能加入補充字義、不能使用 Markdown 或任何符號（如 **、###、---）。

【第一行：一行資料，給程式用】
請用一行輸出，格式如下，用 | 分隔：
word | pos | zh | example | example_zh | cefr

說明：
- word：單字本身
- pos：詞性（n. / v. / adj. / adv.）
- zh：最常用、最核心的繁體中文意思（只給一個）
- example：一句 8–20 字的英文例句
- example_zh：例句翻譯
- cefr：A1~C2

【第二部分：給使用者看的成品】
請輸出以下「固定格式」，禁止任意添加文字、說明、補充句子。

格式如下：

📚 Word: word
詞性：pos
中文：zh
CEFR：cefr
例句：
- example
→ example_zh

⚠ 不能多加任何其他內容。
⚠ 不能寫分析、不能寫用法、不能寫語源、不能寫多個解釋。
⚠ 第二部分只准用這 6 行內容。


`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const firstLine = lines[0] || "";
  const restText = lines.slice(1).join("\n").trim();

  // 解析第一行：status | theme | word | pos | zh | example | example_zh | cefr
  const parts = firstLine.split("|").map((p) => p.trim());
  if (parts.length < 8) {
    console.warn("⚠ 查單字：無法解析第一行，回傳原始文字");
    return {
      lineText: text,
      item: null,
    };
  }

  const [statusRaw, themeRaw, wRaw, pos, zh, example, example_zh, cefrRaw] = parts;
  const status = (statusRaw || "").toUpperCase();
  const cefr = (cefrRaw || "").toUpperCase();
  const w = wRaw || word;

  // ========= 情況一：不是正常單字（NOT_WORD） =========
  if (status !== "REAL") {
    // 給使用者看的訊息（用模型第二段的說明，如果沒有就自己組一段）
    const fallbackMsg =
      `看起來「${word}」不是常見的英文單字，可能是打錯字或是自創字喔！` +
      `\n\n可以再檢查看看拼字，或改查另一個單字～`;
    const lineText = restText || fallbackMsg;

    return {
      lineText,
      item: null, // 🔴 不寫入試算表
    };
  }

  // ========= 情況二：正常單字，整理成統一格式 =========
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";

  const item = {
    theme,
    word: w,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  // 給 LINE 的卡片文字
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

  if (restText) {
    replyLines.push("", "補充說明：", restText);
  }

  const lineText = replyLines.filter((l) => l !== "").join("\n");

  return { lineText, item };
}
