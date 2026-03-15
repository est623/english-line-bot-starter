import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
  appendWrongAnswers,
  getPushSubscribers,
  upsertPushSubscriber,
} from "./googleSheetClient.js";
import { getThemeForDate } from "./themeState.js";
import { buildLookupWordText } from "./messageFormatters.js";

// -----------------------------
// Runtime constants
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAILY_PUSH_STATE_PATH = path.join(__dirname, "dailyPushState.json");
const TAIPEI_TIMEZONE = "Asia/Taipei";
const DAILY_PUSH_HOUR = 7;
const DAILY_PUSH_MINUTE = 0;
const DAILY_WORD_COUNT = 5;
const LOOKBACK_DAYS = 30;
const MAX_RETRY_ROUNDS = 5;

// Quiz state in memory
const quizSessions = new Map();
// userId -> { questions: [...], current: number, correct: number }

// -----------------------------
// Utility helpers
// -----------------------------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function normalizeWordKey(word) {
  return String(word || "").trim().toLowerCase();
}

function isSingleEnglishWord(text) {
  return /^[A-Za-z\-]+$/.test(text.trim());
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[state] Failed to read JSON:", filePath, err);
    return fallbackValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[state] Failed to write JSON:", filePath, err);
  }
}

function getTaipeiNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value || "0000";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");

  return {
    dateStr: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

function getTodayTaipeiDateStr() {
  return getTaipeiNowParts().dateStr;
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

// -----------------------------
// Quiz helpers
// -----------------------------
function buildQuizQuestions(vocabItems, count = 5) {
  const questions = [];
  const pool = vocabItems.filter((v) => v && v.word && v.zh);
  const picked = shuffle([...pool]).slice(0, count);

  for (const item of picked) {
    const correct = item.word;

    const wrongCandidates = Array.from(
      new Set(
        pool
          .filter((v) => v.word !== correct)
          .map((v) => v.word)
      )
    );

    const wrongWords = shuffle(wrongCandidates).slice(0, 3);
    let options = shuffle([correct, ...wrongWords]);

    if (!options.includes(correct)) {
      options[0] = correct;
      options = shuffle(options);
    }

    questions.push({
      zh: item.zh,
      word: correct,
      options,
      answer: correct,
    });
  }

  return questions;
}

function buildQuizQuestionMessage(q, index, total) {
  const zh = String(q?.zh || "").trim() || "（題目資料缺漏）";
  const options = Array.isArray(q?.options) ? q.options : [];
  const getOption = (i) => String(options[i] || "").trim();
  const text =
    `📝 測驗第 ${index + 1} / ${total} 題\n\n` +
    `請選出「${zh}」對應的正確英文單字：\n\n` +
    `A. ${getOption(0)}\n` +
    `B. ${getOption(1)}\n` +
    `C. ${getOption(2)}\n` +
    `D. ${getOption(3)}`;

  const quick = q.options.map((_, i) => ({
    type: "action",
    action: {
      type: "message",
      label: String.fromCharCode(65 + i),
      text: String.fromCharCode(65 + i),
    },
  }));

  return {
    type: "text",
    text,
    quickReply: { items: quick },
  };
}

function buildQuizFeedbackText(isCorrect, answerWord, zh) {
  const safeAnswer = String(answerWord || "").trim() || "（無資料）";
  const safeZh = String(zh || "").trim() || "（無資料）";
  const title = isCorrect ? "✅ 答對了！" : "❌ 答錯了！";
  return `${title}\n\n正確答案：${safeAnswer}\n中文意思：${safeZh}`;
}

function buildQuizSummaryText(correct, total) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 5;
  const safeCorrect = Number.isFinite(correct) && correct >= 0 ? correct : 0;
  const accuracy = Math.round((safeCorrect / safeTotal) * 100);
  return (
    `🎉 測驗完成！\n\n` +
    `答對題數：${safeCorrect} / ${safeTotal}\n` +
    `正確率：${accuracy}%\n\n` +
    `想再玩一次請輸入：/quiz5`
  );
}

// -----------------------------
// Subscriber + daily push state
// -----------------------------
async function getSubscribers() {
  return await getPushSubscribers();
}

async function registerSubscriber(userId) {
  const inserted = await upsertPushSubscriber(userId);
  if (inserted) {
    console.log(`[subscriber] Registered userId: ${userId}`);
  }
}

function getDailyPushState() {
  const state = readJsonFile(DAILY_PUSH_STATE_PATH, {
    lastRunDate: "",
    sentByDate: {},
  });

  if (!state || typeof state !== "object") {
    return { lastRunDate: "", sentByDate: {} };
  }
  if (!state.sentByDate || typeof state.sentByDate !== "object") {
    state.sentByDate = {};
  }
  if (typeof state.lastRunDate !== "string") {
    state.lastRunDate = "";
  }
  return state;
}

function saveDailyPushState(state) {
  writeJsonFile(DAILY_PUSH_STATE_PATH, state);
}

function markUserPushAttempt(state, dateStr, userId, status, errorMessage = "") {
  if (!state.sentByDate[dateStr]) state.sentByDate[dateStr] = {};
  state.sentByDate[dateStr][userId] = {
    status,
    at: new Date().toISOString(),
    error: errorMessage || "",
  };
}

// -----------------------------
// Daily vocab generation
// -----------------------------
async function getOrCreateTodayVocab({ dateStr, count = DAILY_WORD_COUNT }) {
  const todayStr = dateStr || getTodayTaipeiDateStr();
  const theme = getThemeForDate(todayStr);

  const existing = await getTodayVocab({
    theme,
    dateStr: todayStr,
    limit: count,
  });

  let items = [...existing];

  const recentWords = await getRecentSentWords({
    days: LOOKBACK_DAYS,
    source: "today",
  });

  const usedWords = new Set(recentWords.map(normalizeWordKey).filter(Boolean));

  for (const item of items) {
    const key = normalizeWordKey(item && item.word);
    if (key) usedWords.add(key);
  }

  let retryRound = 0;
  while (items.length < count && retryRound < MAX_RETRY_ROUNDS) {
    retryRound++;

    const need = count - items.length;
    const requestCount = Math.max(need * 2, need);

    const generated = await generateVocab({
      theme,
      count: requestCount,
      bannedWords: Array.from(usedWords),
    });

    const freshItems = pickFreshVocabItems(generated, usedWords, need);
    if (freshItems.length === 0) continue;

    await appendVocabRows(freshItems, { source: "today" });
    items = items.concat(freshItems);
  }

  if (items.length < count) {
    console.warn(`[today] vocab not full after retries: got ${items.length}/${count}`);
  }

  return { dateStr: todayStr, theme, items };
}

function buildTodayVocabText(theme, items) {
  const safeTheme = String(theme || "").trim() || "未分類";
  const list = Array.isArray(items) ? items : [];

  const blocks = list.map((item) => {
    const word = String(item?.word || "").trim();
    const pos = String(item?.pos || "").trim();
    const zh = String(item?.zh || "").trim();
    const example = String(item?.example || item?.example_en || "").trim();
    const exampleZh = String(item?.example_zh || "").trim();
    if (!word && !pos && !zh && !example && !exampleZh) return "";

    const firstLine = pos ? `📘 ${word}（${pos}）` : `📘 ${word}`;
    const lines = [firstLine];

    if (zh) lines.push(`中文：${zh}`);
    if (example) lines.push(`例句：${example}`);
    if (exampleZh) lines.push(`翻譯：${exampleZh}`);

    return lines.join("\n");
  });

  return [`🌟 今日單字（${safeTheme}）`, ...blocks.filter(Boolean)].join("\n\n");
}

// -----------------------------
// LINE config + app
// -----------------------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET");
  process.exit(1);
}

