// lineWebhook.js
import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import { lookupWord } from "./dictionaryClient.js";
import { generateVocab } from "./vocabGenerator.js";

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

// 把查單字結果變成好看的文字
function formatDictionaryReply(info) {
  if (info.notFound) {
    return "😢 這個字我在字典裡查不到，可能不是常見英文單字，要不要確認一下拼字？";
  }
  if (info.error) {
    return "😵 查單字時解析回應失敗了，可以稍後再試一次，或換個單字看看。";
  }

  const lines = [];

  lines.push(`📚 Word: ${info.word || "（無）"}`);
  if (info.pos?.length) {
    lines.push(`詞性：${info.pos.join(" / ")}`);
  }
  if (info.zh) {
    lines.push(`中文：${info.zh}`);
  }

  if (info.definitions?.length) {
    lines.push("");
    lines.push("英文解釋：");
    lines.push(...info.definitions.map(d => `- ${d}`));
  }

  if (info.synonyms?.length) {
    lines.push("");
    lines.push("同義字：");
    lines.push(`- ${info.synonyms.join(", ")}`);
  }

  if (info.examples?.length) {
    lines.push("");
    lines.push("例句：");
    for (const ex of info.examples) {
      if (ex.en) {
        lines.push(`- ${ex.en}`);
        if (ex.zh) {
          lines.push(`  → ${ex.zh}`);
        }
      }
    }
  }

  return lines.join("\n");
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  console.log("👤 使用者輸入：", userText);

  // 1️⃣ 指令模式：/today
  if (userText === "/today") {
    try {
      // 這裡先簡單固定一個主題，你之後想改可以再調
      const items = await generateVocab({
        theme: "daily life",
        count: 5,
        bannedWords: []
      });

      const lines = ["📅 今日主題單字（daily life）："];
      for (const item of items) {
        lines.push(
          `\n🔹 ${item.word} (${item.pos})`,
          `中文：${item.zh}`,
          `例句：${item.example}`,
          `→ ${item.example_zh}`
        );
      }

      const replyText = lines.join("\n");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText.slice(0, 4900) // 防止超過 LINE 長度上限
      });
    } catch (err) {
      console.error("處理 /today 發生錯誤：", err);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "😢 產生今日單字時發生錯誤，可以稍後再試一次。"
      });
    }
  }

  // 2️⃣ 查單字模式：單一英文單字
  if (isSingleEnglishWord(userText)) {
    try {
      const info = await lookupWord(userText.toLowerCase());
      const replyText = formatDictionaryReply(info);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText.slice(0, 4900)
      });
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
    '• 輸入 /today　→ 給你 5 個今日主題單字\n' +
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
