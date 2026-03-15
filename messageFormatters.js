export function buildLookupWordText(item) {
  const word = String(item?.word || "").trim() || "(unknown)";
  const pos = String(item?.pos || "").trim();
  const zh = String(item?.zh || "").trim();
  const cefr = String(item?.cefr || "").trim();
  const example = String(item?.example || item?.example_en || "").trim();
  const exampleZh = String(item?.example_zh || "").trim();

  const lines = ["📚 單字查詢", ""];
  lines.push(pos ? `🔤 ${word}（${pos}）` : `🔤 ${word}`);
  lines.push(`中文：${zh || "（暫無資料）"}`);
  if (cefr) {
    lines.push(`等級：${cefr}`);
  }

  if (example) {
    lines.push("", "📝 例句：", example);
  }

  if (exampleZh) {
    lines.push("", "💬 翻譯：", exampleZh);
  }

  return lines.join("\n");
}