const app = express();
const client = new Client(config);

// -----------------------------
// Daily push scheduler
// -----------------------------
async function runDailyPushForToday(dateStr) {
  const state = getDailyPushState();
  const subscribers = await getSubscribers();

  console.log(`[daily-push] start date=${dateStr}, subscribers=${subscribers.length}`);

  if (subscribers.length === 0) {
    console.log("[daily-push] no subscribers, skip");
    return;
  }

  const { theme, items } = await getOrCreateTodayVocab({
    dateStr,
    count: DAILY_WORD_COUNT,
  });

  if (!items || items.length === 0) {
    console.log("[daily-push] no vocab available, skip push");
    return;
  }

  const text = buildTodayVocabText(theme, items).slice(0, 4900);

  for (const userId of subscribers) {
    if (state.sentByDate?.[dateStr]?.[userId]) {
      console.log(`[daily-push] skip already attempted user=${userId} date=${dateStr}`);
      continue;
    }

    try {
      await client.pushMessage(userId, { type: "text", text });
      markUserPushAttempt(state, dateStr, userId, "success");
      console.log(`[daily-push] success user=${userId} date=${dateStr}`);
    } catch (err) {
      const msg = err?.message || String(err);
      markUserPushAttempt(state, dateStr, userId, "failed", msg);
      console.error(`[daily-push] failed user=${userId} date=${dateStr}: ${msg}`);
    }
  }

  saveDailyPushState(state);
}

async function tryRunDailyPushSchedulerTick() {
  const now = getTaipeiNowParts();
  if (now.hour !== DAILY_PUSH_HOUR || now.minute !== DAILY_PUSH_MINUTE) return;

  const state = getDailyPushState();
  if (state.lastRunDate === now.dateStr) return;

  state.lastRunDate = now.dateStr;
  saveDailyPushState(state);

  try {
    await runDailyPushForToday(now.dateStr);
  } catch (err) {
    console.error("[daily-push] unexpected error:", err);
  }
}

function startDailyPushScheduler() {
  console.log(
    `[daily-push] scheduler started at ${String(DAILY_PUSH_HOUR).padStart(2, "0")}:${String(DAILY_PUSH_MINUTE).padStart(2, "0")} (${TAIPEI_TIMEZONE})`
  );

  void tryRunDailyPushSchedulerTick();
  setInterval(() => {
    void tryRunDailyPushSchedulerTick();
  }, 30 * 1000);
}

