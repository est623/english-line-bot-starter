import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);
const DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
];

const configuredModels = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const modelCandidates = configuredModels.length > 0 ? configuredModels : DEFAULT_MODELS;
const SIMPLIFIED_CHINESE_PATTERN =
  /[这为学习书买卖亚产亲仅从们价众优会传伤伦体俩债倾偿兰关兴养册写军农冲决况冻净凉减凤击划刘则刚创删别剂剑剧劝办务动励劳势华协单卢卫厂厅历厉压厌厕县参双发变叠叶号叹吗听启员呛呜咏响哑唤啧啬啸喷嚣团园围国图圣场坏块坚坛坝坟坠垄垒垦垫堕墙壮声壳壶处备复头夹夺奋奖妆妇妈娇娱娲娴婴婵婶孙宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝层届属屡岁岂岖岗岘岚岛岭峡峥峦币帅师帐带帮庄庆庐库应庙庞废广开异弃张弥弯弹强归当录彻径忆忧怀态怂怜总恋恳恶恼悦悬惊惧惨惩惫惬惭惯愤愿懒戆戏战户扎扑执扩扫扬扰抚抛抢护报担拟拢拣拥拦拧拨择挂挚挠挡挣挤挥捞损捡换捣据掳掷掺揽搀搁搂搅携摄摆摇摊撑撵撸攒敌敛数斋斩断无旧时旷昙昼显晒晓晕晖暂术机杀杂权条来杨极构枢枣枪枫柜柠标栈栋栏树样档桥桦桩梦检楼榄榈榉槛欢欧歼残殴毁毕毙气氢汇汉汤沟没沥沦沧沪泞泪泷泸泻泼泽洁洒浅浆浇浊测济浏浑浓涛涝涟涡涣涤润涧涨涩渊渍渎渐渔渗温湾湿溃溅满滤滥滦滨滩滚滞潇潍潜澜濒灭灯灵灾灿炉炖点炼炽烁烂烃烛烟烦烧烩烫烬热爱爷牵牺犊状犹狈狞独狭狮狱猎猪猫献玛环现玺珑琐琼瑶电画畅畴疗疟疠疡疮疯疱痈痉痒痪痫痴瘫瘾癞癣癫皱盏盐监盖盗睁睐睑瞒瞩矫矿码砖砚砺砾础硕确碍碱礼祷祸禄禅离秃秆种积称秽税稳穷窍窑窜窝窥窦竖竞笃笔笺笼筑筛筝筹签简类粪粮紧红纤约级纪纬纯纱纲纳纵纷纸纹纺线练组细织终绍经绑结绕绘给绝绞统绢绣继绩绪续绳维绵绷绸综绽绿缀缓缔缕编缘缚缝缠缤缩缴网罗罚罢羁翘耸耻聂聋职联聪肃肠肤肾肿胀胁胆胜胧胶脉脏脐脑脓脚脱脸腊腻腾舰舱艰艳艺节芜芦苇苍苏苹茎荐荚荡荣荤荧荨荫药莱莲获莹莺萝萤营萦萧萨葱蒋蓝蓦蔷蔼蕴虏虑虚虫虽虾蚀蚁蚂蚕蛊蛮蛰蝇蝈蝉蝎衅衔补衬袄袅袜袭装裤见观规觅视览觉觊觌觎觐觑触誉誊计订认讥讨让训议讯记讲许论讼讽设访诀证评识诈诉诊词试诗诚话诞诠询该详诫误诱诲说诵请诸诺读课谁调谅谈谊谋谐谓谢谣谦谨谜谱贝负贡财责贤败账货质贩贪贫贬购贮贯贰贵贷贸费贺贼资赋赌赏赐赔赖赚赛赞赠赢赶趋跃践踊踪蹿躏车转轮软轰轴轻载较辅辆辈辉输辑辖辕辞辩辫边辽达迁过迈运还进远违连迟适选逊递逻遗遥邓邮邻郑酱酿释鉴针钉钓钙钝钞钟钠钢钥钦钧钩钮钱钻铁铃铅铜铝铭银铸铺销锁锅锋错锚锡锣锤锦锭键锯锰镜镰长门闭问闯闲间闷闹闻阅阐阔队阳阴阵阶际陆陈陕陨险随隐难雾霁静韦韩韬页顶项顺须顾顿预领颇颈频颗题额颜颤风飞饭饮饰饱饼饿馆馈馋马驰驱驳驴驶驾骂骄验骏骑骗骚骤鱼鲜鲸鸟鸡鸣鸭鸽鸿鹅鹤鹰麦黄齐齿龄龙龟]/;

