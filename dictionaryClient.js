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
 * 主題列表（用來讓 Gemini 幫你判斷單字比較接近哪個主題）
 */
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
 * 🔍 用 Datamuse 檢查是不是「真的英文單字」
 *   - https://api.datamuse.com/words?sp=word&max=1
 */
async function isRealEnglishWord(word) {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(
    word
  )}&max=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn("⚠ isRealEnglishWord 呼叫失敗，res.status =", res.status);
    return true; // API 掛掉時，寧可當作是真單字，避免完全不能用
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return false;

  const found = (data[0].word || "").toLowerCase();
  return found === word.toLowerCase();
}

/**
 * 🤔 如果不是單字，用 Datamuse 給個建議拼法
 *   - https://api.datamuse.com/sug?s=word&max=3
 */
async function suggestWord(word) {
  const url = `https://api.datamuse.com/sug?s=${encodeURIComponent(
    word
  )}&max=3`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  // 取第一個建議就好
  return (data[0].word || "").toLowerCase();
}

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
  if (!word) {
    return {
      lineText: "請輸入一個英文單字，我再幫你查 😉",
      item: null,
    };
  }

  // 1️⃣ 先判斷是不是「像樣的英文單字」
  try {
    const ok = await isRealEnglishWord(word);
    if (!ok) {
      const suggestion = await suggestWord(word);

      let msg =
        `🧐 你輸入的「${rawWord}」看起來不像是常見的英文單字喔。\n` +
        `可能是打錯字，或不是一般字典會收錄的字。`;

      if (suggestion && suggestion !== word) {
        msg += `\n\n你是不是想查：「${suggestion}」？`;
      }

      return {
        lineText: msg,
        item: null, // 不寫進試算表
      };
    }
  } catch (e) {
    console.warn("⚠ 拼字檢查失敗，先當作正常單字處理：", e);
    // 失敗就繼續往下走，用 Gemini 查
  }

  // 2️⃣ 正常單字 → 請 Gemini 幫忙產生結構化資料
  const themesText = THEMES.map((t) => `- ${t}`).join("\n");

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
  - pos：詞性，請用簡短縮寫，例如 n. / v. / adj. / adv.
  - zh：自然的繁體中文解釋即可
  - example：8–20 字自然英文例句
  - example_zh：例句的繁體中文翻譯
  - cefr：請在 A1~C2 中選一個最接近的等級（例如 A2 / B1）

【第二部分：給使用者看的詳細說明】
- 請用中文為主、英文點到為止即可，結構建議：
  詞性：
  中文：
  同義字：
  例句：
  → 中文翻譯：

⚠ 重點：
- 第一行一定要是「資料行」，且一定要有 7 個欄位。
- 第二部分排版自由，但請避免太長的英文說明。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const firstLine = lines[0] || "";
  const restText = lines.slice(1).join("\n").trim();

  // 解析第一行：theme | word | pos | zh | example | example_zh | cefr
  const parts = firstLine.split("|").map((p) => p.trim());
  if (parts.length < 7) {
    console.warn("⚠ 查單字：無法解析第一行，改用原始文字回覆");
    return {
      lineText: text,
      item: null,
    };
  }

  const [themeRaw, w, pos, zh, example, example_zh, cefrRaw] = parts;
  const cefr = (cefrRaw || "").toUpperCase();

  // 保護：AI 亂給主題時 fallback
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";

  const item = {
    theme,
    word: w || word,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr: cefr || "",
  };

  // 3️⃣ 組 LINE 要看的「小卡」文字（只用結構化欄位，不用 restText）
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
