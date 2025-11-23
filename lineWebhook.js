// lineWebhook.js
import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import { lookupWord } from "./dictionaryClient.js";
import { generateVocab } from "./vocabGenerator.js";
import { getTodayVocab, appendVocabRows } from "./googleSheetClient.js";
import { getThemeForDate } from "./themeState.js";

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

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  console.log("👤 使用者輸入：", userText);

  // 1️⃣ 指令模式：/today
  // 1️⃣ 指令模式：/today
  if (userText === "/today") {
    const COUNT_PER_DAY = 5;

    try {
      const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // ✅ 問「主題管理員」：今天到底用哪一個主題
      const THEME = getThemeForDate(todayStr);

      // 然後用這個主題，去試算表找今天的單字
      const existing = await getTodayVocab({
        theme: THEME,
        dateStr: todayStr,
        limit: COUNT_PER_DAY,
      });

      let items = [...existing];

      // 如果還不夠 5 個，就跟 Gemini 要「缺的數量」，然後寫回試算表
      if (items.length < COUNT_PER_DAY) {
        const need = COUNT_PER_DAY - items.length;

        const newItems = await generateVocab({
          theme: THEME,
          count: need,
          bannedWords: items.map((i) => i.word),
        });

        // 寫進試算表，source 標記為 "today"
        await appendVocabRows(newItems, { source: "today" });

        items = items.concat(newItems);
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

  // 2️⃣ 查單字模式：單一英文單字
  if (isSingleEnglishWord(userText)) {
    try {
      const { lineText, item } = await lookupWord(userText.toLowerCase());

      // 先回覆給使用者
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: lineText.slice(0, 4900)
      });

      // 只有真的單字才寫入試算表
      if (item) {
        await appendVocabRows([item], { source: "lookup" });
      }

      return;
    } catch (err) {
      console.error("查單字時發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "😵 查單字時發生錯誤，可以稍後再試一次。"
      });
    }
  }



  // 3️⃣ 其他訊息：簡單提示
  const helpText =
    '嗨，我是你的英文單字小幫手 👋\n\n' +
    '你可以這樣跟我互動：\n' +
    '• 輸入 /today　→ 給你 5 個今日主題單字（會記錄在試算表）\n' +
    '• 輸入一個英文單字（例如：abandon）→ 查意思＋同義字＋例句\n';

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: helpText
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE webhook server is running on port ${PORT}`);
  console.log(`   現在在本機 http://localhost:${PORT}/ ，一律用 POST /webhook 接 LINE`);
});
