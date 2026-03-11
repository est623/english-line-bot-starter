// lineWebhook.js
import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import { lookupWord } from "./dictionaryClient.js";
import { generateVocab } from "./vocabGenerator.js";
import {
  getTodayVocab,
  getRecentSentWords,
  appendVocabRows,
  checkWordExists,
  findVocabByWord,
  getAllVocab,
  appendWrongAnswers, // 👈 新增：錯題寫入
} from "./googleSheetClient.js";
import { getThemeForDate } from "./themeState.js";

// 儲存使用者的測驗狀態
const quizSessions = new Map();
// userId -> { questions: [...], current: 0, correct: 0 }

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 建立測驗題目（看中文選英文）
function buildQuizQuestions(vocabItems, count = 5) {
  const questions = [];

  // 先濾掉沒有 word / zh 的怪資料
  const pool = vocabItems.filter((v) => v && v.word && v.zh);

  // 隨機抽出要考的題目
  const picked = shuffle([...pool]).slice(0, count);

  for (const item of picked) {
    const correct = item.word;

    // 先做一份「去重的候選錯誤答案清單」
    const wrongCandidates = Array.from(
      new Set(
        pool
          .filter((v) => v.word !== correct) // 不能跟正解一樣
          .map((v) => v.word)
      )
    );

    // 抽 3 個錯的
    const wrongWords = shuffle(wrongCandidates).slice(0, 3);

    // 正解 + 錯誤選項
    let options = [correct, ...wrongWords];
    options = shuffle(options);

    // 保險機制：如果某種怪狀況導致 options 裡沒有正解，就強制塞回去
    if (!options.includes(correct)) {
      options[0] = correct;
      options = shuffle(options);
    }

    questions.push({
      zh: item.zh, // 題目顯示的中文
      word: correct, // 正確英文
      options, // 四個選項
      answer: correct, // 正解（用來判分）
    });
  }

  return questions;
}

// 產生「題目」訊息物件（方便重複使用）
function buildQuizQuestionMessage(q, index, total) {
  const text = `第 ${index + 1} 題 / 共 ${total} 題
「${q.zh}」的正確英文是哪一個？

A. ${q.options[0]}
B. ${q.options[1]}
C. ${q.options[2]}
D. ${q.options[3]}
`;

  const quick = q.options.map((opt, i) => ({
    type: "action",
    action: {
      type: "message",
      label: String.fromCharCode(65 + i), // A/B/C/D
      text: String.fromCharCode(65 + i),
    },
  }));

  return {
    type: "text",
    text,
    quickReply: { items: quick },
  };
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("❌ 缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_CHANNEL_SECRET，請檢查 .env");
  process.exit(1);
}

const app = express();
const client = new Client(config);

app.post("/webhook", middleware(config), async (req, res) => {
  try {
    console.log("✅ 收到 LINE webhook：", JSON.stringify(req.body, null, 2));
    const events = (req.body && req.body.events) ? req.body.events : [];

    if (events.length === 0) {
      return res.status(200).end();
    }

    await Promise.all(events.map(handleEvent));
    return res.status(200).end();
  } catch (err) {
    console.error("處理 webhook 時發生錯誤：", err);
    return res.status(500).end();
  }
});

// 判斷是不是「單一英文單字」
function isSingleEnglishWord(text) {
  return /^[A-Za-z\-]+$/.test(text.trim());
}


function normalizeWordKey(word) {
  return String(word || "").trim().toLowerCase();
}

