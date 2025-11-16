import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

// 讓 __dirname 在 ES module 也能用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 你的 service account JSON（放在專案根目錄）
const KEY_FILE = path.join(__dirname, "service-account-key.json");

// 這裡記得換成你的 Google Sheet ID
// Spreadsheet URL: https://docs.google.com/spreadsheets/d/【這段字就是 ID】/edit
const SPREADSHEET_ID = "1EyUk_u_jwxCxc0_ZhYQhGVQ1BcOTHy-BpPi_5nFt0pw";

// 工作表名稱（通常是第一個分頁叫這個）
const SHEET_NAME = "vocab";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export async function appendVocabRows(items) {
  const sheets = await getSheetsClient();

  const values = items.map(item => [
    item.theme,
    item.word,
    item.pos,
    item.zh,
    item.example,
    item.example_zh,
    item.cefr,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:G`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log(`🌟 已寫入 Google Sheet：${items.length} 筆單字`);
}

// 想生哪個主題都可以改const themes = ["daily life","travel","school","work","health","small talk","food","email","presentation","customer service"];