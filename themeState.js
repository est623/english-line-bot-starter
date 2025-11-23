// themeState.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 這三行是為了在 ES module 裡拿到目前資料夾位置
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 記錄狀態的小本子（會放在專案根目錄）
const STATE_PATH = path.join(__dirname, "state.json");

// 你想要輪流的主題清單（可以自己改順序或新增）
export const THEMES = [
  "daily life",
  "travel",
  "school",
  "work",
  "health",
  "small talk",
  "food",
  "email",
  "presentation",
  "customer service",
];

/**
 * 給某一天決定主題：
 * - 同一天重複呼叫，會回傳同一個主題
 * - 換了一天，才會往後進一格
 */
export function getThemeForDate(dateStr) {
  let lastIndex = -1;
  let lastDate = null;

  if (fs.existsSync(STATE_PATH)) {
    try {
      const raw = fs.readFileSync(STATE_PATH, "utf8");
      const state = JSON.parse(raw);
      if (typeof state.lastIndex === "number") lastIndex = state.lastIndex;
      if (typeof state.lastDate === "string") lastDate = state.lastDate;
    } catch (e) {
      console.warn("⚠ 讀取 state.json 失敗，從頭開始輪主題");
    }
  }

  let index;
  if (lastDate === dateStr && lastIndex >= 0) {
    // 同一天 → 用上次的主題
    index = lastIndex;
  } else {
    // 新的一天 → 主題往後跳一格
    index = (lastIndex + 1 + THEMES.length) % THEMES.length;
  }

  const theme = THEMES[index];

  // 更新小本子
  const newState = { lastIndex: index, lastDate: dateStr };
  fs.writeFileSync(STATE_PATH, JSON.stringify(newState), "utf8");

  console.log(`📚 getThemeForDate：${dateStr} → 使用主題「${theme}」（index=${index}）`);
  return theme;
}