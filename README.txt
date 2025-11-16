# english-line-bot-starter (超簡版)

這個專案只有一件事：**叫 OpenAI 產生單字，然後把結果印在畫面上**。
等你跑通後，再一步步接 Google Sheet / LINE Bot。

## 3 步跑起來
1. 下載並解壓縮這個資料夾，然後在 VS Code 打開它。
2. 在終端機輸入：
   npm init -y
   npm install openai dotenv
3. 複製 .env.example 成 .env，貼上你的 OPENAI_API_KEY。

最後執行：
   npm start
或：
   node index.js

### 可以改的地方
- index.js 裡的 `theme`（daily life / travel / school / work / health / small talk）
- `count` 需要幾個
- `bannedWords` 想避開的單字

跑通後告訴我，我們再加「寫回 Google Sheet」與「LINE 推播」。加油！
