// CSV parsing for PayPay Card and Saison Card statements.
// Exposes window.CardsCSV = { parseFile, DEFAULT_RULES, DEFAULT_CATEGORIES, applyRules, makeId }.
(() => {
  const DEFAULT_CATEGORIES = [
    "食費", "交通", "娯楽", "公共料金", "日用品", "住居", "通信", "医療", "その他",
  ];

  const DEFAULT_RULES = [
    { match: "セブン", category: "食費" },
    { match: "ファミマ", category: "食費" },
    { match: "ファミリーマート", category: "食費" },
    { match: "ローソン", category: "食費" },
    { match: "スターバックス", category: "食費" },
    { match: "マクドナルド", category: "食費" },
    { match: "JR", category: "交通" },
    { match: "メトロ", category: "交通" },
    { match: "タクシー", category: "交通" },
    { match: "ENEOS", category: "交通" },
    { match: "Amazon", category: "日用品" },
    { match: "AMAZON", category: "日用品" },
    { match: "Netflix", category: "娯楽" },
    { match: "Spotify", category: "娯楽" },
    { match: "Apple", category: "娯楽" },
    { match: "東京電力", category: "公共料金" },
    { match: "東京ガス", category: "公共料金" },
    { match: "ガス", category: "公共料金" },
    { match: "水道", category: "公共料金" },
    { match: "ドコモ", category: "通信" },
    { match: "ソフトバンク", category: "通信" },
    { match: "au", category: "通信" },
    { match: "楽天モバイル", category: "通信" },
  ];

  // ---------- File reading with encoding detection ----------
  async function readAsText(file) {
    const buf = await file.arrayBuffer();
    // Try Shift_JIS first (most JP card CSVs); if it produces replacement chars, fall back to UTF-8.
    try {
      const sjis = new TextDecoder("shift_jis", { fatal: false }).decode(buf);
      if (!hasMojibake(sjis)) return sjis;
    } catch (_) { /* shift_jis unsupported */ }
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }

  function hasMojibake(s) {
    // U+FFFD or unusually high non-JP control char ratio suggests wrong decoding.
    if (s.includes("�")) return true;
    let bad = 0, total = 0;
    for (let i = 0; i < Math.min(s.length, 4000); i++) {
      const c = s.charCodeAt(i);
      total++;
      if (c < 0x09 || (c > 0x0d && c < 0x20)) bad++;
    }
    return total > 0 && bad / total > 0.02;
  }

  // ---------- CSV tokenization (RFC 4180-ish, tolerant) ----------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = false;
        } else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\r") { /* skip */ }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else cur += c;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(cell => cell && cell.trim()));
  }

  // ---------- Header detection ----------
  // Returns { headerIdx, columns: { date, merchant, amount } } or null.
  function detectHeader(rows) {
    const dateKeys = ["ご利用日", "ご利用年月日", "利用日", "利用年月日", "取引日"];
    const merchantKeys = ["ご利用店名", "ご利用先", "ご利用店", "利用店", "利用店名", "店舗名", "ご利用内容", "利用先"];
    const amountKeys = ["ご利用金額", "利用金額", "金額", "ご請求額", "利用額"];

    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const row = rows[r].map(s => (s || "").trim());
      const dIdx = findColumnIndex(row, dateKeys);
      const mIdx = findColumnIndex(row, merchantKeys);
      const aIdx = findColumnIndex(row, amountKeys);
      if (dIdx >= 0 && mIdx >= 0 && aIdx >= 0) {
        return { headerIdx: r, columns: { date: dIdx, merchant: mIdx, amount: aIdx } };
      }
    }
    return null;
  }

  function findColumnIndex(row, candidates) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      if (!cell) continue;
      for (const k of candidates) {
        if (cell.includes(k)) return i;
      }
    }
    return -1;
  }

  // ---------- Card type guess ----------
  function detectCardType(text, fileName) {
    const lower = (fileName || "").toLowerCase();
    if (lower.includes("paypay")) return "paypay";
    if (lower.includes("saison") || lower.includes("セゾン")) return "saison";
    const head = text.slice(0, 2000);
    if (head.includes("PayPayカード") || head.includes("ペイペイカード")) return "paypay";
    if (head.includes("セゾン") || head.includes("クレディセゾン") || head.includes("SAISON")) return "saison";
    return null; // caller will prompt
  }

  // ---------- Field normalization ----------
  function normalizeAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    // Convert full-width digits/symbols to half-width
    s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[，、]/g, ",");
    s = s.replace(/[¥￥]/g, "");
    s = s.replace(/円/g, "");
    s = s.replace(/\s+/g, "");
    let negative = false;
    if (s.startsWith("△") || s.startsWith("▲") || s.startsWith("-") || s.startsWith("−") || s.startsWith("ー")) {
      negative = true;
      s = s.slice(1);
    }
    if (s.startsWith("(") && s.endsWith(")")) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    let n = Math.round(Number(s));
    if (negative) n = -n;
    return n;
  }

  function normalizeDate(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    const parts = s.split("-").map(p => p.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    let [y, m, d] = parts;
    if (y.length === 2) {
      const yy = parseInt(y, 10);
      y = (yy >= 50 ? "19" : "20") + y.padStart(2, "0");
    }
    if (m.length === 1) m = "0" + m;
    if (d.length === 1) d = "0" + d;
    if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
    return `${y}-${m}-${d}`;
  }

  function normalizeMerchant(raw) {
    if (!raw) return "";
    return String(raw).trim().replace(/\s+/g, " ");
  }

  // ---------- Row → transaction ----------
  async function makeId(card, date, amount, merchant) {
    const data = `${card}|${date}|${amount}|${merchant}`;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
    return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function applyRules(merchant, rules) {
    for (const r of rules) {
      if (!r.match) continue;
      if (merchant.includes(r.match)) return r.category;
    }
    return "その他";
  }

  // ---------- Public: parseFile ----------
  // Returns { card, transactions: [...], skipped: number, error?: string }.
  async function parseFile(file, rules) {
    const text = await readAsText(file);
    const card = detectCardType(text, file.name);
    if (!card) {
      return { card: null, transactions: [], skipped: 0, error: "カード種別を判定できませんでした（ファイル名に paypay / saison を含めるか手動指定してください）" };
    }
    const rows = parseCsv(text);
    const head = detectHeader(rows);
    if (!head) {
      return { card, transactions: [], skipped: 0, error: "ヘッダ行（利用日／利用店／金額）を検出できませんでした" };
    }
    const { date: dCol, merchant: mCol, amount: aCol } = head.columns;
    const out = [];
    let skipped = 0;
    for (let r = head.headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const date = normalizeDate(row[dCol]);
      const merchant = normalizeMerchant(row[mCol]);
      const amount = normalizeAmount(row[aCol]);
      if (!date || !merchant || amount == null || amount === 0) { skipped++; continue; }
      const id = await makeId(card, date, amount, merchant);
      const category = applyRules(merchant, rules || DEFAULT_RULES);
      out.push({
        id, card, date, amount, merchant,
        category, categorySource: "rule", note: "",
      });
    }
    return { card, transactions: out, skipped };
  }

  window.CardsCSV = { parseFile, DEFAULT_RULES, DEFAULT_CATEGORIES, applyRules, makeId };
})();
