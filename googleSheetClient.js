// googleSheetClient.js
import "dotenv/config";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Vocabulary"; // 你的工作表名稱（底下那個分頁名）

if (!SPREADSHEET_ID) {
  console.error("❌ 缺少 GOOGLE_SHEET_ID，請在 .env / Render 環境變數設定");
  throw new Error("Missing GOOGLE_SHEET_ID");
}

// 建立 Google Sheets Client（重複呼叫時共用同一個 auth）
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
 * 把多筆單字 append 到試算表
 * items: [{
 *   theme, word, pos, zh, example, example_zh, cefr
 * }]
 * options.source: "today" / "lookup" / "manual" ...
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

  const range = `${SHEET_NAME}!A2:I`; // 從第二列開始往下加

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });

  console.log(`✅ 已寫入試算表 ${values.length} 筆（source=${source}）`);
}

/**
 * 讀出「某天、某主題」已經存在的單字
 * dateStr: "YYYY-MM-DD"（只比日期，不比時間）
 * limit: 最多回幾筆
 *
 * 回傳格式：
 * [{
 *   theme, word, pos, zh, example, example_zh, cefr, source, created_at
 * }]
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

    // 只比日期（前 10 碼）
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

  console.log(
    `📘 getTodayVocab：${dateStr} / ${theme} 讀到 ${results.length} 筆`
  );
  return results;
}
