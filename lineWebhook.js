// lineWebhook.js
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
  appendWrongAnswers, // ?? ?啣?嚗憿神??
  getPushSubscribers,
  upsertPushSubscriber,
} from "./googleSheetClient.js";
import { getThemeForDate } from "./themeState.js";

// ?脣?雿輻??皜祇????
const quizSessions = new Map();
// userId -> { questions: [...], current: 0, correct: 0 }

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 撱箇?皜祇?憿嚗?銝剜??貉??
function buildQuizQuestions(vocabItems, count = 5) {
  const questions = [];

  // ?蕪????word / zh ?芾???
  const pool = vocabItems.filter((v) => v && v.word && v.zh);

  // ?冽??賢閬?憿
  const picked = shuffle([...pool]).slice(0, count);

  for (const item of picked) {
    const correct = item.word;

    // ??銝隞賬????航炊蝑?皜??
    const wrongCandidates = Array.from(
      new Set(
        pool
          .filter((v) => v.word !== correct) // 銝頝迤閫??璅?
          .map((v) => v.word)
      )
    );

    // ??3 ???
    const wrongWords = shuffle(wrongCandidates).slice(0, 3);

    // 甇?圾 + ?航炊?賊?
    let options = [correct, ...wrongWords];
    options = shuffle(options);

    // 靽璈嚗???蝔格芰?瘜???options 鋆⊥??迤閫??撠勗撥?嗅??
    if (!options.includes(correct)) {
      options[0] = correct;
      options = shuffle(options);
    }

    questions.push({
      zh: item.zh, // 憿憿舐內?葉??
      word: correct, // 甇?Ⅱ?望?
      options, // ???
      answer: correct, // 甇?圾嚗靘??
    });
  }

  return questions;
}

