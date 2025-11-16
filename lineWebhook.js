// lineWebhook.js
import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import { generateVocab } from "./vocabGenerator.js";   // ⭐ 加入你的生字功能

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

// Webhook endpoint
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    console.log("✅ 收到 LINE webhook：", JSON.stringify(req.body, null, 2));

    const events = (req.body && req.body.events) ? req.body.events : [];
    if (events.length === 0) return res.status(200).end();

    await Promise.all(events.map(handleEvent));
    return res.status(200).end();
  } catch (err) {
    console.error("處理 webhook 時發生錯誤：", err);
    return res.status(500).end();
  }
});

// 處理每則 LINE event
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();

  // ================================
  // ⭐ 指令：/today → 回 5 個新單字
  // ================================
  if (userText === "/today") {
    try {
      const items = await generateVocab({
        theme: "travel",   // 可改 daily life / work / school / health…
        count: 5,
        bannedWords: []
      });

      // 排版好一點
      const replyText = items
        .map(
          (item, i) =>
            `${i + 1}. ${item.word} (${item.pos}) - ${item.zh}\n` +
            `${item.example}\n${item.example_zh}`
        )
        .join("\n\n");

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText,
      });
    } catch (err) {
      console.error("⚠️ 產生單字時發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "⚠️ 抱歉，產生單字時發生錯誤。請稍後再試！",
      });
    }
  }

  // ================================
  // ⭐ 其他訊息：回固定模板（你之前的版本）
  // ================================
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `You said: "${userText}"\nI'm your English vocab bot 👋`,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE webhook server is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}/ (POST /webhook)`);
});
