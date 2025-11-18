// dictionaryClient.js
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 填入金鑰");
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);

// 👇 這裡如果你在 vocabGenerator.js 用的是別的 model 名稱
// （例如 "gemini-1.5-flash-latest"），就把同一個字串複製過來
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

/**
 * 查單字：直接回一段排版好的文字，不再回 JSON
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim();

  const prompt = `
你是一位專業英語老師，使用繁體中文解釋英文單字。

請用以下格式，說明單字「${word}」：

📚 Word: (單字)
詞性：v. / n. / adj. ...（如果有多個可以用 / 分開）
中文：用自然的繁體中文簡單說明意思

英文解釋：
- 用英文解釋 1
- 用英文解釋 2（如果需要）

同義字：
- 同義字1, 同義字2, 同義字3...

例句：
- 英文例句1
  → 例句1的中文翻譯
- 英文例句2
  → 例句2的中文翻譯

要求：
- 回覆請維持上面這個大致格式就好，方便我直接貼給學生
- 不要額外加教學說明或 JSON，只要文字內容
- 例句可以偏向日常生活或職場情境

如果你判斷「${word}」不是常見英文單字，或看不懂使用者在打什麼，
請直接回：

看起來「${word}」不是常見的英文單字，可能要檢查一下拼字喔！
  `.trim();

  const res = await model.generateContent(prompt);
  const text = res.response.text();
  return text;
}
