/* 账单解析：微信 / 支付宝 CSV（含 zip 包与 JSON 备份）
 * 纯浏览器端，无依赖。暴露 window.BillParser
 */
(function (global) {
  "use strict";

  // ---------- 分类 ----------
  const CATS = ["餐饮", "生鲜日用", "网购", "服饰鞋包", "旅行", "交通", "通讯",
                "水电燃气", "居住", "数码订阅", "美容美发", "医疗健康", "娱乐",
                "人情往来", "转账红包", "还款", "退款", "其他"];

  // 关键词规则：越靠前优先级越高
  const RULES = [
    [/退款/, "退款"],
    [/得物金融|还款|信用卡|花呗|借呗|白条/, "还款"],
    [/得物/, "网购"],
    [/淘宝|天猫|拼多多|抖音电商|京东|唯品会|商城|小红书|苏宁/, "网购"],
    [/Soul|Apple|Steam|会员|订阅|充值|网易云|腾讯视频|爱奇艺|B站|哔哩/, "数码订阅"],
    [/禄泰|服饰|服装|衣|鞋|裤|裙|袜|帽|箱包|优衣库|耐克|阿迪/, "服饰鞋包"],
    [/水果|生鲜|超市|百货|便利店|蔬菜|牛羊肉|水产|粮油|零食|食品|土豆|马铃薯|猪肉|鸡蛋|菜市场/, "生鲜日用"],
    [/美团|饿了么|肯德基|麦当劳|餐饮|料理|熟食|火锅|汉堡|奶茶|咖啡|茶|面|米线|粉|菜|饭|小吃|蒸碗|烘焙|饼|包子|饺子|快餐|食堂|便当|詹记|古茗|星巴克|瑞幸/, "餐饮"],
    [/电信|移动|联通|话费|流量|宽带/, "通讯"],
    [/国家电网|电力|燃气|水务|电费|水费|物业|暖气/, "水电燃气"],
    [/房租|押金|公寓|住房|中介|家具|家居/, "居住"],
    [/携程|去哪儿|飞猪|旅行|缆车|旅行社|景区|酒店|民宿|机票|火车|中铁|12306|九华|滴滴出行|机票/, "旅行"],
    [/美发|理发|美容|美甲|护肤|化妆/, "美容美发"],
    [/医院|药|诊所|体检|口腔|挂号|疫苗/, "医疗健康"],
    [/电影|影院|KTV|游戏|网吧|演出|展览|健身|运动|球馆|图书馆/, "娱乐"],
    [/地铁|公交|打车|滴滴|加油|停车|单车|高速|出租车|铁路|航空/, "交通"],
    [/转账|红包|亲情卡|代付/, "转账红包"],
  ];

  // 支付宝自带「交易分类」，先按它映射，映射不到再走关键词
  const ALIPAY_CAT = {
    "餐饮美食": "餐饮", "交通出行": "交通", "日用百货": "生鲜日用",
    "服饰装扮": "服饰鞋包", "数码电器": "网购", "文化休闲": "娱乐",
    "医疗健康": "医疗健康", "住房物业": "居住", "充值缴费": "通讯",
    "转账红包": "转账红包", "投资理财": "其他", "信用借还": "还款",
    "退款": "退款", "酒店旅游": "旅行", "美容美发": "美容美发",
    "教育培训": "其他", "保险": "其他", "商业服务": "其他", "公共服务": "其他",
    "家居家装": "居住", "汽车相关": "交通", "运动户外": "娱乐", "母婴亲子": "其他",
    "宠物": "其他", "其他": "其他",
  };

  function baseCat(tx) {
    const hay = (tx.counterparty || "") + " " + (tx.item || "");
    for (const [re, cat] of RULES) if (re.test(hay)) return cat;
    return "其他";
  }

  function autoCat(tx) {
    const type = tx.type || "";
    if (ALIPAY_CAT[type]) return ALIPAY_CAT[type];
    if (tx.type === "转账") return "转账红包";
    if (/退款/.test(type) || /退款/.test(tx.status || "")) return "退款";
    return baseCat(tx);
  }

  const isRefund = (tx) => /退款/.test(tx.type || "") || /退款/.test(tx.status || "");

  // ---------- 字节解码 ----------
  function decodeBytes(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(u8.subarray(3));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(u8);
    } catch (e) { /* 不是合法 UTF-8，继续 */ }
    try {
      return new TextDecoder("gbk").decode(u8);
    } catch (e) { /* 浏览器不支持 gbk 时兜底 */ }
    return new TextDecoder("utf-8").decode(u8);
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const FIELDS = {
    time: [/^交易时间$/, /交易时间/, /创建时间/],
    direction: [/^收\/支$/, /收\/支/, /收支类型/, /资金流向/],
    amount: [/^金额$/, /金额/],
    counterparty: [/^交易对方$/, /交易对方/, /对方名称/, /商户名称/],
    item: [/商品说明/, /商品名称/, /^商品$/, /摘要/],
    type: [/交易分类/, /交易类型/],
    method: [/收\/付款方式/, /支付方式/, /付款方式/],
    status: [/交易状态/, /当前状态/, /状态/],
    id: [/交易单号/, /交易订单号/, /^订单号$/],
  };

  function findHeader(rows) {
    let best = { score: 0, index: -1, map: null };
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const cells = rows[i].map((c) => String(c).trim());
      const map = {};
      let score = 0;
      for (const [key, patterns] of Object.entries(FIELDS)) {
        for (const re of patterns) {
          const idx = cells.findIndex((c) => re.test(c));
          if (idx >= 0) { map[key] = idx; score++; break; }
        }
      }
      if (score > best.score) best = { score, index: i, map };
    }
    return best.score >= 3 ? best : null;
  }

  const clean = (v) => String(v == null ? "" : v).replace(/^\uFEFF/, "").replace(/^['"]+|['"]+$/g, "").trim();

  function parseAmount(v) {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? Math.abs(n) : NaN;
  }

  function normalizeTime(v) {
    const s = clean(v);
    const m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const p = (x) => String(x || "0").padStart(2, "0");
    return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${m[5] || "00"}:${m[6] || "00"}`;
  }

  function mapDirection(v) {
    const s = clean(v);
    if (/支出|付款|付费/.test(s)) return "支出";
    if (/收入|收款|入账/.test(s)) return "收入";
    if (/不计|其他|中性/.test(s)) return "其他";
    return "";
  }

  function detectSource(preamble, map) {
    const head = preamble.slice(0, 2000);
    if (/支付宝|alipay/i.test(head)) return "支付宝";
    if (/微信|wechat|财付通/i.test(head)) return "微信";
    if ("type" in map && "item" in map) return "支付宝";
    return "微信";
  }

  function hashId(tx) {
    const s = `${tx.time}|${tx.amount}|${tx.counterparty}|${tx.direction}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return "h" + Math.abs(h).toString(36);
  }

  function toTransactions(rows, fileName) {
    const header = findHeader(rows);
    if (!header) return { source: "未知", transactions: [], warnings: ["没找到表头（需要包含 交易时间 / 金额 / 收\/支 这类列）"] };

    const preamble = rows.slice(0, header.index).map((r) => r.join(" ")).join("\n");
    const source = detectSource(preamble, header.map);
    const warnings = [];
    const transactions = [];
    const get = (row, key) => (header.map[key] != null ? row[header.map[key]] : "");

    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const time = normalizeTime(get(row, "time"));
      const amount = parseAmount(get(row, "amount"));
      const direction = mapDirection(get(row, "direction"));
      if (!time || !Number.isFinite(amount) || !direction) continue;

      const tx = {
        id: clean(get(row, "id")) || "",
        source,
        time,
        direction,
        amount,
        counterparty: clean(get(row, "counterparty")),
        item: clean(get(row, "item")),
        type: clean(get(row, "type")),
        method: clean(get(row, "method")),
        status: clean(get(row, "status")),
      };
      if (!tx.id) tx.id = hashId(tx);
      tx.category = autoCat(tx);
      tx.refundCat = isRefund(tx) ? baseCat(tx) : null;
      transactions.push(tx);
    }
    if (!transactions.length) warnings.push(`${fileName} 里没解析出有效记录`);
    return { source, transactions, warnings };
  }

  // ---------- ZIP ----------
  function findEOCD(dv, len) {
    for (let i = len - 22; i >= Math.max(0, len - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("这个浏览器不支持解压 zip，请先把 zip 解压，再单独上传里面的 csv");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const eocd = findEOCD(dv, u8.length);
    if (eocd < 0) throw new Error("不是有效的 zip 文件");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      let name;
      try {
        name = new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(p + 46, p + 46 + nameLen));
      } catch (e) {
        name = new TextDecoder("gbk").decode(u8.subarray(p + 46, p + 46 + nameLen));
      }
      p += 46 + nameLen + extraLen + commentLen;
      if (!/\.(csv|txt)$/i.test(name)) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = u8.subarray(start, start + compSize);
      files.push({ name, method, data });
    }
    const out = [];
    for (const f of files) {
      out.push({ name: f.name, bytes: f.method === 0 ? f.data : await inflateRaw(f.data) });
    }
    return out;
  }

  // ---------- 对外入口 ----------
  async function parseBuffer(name, buffer) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".json")) {
      const data = JSON.parse(decodeBytes(buffer));
      const list = Array.isArray(data) ? data : data.transactions;
      if (!Array.isArray(list)) throw new Error("JSON 里没有 transactions 数组");
      return {
        results: [{
          source: "备份",
          transactions: list.map((t) => ({
            ...t,
            category: t.category || autoCat(t),
            refundCat: isRefund(t) ? baseCat(t) : null,
          })),
          warnings: [],
        }],
      };
    }
    if (lower.endsWith(".zip")) {
      const files = await unzip(buffer);
      if (!files.length) throw new Error("zip 里没找到 csv 文件");
      const results = [];
      for (const f of files) {
        results.push(toTransactions(parseCSV(decodeBytes(f.bytes)), f.name));
      }
      return { results };
    }
    return { results: [toTransactions(parseCSV(decodeBytes(buffer)), name)] };
  }

  global.BillParser = {
    CATS, RULES, autoCat, baseCat, isRefund,
    parseCSV, toTransactions, unzip, parseBuffer, decodeBytes, parseAmount, normalizeTime,
  };
})(typeof window !== "undefined" ? window : globalThis);
