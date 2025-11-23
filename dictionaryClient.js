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
 * 主題列表（AI 必須從這裡挑一個）
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
 * 🔍 檢查是否為真正的英文單字（Datamuse）
 */
async function isRealEnglishWord(word) {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&max=1`;

  const res = await fetch(url);
  if (!res.ok) return true; // API 掛掉 ≈ 當成正常單字

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return false;

  return data[0].word.toLowerCase() === word.toLowerCase();
}

/**
 * 🪄 給錯字提供推薦拼法
 */
async function suggestWord(word) {
  const url = `https://api.datamuse.com/sug?s=${encodeURIComponent(word)}&max=3`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return data[0].word.toLowerCase();
}

/**
 * 🔎 查單字（主功能）
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim().toLowerCase();
  if (!word) {
    return {
      lineText: "請輸入一個英文單字，我來幫你查 😉",
      item: null,
    };
  }

  // 1️⃣ 先確認是否為真正英文單字
  try {
    const ok = await isRealEnglishWord(word);
    if (!ok) {
      const suggestion = await suggestWord(word);
      let msg =
        `🧐「${rawWord}」看起來不像常見英文單字。\n可能是打錯字或不是字典收錄的字。`;

      if (suggestion && suggestion !== word) {
        msg += `\n\n你是不是想查：「${suggestion}」？`;
      }

      return { lineText: msg, item: null };
    }
  } catch (err) {
    console.warn("⚠ 拼字檢查失敗，跳過：", err);
  }

  // 2️⃣ 用 Gemini 建立資料
  const themeList = THEMES.map((t) => `- ${t}`).join("\n");
  const prompt = `
請用兩部分回覆：

【第一部分：一行資料】
請只給一行，格式如下：
theme | word | pos | zh | example | example_zh | cefr

說明：
- theme 從下列列表挑一個：
${themeList}
- word：單字
- pos：n. / v. / adj. / adv.
- zh：繁體中文解釋
- example：自然英文例句（8–20 字）
- example_zh：例句中文
- cefr：A1~C2

【第二部分：簡短補充說明】
提供使用者看的簡短解釋，不要使用 Markdown 標題，不要用 *** 或 ###。
以自然文字方式呈現即可。
`.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 Gemini 查單字原始回應：\n", text);

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const firstLine = lines[0] || "";
  const restText = lines.slice(1).join("\n").trim();

  // 3️⃣ 解析第一行
  const parts = firstLine.split("|").map((p) => p.trim());
  if (parts.length < 7) {
    console.warn("⚠ 無法解析 AI 資料行，直接回傳全文");
    return { lineText: text, item: null };
  }

  const [themeRaw, w, pos, zh, example, example_zh, cefrRaw] = parts;
  const theme = THEMES.includes(themeRaw) ? themeRaw : "lookup";
  const cefr = (cefrRaw || "").toUpperCase();

  const item = {
    theme,
    word: w || word,
    pos: pos || "",
    zh: zh || "",
    example: example || "",
    example_zh: example_zh || "",
    cefr,
  };

  // 4️⃣ LINE 回覆版本（乾淨版，不會出現一堆 *）
  const replyLines = [
    `📚 Word: ${item.word}`,
    item.pos ? `詞性：${item.pos}` : "",
    item.zh ? `中文：${item.zh}` : "",
    item.cefr ? `CEFR：${item.cefr}` : "",
    "",
    "例句：",
    item.example ? `- ${item.example}` : "",
    item.example_zh ? `→ ${item.example_zh}` : "",
    "",
    restText ? `補充說明：\n${restText}` : "",
  ];

  const lineText = replyLines.filter(Boolean).join("\n");

  return { lineText, item };
}