// ?Ｙ????柴??舐隞塚??嫣噶??雿輻嚗?
function buildQuizQuestionMessage(q, index, total) {
  const text = `蝚?${index + 1} 憿?/ ??${total} 憿?
??{q.zh}??甇?Ⅱ?望??臬銝??

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DAILY_PUSH_STATE_PATH = path.join(__dirname, "dailyPushState.json");
const TAIPEI_TIMEZONE = "Asia/Taipei";
const DAILY_PUSH_HOUR = 7;
const DAILY_PUSH_MINUTE = 0;
const DAILY_WORD_COUNT = 5;
const LOOKBACK_DAYS = 30;
const MAX_RETRY_ROUNDS = 5;

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
function markUserPushAttempt(state, dateStr, userId, status, errorMessage = "") {
  if (!state.sentByDate[dateStr]) state.sentByDate[dateStr] = {};
  state.sentByDate[dateStr][userId] = {
    status,
    at: new Date().toISOString(),
    error: errorMessage || "",
  };
}

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
    console.warn(
      `[today] vocab not full after retries: got ${items.length}/${count}`
    );
  }

  return { dateStr: todayStr, theme, items };
}

function buildTodayVocabText(theme, items) {
  const lines = [`Today vocab (${theme})`];
  for (const item of items) {
    lines.push(
      `\n- ${item.word} (${item.pos || ""})`,
      `ZH: ${item.zh || ""}`,
      `Example: ${item.example || item.example_en || ""}`,
      `${item.example_zh || ""}`
    );
  }
  return lines.join("\n");
}

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
    `[daily-push] scheduler started at ${DAILY_PUSH_HOUR.toString().padStart(2, "0")}:${DAILY_PUSH_MINUTE.toString().padStart(2, "0")} (${TAIPEI_TIMEZONE})`
  );

  void tryRunDailyPushSchedulerTick();
  setInterval(() => {
    void tryRunDailyPushSchedulerTick();
  }, 30 * 1000);
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("??蝻箏? LINE_CHANNEL_ACCESS_TOKEN ??LINE_CHANNEL_SECRET嚗?瑼Ｘ .env");
  process.exit(1);
}

const app = express();
const client = new Client(config);

app.post("/webhook", middleware(config), async (req, res) => {
  try {
    console.log("???嗅 LINE webhook嚗?, JSON.stringify(req.body, null, 2));
    const events = (req.body && req.body.events) ? req.body.events : [];

    if (events.length === 0) {
      return res.status(200).end();
    }

    await Promise.all(events.map(handleEvent));
    return res.status(200).end();
  } catch (err) {
    console.error("?? webhook ??隤歹?", err);
    return res.status(500).end();
  }
});

// ?斗?臭??胯銝?望??桀???
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
function isSingleEnglishWord(text) {
  return /^[A-Za-z\-]+$/.test(text.trim());
}


async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  console.log("? 雿輻?撓?伐?", userText);
  const userId = event.source.userId; // 蝯曹??券ㄐ摰??
  try {
    await registerSubscriber(userId);
  } catch (err) {
    console.error("[subscriber] register failed:", err);
  }

  // 1儭 ?誘璅∪?嚗?today
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

  // 2儭 ?誘璅∪?嚗?quiz5 ???冽???5 憿?
  if (userText === "/quiz5") {
    try {
      const vocabItems = await getAllVocab();

      if (!vocabItems || vocabItems.length < 5) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "?必 憿澈銝雲 5 憿??⊥???皜祇?",
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
      console.error("?? /quiz5 ?潛??航炊嚗?, err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "? ?Ｙ?皜祇???隤歹??臭誑蝔??岫銝甈～?,
      });
    }
  }

  // 3儭 皜祇?雿?璅∪?嚗?摰??曉?亙摮???嚗?
  if (quizSessions.has(userId)) {
    const session = quizSessions.get(userId);
    const q = session.questions[session.current];

    const ansIndex = ["A", "B", "C", "D"].indexOf(userText.toUpperCase());
    if (ansIndex === -1) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "隢 A / B / C / D 雿???",
      });
    }

    const chosen = q.options[ansIndex];

    let feedback = "";
    if (chosen === q.answer) {
      session.correct++;
      feedback = `??蝑?鈭?${q.answer} = ${q.zh}`;
    } else {
      feedback = `??蝑鈭?甇?Ⅱ蝑??荔?${q.answer}嚗?{q.zh}嚗;

      // ?? ?啣?嚗憿神??WrongAnswers
      try {
        await appendWrongAnswers([
          {
            userId,
            word: q.word,
            zh: q.zh,
            chosen, // 雿輻??啁??航炊蝑?
            is_correct: false,
            question_zh: q.zh,
            options: q.options,
            quiz_type: "/quiz5",
          },
        ]);
      } catch (err) {
        console.error("撖怠?舫?蝝?隤歹?", err);
      }
    }

    session.current++;

    // 撌脩?雿?摰?敺?憿?
    if (session.current >= session.questions.length) {
      quizSessions.delete(userId);

      const summaryText = `?? 皜祇?蝯?嚗?

??5 憿?雿?撠? ${session.correct} 憿?
甇?Ⅱ??${Math.round((session.correct / 5) * 100)}%

頛詨 /quiz5 ??銝甈∪嚗;

      return client.replyMessage(event.replyToken, [
        { type: "text", text: feedback },
        { type: "text", text: summaryText },
      ]);
    }

    // ??銝?憿???閬?憿????銝?憿?
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

  // 4儭 ?亙摮芋撘??桐??望??桀?
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
          console.log(`?? ?啣摮?撖怠閰衣?銵???${item.word}`);
          await appendVocabRows([item], { source: "lookup" });
        } else {
          console.log(`??撌脣??剁?銝神????${item.word}`);
        }
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: (lineText + "\n\nsource: gemini").slice(0, 4900),
      });
    } catch (err) {
      console.error("?亙摮??潛??航炊嚗?, err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "? ?亙摮??潛??航炊嚗隞亦?敺?閰虫?甈～?,
      });
    }
  }

  // 5儭 ?嗡?閮嚗陛?格?蝷?
  const helpText =
    "?剁??雿??望??桀?撠鼠????\n\n" +
    "雿隞仿見頝?鈭?嚗n" +
    "??頛詨 /today???蝯虫? 5 ???乩蜓憿摮????閰衣?銵剁?\n" +
    "??頛詨 /quiz5 ???冽??? 5 憿摮?皜祇?\n" +
    "??頛詨銝??摮?靘?嚗bandon嚗? ?交????儔摮?靘\n";

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: helpText,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`?? LINE webhook server is running on port ${PORT}`);
  console.log(`   ?曉?冽璈?http://localhost:${PORT}/ 嚗?敺 POST /webhook ??LINE`);
  startDailyPushScheduler();
});

