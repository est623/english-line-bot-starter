// themeState.js
// ✅ 不再使用 state.json，不需要 fs / path
// ✅ 只根據日期字串 (YYYY-MM-DD) 來決定今天的主題
// ✅ 同一天呼叫多次 → 一樣的主題
// ✅ 換一天 → 自動輪到下一個主題（繞一圈再回來）

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

// 👇 起始日期：代表「這一天」會對應到 THEMES[0]（也就是 daily life）
// 之後每過一天，就往下一個主題輪。
// 你可以改成你想要的起算日（格式一定要是 YYYY-MM-DD）
const START_DATE = "2025-11-01";

/**
 * 給某一天決定主題（純用日期計算，不用存檔）：
 * - 同一天重複呼叫 → 一樣的主題
 * - 換一天 → 根據「起始日到今天過了幾天」決定輪到哪一個主題
 *
 * @param {string} dateStr - 例如 "2025-11-27"（建議用你在 /today 裡的台灣日期）
 * @returns {string} theme - 例如 "daily life" / "travel" ...
 */
export function getThemeForDate(dateStr) {
  // 把 YYYY-MM-DD 轉成 UTC 的整數時間，避免時區亂跑
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const [sy, sm, sd] = START_DATE.split("-").map((n) => parseInt(n, 10));

  const dateUtc = Date.UTC(y, m - 1, d);
  const startUtc = Date.UTC(sy, sm - 1, sd);

  const diffMs = dateUtc - startUtc;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // 允許 diffDays 為負數，所以這邊做一個安全的取模
  const index =
    ((diffDays % THEMES.length) + THEMES.length) % THEMES.length;

  const theme = THEMES[index];

  console.log(
    `📚 getThemeForDate：${dateStr} → 使用主題「${theme}」（index=${index}, diffDays=${diffDays})`
  );

  return theme;
}
