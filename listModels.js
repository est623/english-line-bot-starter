// listModels.js
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ 缺少 GEMINI_API_KEY，請在 .env 設定");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  console.log("🔍 取得可用模型清單...\n");

  // 官方範例是這樣用 for await
  for await (const model of genAI.listModels()) {
    console.log(
      `name: ${model.name},\n  supported: ${model.supportedGenerationMethods?.join(", ")}\n`
    );
  }
}

main().catch(err => {
  console.error("發生錯誤：", err?.message || err);
});
