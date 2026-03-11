// index.js：自動輪流主題 + 寫入 Google Sheet
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateVocab } from "./vocabGenerator.js";
import { appendVocabRows, getRecentSentWords } from "./googleSheetClient.js";

// 讓 __dirname 在 ES module 可以用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 存放「目前輪到哪個主題」的小檔案
const STATE_PATH = path.join(__dirname, "state.json");

// 這裡列出你想輪流跑的主題（之後想加/改，只要改這個陣列）
const THEMES = ["daily life","travel","school","work","health","small talk","food","email","presentation","customer service"];

// 每次要幾個單字
const COUNT_PER_THEME = 10;

// 讀取下一個主題（會記錄在 state.json 裡）
function getNextTheme() {
  let index = 0;

  if (fs.existsSync(STATE_PATH)) {
    try {
      const raw = fs.readFileSync(STATE_PATH, "utf8");
      const state = JSON.parse(raw);
      if (typeof state.lastIndex === "number") {
        index = (state.lastIndex + 1) % THEMES.length;
      }
    } catch (e) {
      console.warn("⚠ 讀取 state.json 失敗，從頭開始計算主題");
      index = 0;
    }
  }

  const theme = THEMES[index];

  // 寫回新的 index
  const newState = { lastIndex: index };
  fs.writeFileSync(STATE_PATH, JSON.stringify(newState), "utf8");

  return theme;
}


function normalizeWordKey(word) {
  return String(word || "").trim().toLowerCase();
}

function pickFreshVocabItems(candidates, usedWords, limit) {
  const picked = [];
  for (const item of candidates || []) {
    const key = normalizeWordKey(item && item.word);
    if (!key) continue;
    if (usedWords.has(key)) continue;

    usedWords.add(key);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}
async function main() {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 填入金鑰");
      process.exit(1);
    }

    const theme = getNextTheme();
    console.log(`📘 這次主題：${theme}（${COUNT_PER_THEME} 個字）`);

        const LOOKBACK_DAYS = 30;
    const MAX_RETRY_ROUNDS = 5;

    const recentWords = await getRecentSentWords({
      days: LOOKBACK_DAYS,
      source: "today",
    });
    const usedWords = new Set(recentWords.map(normalizeWordKey).filter(Boolean));

    const items = [];
    let retryRound = 0;

    while (items.length < COUNT_PER_THEME && retryRound < MAX_RETRY_ROUNDS) {
      retryRound++;

      const need = COUNT_PER_THEME - items.length;
      const requestCount = Math.max(need * 2, need);

      const generated = await generateVocab({
        theme,
        count: requestCount,
        bannedWords: Array.from(usedWords),
      });

      const freshItems = pickFreshVocabItems(generated, usedWords, need);
      if (freshItems.length === 0) continue;

      items.push(...freshItems);
    }

    if (items.length === 0) {
      throw new Error("No fresh vocab generated after retry rounds");
    }

    // ??? Google Sheet
    await appendVocabRows(items, { source: "today" });

    console.log(`🌟 已寫入 Google Sheet：${items.length} 筆單字（主題：${theme}）`);
    console.log("✔ 本次結束，可以下次再跑增加下一個主題");
  } catch (err) {
    console.error("發生錯誤：", err?.message || err);
  }
}

main();