export function isGeminiLocationUnsupportedError(err) {
  const msg = String(err?.message || "");
  return msg.includes("User location is not supported for the API use");
}

function isModelNotFoundError(err) {
  const msg = String(err?.message || "");
  return msg.includes("is not found for API version") || msg.includes("[404 Not Found]");
}

function normalizeCefr(value) {
  const v = String(value || "").toUpperCase();
  return ["A1", "A2", "B1", "B2", "C1", "C2"].includes(v) ? v : "";
}

function buildPrompt({ theme, count, bannedWords }) {
  const bannedText = bannedWords.length
    ? `Do not use these words: ${bannedWords.slice(0, 2000).join(", ")}`
    : "Avoid repeating common textbook words.";

  return [
    "Generate TOEIC-friendly English vocabulary items for traditional Chinese learners.",
    "Use Traditional Chinese (Taiwan) only in the zh and example_zh fields.",
    "Never use Simplified Chinese characters. For example, use 學習, 單字, 這個, 為, 說, 讀, 寫, 聽, and 翻譯.",
    `Theme: ${theme}`,
    `Count: ${count}`,
    bannedText,
    "Output only plain lines in this exact format:",
    "word | pos | zh | example | example_zh | cefr",
    "The zh and example_zh fields must be Traditional Chinese, not Simplified Chinese.",
    "No numbering, no markdown, no extra text.",
    "CEFR must be one of A2, B1, B2.",
  ].join("\n");
}

function parseGeneratedText({ text, theme, count }) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) continue;

    const [word, pos, zh, example, example_zh, cefrRaw] = parts;
    if (!word) continue;

    items.push({
      theme,
      word,
      pos: pos || "",
      zh: zh || "",
      example: example || "",
      example_zh: example_zh || "",
      cefr: normalizeCefr(cefrRaw),
    });

    if (items.length >= count) break;
  }

  return items;
}

function assertTraditionalChinese(items) {
  const invalid = items.find((item) =>
    SIMPLIFIED_CHINESE_PATTERN.test(`${item.zh || ""}${item.example_zh || ""}`)
  );

  if (invalid) {
    const err = new Error(`Gemini returned Simplified Chinese output for word=${invalid.word}`);
    err.code = "SIMPLIFIED_CHINESE_OUTPUT";
    throw err;
  }
}

export async function generateVocab({ theme, count, bannedWords = [] }) {
  const prompt = buildPrompt({ theme, count, bannedWords });

  let lastErr = null;
  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent(prompt);
      const text = res.response.text().trim();
      const items = parseGeneratedText({ text, theme, count });
      if (items.length === 0) {
        throw new Error(`Gemini returned unparsable output (model=${modelName})`);
      }
      assertTraditionalChinese(items);
      console.log(`[gemini] success model=${modelName}, items=${items.length}`);
      return items;
    } catch (err) {
      lastErr = err;
      if (isGeminiLocationUnsupportedError(err)) throw err;
      if (isModelNotFoundError(err)) {
        console.warn(`[gemini] model unsupported: ${modelName}, trying next`);
        continue;
      }
      if (err?.code === "SIMPLIFIED_CHINESE_OUTPUT") {
        console.warn(`[gemini] rejected Simplified Chinese output: ${modelName}, trying next`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("Gemini generation failed on all model candidates");
}
