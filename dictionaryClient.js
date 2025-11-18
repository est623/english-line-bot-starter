// dictionaryClient.js
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 填入金鑰");
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 清一下 Gemini 可能回傳的 ```json ``` 標記
function cleanJsonText(text) {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * 查單字：
 * 回傳格式：
 * {
 *   word: string,
 *   pos: [ "v.", "n." ],
 *   zh: string,
 *   definitions: [string],
 *   synonyms: [string],
 *   examples: [{ en: string, zh: string }]
 * }
 * 或 { notFound: true }
 */
export async function lookupWord(rawWord) {
  const word = rawWord.trim();

  const prompt = `
你是一位專業英漢字典編輯，請針對英文單字「${word}」產生 JSON 格式的說明。

⚠️ 一定要回傳「純 JSON」，不要加任何多餘文字、解說、註解，也不要包在 \`\`\`json 之中。

JSON 結構如下：

{
  "word": "字串，原始單字的小寫版本",
  "pos": ["詞性1", "詞性2"],
  "zh": "用繁體中文寫的簡潔總結意思",
  "definitions": ["英文解釋1", "英文解釋2"],
  "synonyms": ["同義字1", "同義字2", "同義字3"],
  "examples": [
    { "en": "英文例句1", "zh": "例句1的中文翻譯" },
    { "en": "英文例句2", "zh": "例句2的中文翻譯" }
  ]
}

說明：
- pos 請用常見縮寫：v., n., adj., adv. 等。
- zh 請用自然的繁體中文，1~2 句、不要太多。
- definitions 為英文解釋，1~3 個即可。
- synonyms 3~6 個常見同義字。
- examples 至少 1 個，最多 3 個。

如果判斷「${word}」不是常見英文單字或無法查到，
請回傳：

{ "notFound": true }
  `.trim();

  const res = await model.generateContent(prompt);
  let text = res.response.text();

  text = cleanJsonText(text);

  try {
    const data = JSON.parse(text);
    return data;
  } catch (err) {
    console.error("❌ 解析查單字 JSON 失敗：", err, "原始回傳：", text);
    return {
      error: true,
      raw: text
    };
  }
}
