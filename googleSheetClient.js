// googleSheetClient.js
import "dotenv/config";
import { google } from "googleapis";


const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Vocabulary"; // 你的工作表名稱
const WRONG_SHEET_NAME = "WrongAnswers"; // 👈 新增這行


if (!SPREADSHEET_ID) {
  console.error("❌ 缺少 GOOGLE_SHEET_ID，請在 .env / Render 環境變數設定");
  throw new Error("Missing GOOGLE_SHEET_ID");
}

// 建立 Google Sheets Client（共用）
let _sheets = null;

async function getSheets() {
  if (_sheets) return _sheets;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("❌ 缺少 GOOGLE_SERVICE_ACCOUNT_JSON，請在環境變數放 service account JSON");
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    console.error("❌ 無法解析 GOOGLE_SERVICE_ACCOUNT_JSON，請確認格式是否為合法 JSON");
    throw e;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  _sheets = google.sheets({ version: "v4", auth: client });
  return _sheets;
}

/**
 * 🟦 寫入多筆單字到試算表
 */
export async function appendVocabRows(items, options = {}) {
  const sheets = await getSheets();

  const nowIso = new Date().toISOString();
  const source = options.source || "";

  const values = items.map((item) => [
    item.theme || "",
    item.word || "",
    item.pos || "",
    item.zh || "",
    item.example || item.example_en || "",
    item.example_zh || "",
    item.cefr || "",
    source,
    nowIso,
  ]);

  const range = `${SHEET_NAME}!A2:I`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log(`✅ 已寫入試算表 ${values.length} 筆（source=${source}）`);
}

/**
 * 🟦 讀取今天已經產生過的單字（給 /today 用）
 */
export async function getTodayVocab({ theme, dateStr, limit = 10 }) {
  const sheets = await getSheets();

  const range = `${SHEET_NAME}!A2:I`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = res.data.values || [];
  const results = [];

  for (const row of rows) {
    const [
      rowTheme,
      word,
      pos,
      zh,
      example,
      example_zh,
      cefr,
      source,
      created_at,
    ] = row;

    if (!rowTheme || !word) continue;
    if (rowTheme !== theme) continue;
    if (!created_at) continue;

    const rowDate = String(created_at).slice(0, 10);
    if (rowDate !== dateStr) continue;

    results.push({
      theme: rowTheme,
      word,
      pos,
      zh,
      example,
      example_zh,
      cefr,
      source,
      created_at,
    });

    if (results.length >= limit) break;
  }

  console.log(`📘 getTodayVocab：${dateStr} / ${theme} 讀到 ${results.length} 筆`);
  return results;
}

/**
 * 🟦 判斷某個單字是否已經存在於試算表（避免重複寫入）
 */
export async function checkWordExists(word) {
  const sheets = await getSheets();

  const range = `${SHEET_NAME}!B:B`; // B 欄：單字
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = res.data.values || [];

  // 跳過第一列（欄位名稱）
  return rows.some(
    (row, index) =>
      index > 0 &&
      row[0] &&
      row[0].trim().toLowerCase() === word.trim().toLowerCase()
  );
}

/**
 * 🟦 寫入錯題紀錄到 WrongAnswers 分頁
 */
/**
 * Find first vocabulary row by word (case-insensitive).
 */
export async function findVocabByWord(word) {
  const sheets = await getSheets();

  const target = (word || "").trim().toLowerCase();
  if (!target) return null;

  const range = `${SHEET_NAME}!A2:I`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = res.data.values || [];

  for (const row of rows) {
    const [theme, rowWord, pos, zh, example, example_zh, cefr, source, created_at] = row;
    if (!rowWord) continue;

    if (String(rowWord).trim().toLowerCase() === target) {
      return {
        theme: theme || "",
        word: rowWord || "",
        pos: pos || "",
        zh: zh || "",
        example: example || "",
        example_zh: example_zh || "",
        cefr: cefr || "",
        source: source || "",
        created_at: created_at || "",
      };
    }
  }

  return null;
}

export async function appendWrongAnswers(items) {
  const sheets = await getSheets();

  const nowIso = new Date().toISOString();

  const values = items.map((item) => [
    item.userId || "",
    item.word || "",
    item.zh || "",
    item.chosen || "",
    item.is_correct === true ? "TRUE" : "FALSE",
    item.question_zh || "",
    (item.options && item.options.join(" | ")) || "",
    item.quiz_type || "",
    item.created_at || nowIso,
  ]);

  const range = `${WRONG_SHEET_NAME}!A2:I`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log(`✅ 已寫入錯題 ${values.length} 筆到 WrongAnswers`);
}


/**
 * 🟦 讀取全部單字（給 /quiz5 用）
 */
export async function getAllVocab() {
  const sheets = await getSheets();

  const range = `${SHEET_NAME}!A2:I`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = res.data.values || [];

  return rows
    .filter(row => row[1]) // 避免空白行
    .map(row => {
      const [
        theme,
        word,
        pos,
        zh,
        example,
        example_zh,
        cefr,
        source,
        created_at,
      ] = row;

      return {
        theme,
        word,
        pos,
        zh,
        example,
        example_zh,
        cefr,
        source,
        created_at,
      };
    });
}