// -----------------------------
// Routes
// -----------------------------
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    console.log("Received LINE webhook:", JSON.stringify(req.body, null, 2));
    const events = req.body?.events || [];

    if (events.length === 0) return res.status(200).end();

    await Promise.all(events.map(handleEvent));
    return res.status(200).end();
  } catch (err) {
    console.error("Error handling webhook:", err);
    return res.status(500).end();
  }
});

app.post("/jobs/daily-push", async (req, res) => {
  try {
    const providedToken = req.headers["x-job-token"];
    const expectedToken = process.env.DAILY_PUSH_JOB_TOKEN;

    if (!expectedToken || providedToken !== expectedToken) {
      console.warn("[daily-push] manual trigger unauthorized");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const dateStr = getTodayTaipeiDateStr();
    await runDailyPushForToday(dateStr);

    return res.status(200).json({ ok: true, dateStr });
  } catch (err) {
    console.error("[daily-push] manual trigger failed:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
});

// -----------------------------
// Message handler
// -----------------------------
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  const userId = event.source.userId;

  console.log("User input:", userText);

  try {
    await registerSubscriber(userId);
  } catch (err) {
    console.error("[subscriber] register failed:", err);
  }

  // /today
  if (userText === "/today") {
    try {
      const { theme, items } = await getOrCreateTodayVocab({
        count: DAILY_WORD_COUNT,
      });

      if (!items || items.length === 0) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "Today vocab is not ready yet. Please try again later.",
        });
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: buildTodayVocabText(theme, items).slice(0, 4900),
      });
    } catch (err) {
      console.error("Error on /today:", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "Failed to build today vocab. Please try again later.",
      });
    }
  }

  // /quiz5
  if (userText === "/quiz5") {
    try {
      const vocabItems = await getAllVocab();

      if (!vocabItems || vocabItems.length < 5) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "Not enough vocab to start a 5-question quiz.",
        });
      }

      const questions = buildQuizQuestions(vocabItems, 5);
      quizSessions.set(userId, { questions, current: 0, correct: 0 });

      return client.replyMessage(
        event.replyToken,
        buildQuizQuestionMessage(questions[0], 0, questions.length)
      );
    } catch (err) {
      console.error("Error handling /quiz5:", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "Failed to start quiz. Please try again later.",
      });
    }
  }

  // quiz answer mode
  if (quizSessions.has(userId)) {
    const session = quizSessions.get(userId);
    const q = session.questions[session.current];

    const ansIndex = ["A", "B", "C", "D"].indexOf(userText.toUpperCase());
    if (ansIndex === -1) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請用 A、B、C 或 D 作答。",
      });
    }

    const chosen = q.options[ansIndex];
    let feedback = "";

    if (chosen === q.answer) {
      session.correct++;
      feedback = buildQuizFeedbackText(true, q.answer, q.zh);
    } else {
      feedback = buildQuizFeedbackText(false, q.answer, q.zh);

      try {
        await appendWrongAnswers([
          {
            userId,
            word: q.word,
            zh: q.zh,
            chosen,
            is_correct: false,
            question_zh: q.zh,
            options: q.options,
            quiz_type: "/quiz5",
          },
        ]);
      } catch (err) {
        console.error("Failed to append wrong answer:", err);
      }
    }

    session.current++;

    if (session.current >= session.questions.length) {
      quizSessions.delete(userId);
      const summaryText = buildQuizSummaryText(session.correct, session.questions.length);

      return client.replyMessage(event.replyToken, [
        { type: "text", text: feedback },
        { type: "text", text: summaryText },
      ]);
    }

    const nextQ = session.questions[session.current];
    const nextMsg = buildQuizQuestionMessage(nextQ, session.current, session.questions.length);

    return client.replyMessage(event.replyToken, [
      { type: "text", text: feedback },
      nextMsg,
    ]);
  }

  // word lookup mode
  if (isSingleEnglishWord(userText)) {
    try {
      const inputWord = userText.toLowerCase();
      const fromSheet = await findVocabByWord(inputWord);

      if (fromSheet) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: buildLookupWordText(fromSheet).slice(0, 4900),
        });
      }

      const { lineText, item } = await lookupWord(inputWord);

      if (item) {
        const exists = await checkWordExists(item.word);
        if (!exists) {
          console.log(`New lookup word appended: ${item.word}`);
          await appendVocabRows([item], { source: "lookup" });
        } else {
          console.log(`Lookup word already exists: ${item.word}`);
        }
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: (item ? buildLookupWordText(item) : lineText).slice(0, 4900),
      });
    } catch (err) {
      console.error("Error looking up word:", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "Word lookup failed. Please try again later.",
      });
    }
  }

  // fallback help
  const helpText =
    "I am your English vocab bot.\n\n" +
    "Commands:\n" +
    "- /today : get today's vocab list\n" +
    "- /quiz5 : start a 5-question quiz\n" +
    "- send one English word to look it up";

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: helpText,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LINE webhook server is running on port ${PORT}`);
  console.log(`Local test URL: http://localhost:${PORT}/ (POST /webhook for LINE)`);
  startDailyPushScheduler();
});
