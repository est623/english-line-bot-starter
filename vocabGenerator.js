// vocabGenerator.js
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 填入金鑰");
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);

// ⚠ 若你在別的檔案（例如 dictionaryClient.js）用的是 "gemini-1.5-flash-latest"
//   就把同一個字串複製過來，保持一致
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

/**
 * 產生主題單字（給 /today 跟 index.js 用）
 *
 * 回傳格式：
 * [
 *   {
 *     theme: "daily life",
 *     word: "rush",
 *     pos: "v.",
 *     zh: "趕著做…；匆忙…",
 *     example: "I rushed to finish the report before the meeting.",
 *     example_zh: "我趕在會議前完成報告。",
 *     cefr:'B1'
 *   },
 *   ...
 * ]
 */
export async function generateVocab({ theme, count, bannedWords = [] }) {
  const bannedText = bannedWords.length
    ? `請避免使用以下已出現過的單字（含大小寫與詞形變化）：${bannedWords
        .slice(0, 2000)
        .join(", ")}。`
    : "如果可以的話，盡量不要跟很常見的基礎字完全重複。";

  const prompt = `
你是一位專業英語教學編輯，讀者是 TOEIC 大約 400–700 分的上班族（CEFR A2–B1 為主，少量 B2）。

主題是：「${theme}」。

請產生「${count} 個」實用英文單字或短片語，難度大約 A2–B2。
${bannedText}

⚠ 請用「一行一個」的方式輸出，每行格式嚴格如下（使用半形直線 | 當分隔）：

word | pos | zh | example | example_zh | cefr

說明：
- word：單字或常用片語（例如 follow up），不用加引號。
- pos：詞性，使用縮寫，例如 n. / v. / adj. / adv.
- zh：繁體中文解釋，簡潔自然。
- example：8–20 字的自然英文例句，生活或職場情境皆可。
- example_zh：例句的繁體中文翻譯。
- cefr：請填 A2/B1/B2 其中一個，依照該單字的難度估計。

請注意：
- 一定要輸出「剛好 ${count} 行」資料。
- 不要加上編號（不要 1. 2. 3.）。
- 不要加任何說明文字、標題、JSON、註解，只要一行一筆資料。
  `.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim();
  console.log("📄 原始 Gemini vocab 回應：\n", text);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items = [];

  for (const line of lines) {
    // 期望格式：word | pos | zh | example | example_zh | cefr
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) {
      console.warn("⚠ 無法解析的行（欄位不足 6 個）：", line);
      continue;
    }

    const [word, pos, zh, example, example_zh, cefrRaw] = parts;
    
    // 簡單清理一下 CEFR（避免模型亂寫）
let cefr = (cefrRaw || "").toUpperCase();
if (!["A1","A2","B1","B2","C1","C2"].includes(cefr)) {
  // 如果它亂寫就給個大概值，或留空都可以
  cefr = "";
}

    items.push({
      theme,
      word,
      pos,
      zh,
      example,
      example_zh,
      cefr,
    });

    if (items.length >= count) break;
  }

  if (items.length === 0) {
    throw new Error("Gemini 回應無法解析成任何單字（可能 prompt 沒照格式回覆）");
  }

  return items;
}
