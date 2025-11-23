// dictionaryClient.js
//123測試
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
你是一位友善的雙語英文老師，幫學習者檢查並解釋單字「${word}」。

請先判斷這是不是一個「真實且常見的英文單字」。

【第一部分：一行資料，給程式用】
- 請只輸出「一行」，用半形直線 | 分隔，總共 8 個欄位：
  status | theme | word | pos | zh | example | example_zh | cefr

欄位說明：
- status：如果是正常英文單字，填入 REAL；
          如果不是常見英文單字（例如亂打的字母、明顯錯字），填入 NOT_WORD。
- theme：當 status 為 REAL 時，必須從下列主題中選一個字串（需完全一致）：
${themesText}
         當 status 為 NOT_WORD 時，可以留空。
- word：單字本身
- pos：詞性，使用 n. / v. / adj. / adv. 等縮寫
- zh：自然的繁體中文解釋
- example：8–20 字自然英文例句
- example_zh：例句的繁體中文翻譯
- cefr：A1~C2 其中一個等級

⚠ 重點：
- 第一行一定要是「資料行」，不得輸出欄位名稱（例如 word, pos, zh）。
- 第一行不能是示範格式，只能是實際內容。

【第二部分：給使用者看的詳細說明】
請全部使用「純文字」，禁止使用 Markdown 標記，例如 **、*、###、---、>、- 。
請使用自然段落排版，不要任何符號開頭。

建議格式如下（可調整，但請不要出現任何 Markdown）：

詞性：
中文：
英文簡短解釋：
常見搭配：
用法補充：
例句（若需要額外例句可以補充）：

⚠ 重要：
- 第二部分不能出現 *, **, ###, ---, 或任何 Markdown 語法。
- 第二部分只能是純文字，使用換行分段。

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
