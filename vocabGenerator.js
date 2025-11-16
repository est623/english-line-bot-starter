// vocabGenerator.js（Gemini 1.5 Flash，簡單穩定版）
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 GEMINI_API_KEY，請在 .env 設定");
  }
  return new GoogleGenerativeAI(apiKey);
}

// 不再用 response_schema，改成用 prompt 要它吐 JSON
export async function generateVocab({ theme, count, bannedWords }) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });


  const prompt = `
你是一位專業英語教學編輯，請產生 ${count} 個符合主題「${theme}」、
TOEIC 400–700（約 CEFR A2~B2）的實用字彙。

請「只輸出」一段 JSON，格式嚴格遵守下列結構（不要加註解或多餘文字）：

{
  "items": [
    {
      "theme": "travel",
      "word": "passport",
      "pos": "n.",
      "zh": "護照",
      "example": "Don't forget to bring your passport when you travel abroad.",
      "example_zh": "出國旅行時別忘了帶護照。",
      "cefr": "A2"
    }
  ]
}

規則：
- items 陣列長度要是 ${count}
- theme 一律填 "${theme}"
- pos 只能用: "n.", "v.", "adj.", "adv."
- example 為 8~25 個英文單字的自然句子，偏向職場或生活情境
- example_zh 為繁體中文翻譯
- cefr 為 "A2"、"B1" 或 "B2"
- 避免與下列清單重複（大小寫視為同字，詞形相近也盡量避免）：
  ${ (bannedWords || []).join(", ") }

再次強調：只輸出 JSON，不要任何多餘文字。
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();   // 這裡會是一整段 JSON 字串

  // 如果它不乖，有可能前後多了一點文字，我們做個簡單清洗：
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const jsonText = text.slice(firstBrace, lastBrace + 1);

  const data = JSON.parse(jsonText);
  return data.items;
}