/**
 * Filter out words already used; compare by normalized word only (ignore POS).
 */
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

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  console.log("👤 使用者輸入：", userText);
  const userId = event.source.userId; // 統一在這裡宣告

  // 1️⃣ 指令模式：/today
  if (userText === "/today") {
    const COUNT_PER_DAY = 10;
    const LOOKBACK_DAYS = 30;
    const MAX_RETRY_ROUNDS = 5;

    try {
      function getTodayTaipeiDateStr() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const parts = formatter.formatToParts(now);
        const y = parts.find((p) => p.type === "year").value;
        const m = parts.find((p) => p.type === "month").value;
        const d = parts.find((p) => p.type === "day").value;
        return `${y}-${m}-${d}`;
      }

      const todayStr = getTodayTaipeiDateStr(); // ★ 用台灣日期

      // 取得今日主題
      const THEME = getThemeForDate(todayStr);

      // 讀今天是否已有資料
      const existing = await getTodayVocab({
        theme: THEME,
        dateStr: todayStr,
        limit: COUNT_PER_DAY,
      });

      let items = [...existing];

      // Build used-word set from recent 30-day sent words + already-generated today words.
      const recentWords = await getRecentSentWords({
        days: LOOKBACK_DAYS,
        source: "today",
      });
      const usedWords = new Set(
        recentWords.map(normalizeWordKey).filter(Boolean)
      );

      for (const item of items) {
        const key = normalizeWordKey(item && item.word);
        if (key) usedWords.add(key);
      }

      let retryRound = 0;
      while (items.length < COUNT_PER_DAY && retryRound < MAX_RETRY_ROUNDS) {
        retryRound++;

        const need = COUNT_PER_DAY - items.length;
        const requestCount = Math.max(need * 2, need);

        const generated = await generateVocab({
          theme: THEME,
          count: requestCount,
          bannedWords: Array.from(usedWords),
        });

        const freshItems = pickFreshVocabItems(generated, usedWords, need);
        if (freshItems.length === 0) continue;

        await appendVocabRows(freshItems, { source: "today" });
        items = items.concat(freshItems);
      }

      if (items.length < COUNT_PER_DAY) {
        console.warn(
          "today vocab not full after retries: got " +
            items.length +
            "/" +
            COUNT_PER_DAY
        );
      }

      if (items.length === 0) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "今天的單字好像還沒準備好，稍後再試一次看看 🥲",
        });
      }

      const lines = [`📅 今日主題單字（${THEME}）：`];
      for (const item of items) {
        lines.push(
          `\n🔹 ${item.word} (${item.pos || ""})`,
          `中文：${item.zh || ""}`,
          `例句：${item.example || item.example_en || ""}`,
          `→ ${item.example_zh || ""}`
        );
      }

      const replyText = lines.join("\n");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText.slice(0, 4900),
      });
    } catch (err) {
      console.error("處理 /today 發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "😢 產生 /today 單字或讀取試算表時發生錯誤，可以稍後再試一次。",
      });
    }
  }

  // 2️⃣ 指令模式：/quiz5 → 隨機考 5 題
  if (userText === "/quiz5") {
    try {
      const vocabItems = await getAllVocab();

      if (!vocabItems || vocabItems.length < 5) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "🥲 題庫不足 5 題，無法開始測驗",
        });
      }

      const questions = buildQuizQuestions(vocabItems, 5);

      quizSessions.set(userId, {
        questions,
        current: 0,
        correct: 0,
      });

      const firstMsg = buildQuizQuestionMessage(
        questions[0],
        0,
        questions.length
      );

      return client.replyMessage(event.replyToken, firstMsg);
    } catch (err) {
      console.error("處理 /quiz5 發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "😵 產生測驗時發生錯誤，可以稍後再試一次。",
      });
    }
  }

  // 3️⃣ 測驗作答模式（一定要放在查單字之前！）
  if (quizSessions.has(userId)) {
    const session = quizSessions.get(userId);
    const q = session.questions[session.current];

    const ansIndex = ["A", "B", "C", "D"].indexOf(userText.toUpperCase());
    if (ansIndex === -1) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請用 A / B / C / D 作答喔！",
      });
    }

    const chosen = q.options[ansIndex];

    let feedback = "";
    if (chosen === q.answer) {
      session.correct++;
      feedback = `✅ 答對了！${q.answer} = ${q.zh}`;
    } else {
      feedback = `❌ 答錯了！正確答案是：${q.answer}（${q.zh}）`;

      // 📝 新增：錯題寫進 WrongAnswers
      try {
        await appendWrongAnswers([
          {
            userId,
            word: q.word,
            zh: q.zh,
            chosen, // 使用者選到的錯誤答案
            is_correct: false,
            question_zh: q.zh,
            options: q.options,
            quiz_type: "/quiz5",
          },
        ]);
      } catch (err) {
        console.error("寫入錯題紀錄錯誤：", err);
      }
    }

    session.current++;

    // 已經作答完最後一題
    if (session.current >= session.questions.length) {
      quizSessions.delete(userId);

      const summaryText = `🎉 測驗結束！

共 5 題，你答對了 ${session.correct} 題
正確率：${Math.round((session.correct / 5) * 100)}%

輸入 /quiz5 再來一次吧！`;

      return client.replyMessage(event.replyToken, [
        { type: "text", text: feedback },
        { type: "text", text: summaryText },
      ]);
    }

    // 還有下一題：先回覆答題結果，再送出下一題
    const nextQ = session.questions[session.current];
    const nextMsg = buildQuizQuestionMessage(
      nextQ,
      session.current,
      session.questions.length
    );

    return client.replyMessage(event.replyToken, [
      { type: "text", text: feedback },
      nextMsg,
    ]);
  }

  // 4️⃣ 查單字模式：單一英文單字
  if (isSingleEnglishWord(userText)) {
    try {
      const inputWord = userText.toLowerCase();
      const fromSheet = await findVocabByWord(inputWord);

      if (fromSheet) {
        const cachedLines = [
          "source: sheet",
          `Word: ${fromSheet.word}`,
          fromSheet.pos ? `POS: ${fromSheet.pos}` : "POS: ",
          fromSheet.zh ? `ZH: ${fromSheet.zh}` : "ZH: ",
          fromSheet.cefr ? `CEFR: ${fromSheet.cefr}` : "CEFR: ",
          "",
          "Example:",
          fromSheet.example ? `- ${fromSheet.example}` : "- (no example)",
          fromSheet.example_zh ? `- ${fromSheet.example_zh}` : "- (no zh example)",
        ];

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: cachedLines.join("\n").slice(0, 4900),
        });
      }

      const { lineText, item } = await lookupWord(inputWord);

      if (item) {
        const exists = await checkWordExists(item.word);

        if (!exists) {
          console.log(`📌 新單字：寫入試算表 → ${item.word}`);
          await appendVocabRows([item], { source: "lookup" });
        } else {
          console.log(`⚠ 已存在：不寫入 → ${item.word}`);
        }
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: (lineText + "\n\nsource: gemini").slice(0, 4900),
      });
    } catch (err) {
      console.error("查單字時發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "😵 查單字時發生錯誤，可以稍後再試一次。",
      });
    }
  }

  // 5️⃣ 其他訊息：簡單提示
  const helpText =
    "嗨，我是你的英文單字小幫手 👋\n\n" +
    "你可以這樣跟我互動：\n" +
    "• 輸入 /today　→ 給你 5 個今日主題單字（會記錄在試算表）\n" +
    "• 輸入 /quiz5 → 隨機考你 5 題單字小測驗\n" +
    "• 輸入一個英文單字（例如：abandon）→ 查意思＋同義字＋例句\n";

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: helpText,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE webhook server is running on port ${PORT}`);
  console.log(`   現在在本機 http://localhost:${PORT}/ ，一律用 POST /webhook 接 LINE`);
});
