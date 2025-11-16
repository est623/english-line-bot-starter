// botServer.js — LINE Bot + Gemini 單字
import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import { generateVocab } from "./vocabGenerator.js";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();

// Webhook 入口
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).end();
});

// 處理每一個事件
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const text = (event.message.text || "").trim().toLowerCase();

  // 打招呼
  if (text === "hi" || text === "hello" || text === "哈囉") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "嗨～我是你的英文單字 Bot，要看單字可以輸入：單字 或 vocab 或 /today",
    });
  }

  // 要求單字
  if (text === "單字" || text === "vocab" || text === "/today") {
    try {
      const items = await generateVocab({
        theme: "travel",   // 之後可以做指令切換 daily life / work...
        count: 5,
        bannedWords: [],
      });

      const lines = items.map((w, i) =>
        `${i + 1}. ${w.word} (${w.pos}) - ${w.zh}\n` +
        `   ${w.example}\n` +
        `   ${w.example_zh}`
      );

      const message = "今天的單字：\n\n" + lines.join("\n\n");

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: message.slice(0, 4000), // LINE 有訊息長度限制，保險一點
      });
    } catch (err) {
      console.error("生成單字失敗：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "抱歉，我現在生單字失敗了 QQ 稍後再試一次。",
      });
    }
  }

  // 其他指令，看不懂就回提示
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "我看不太懂這個指令 ><\n想看單字請傳：單字 或 vocab 或 /today",
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE bot server running on http://localhost:${port}`);
});
