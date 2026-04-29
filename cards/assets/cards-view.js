// Cards dashboard viewer.
// Reads ../data/cards.json.enc, decrypts with passphrase, renders KPIs/charts/table.
(() => {
  const DATA_URL = "../data/cards.json.enc";
  const PASS_KEY = "cards_passphrase";

  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => CardsCharts.formatYen(n);

  const state = {
    data: null,
    filter: { card: "all", category: "all", month: "all", q: "" },
    page: 1,
    pageSize: 50,
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindUnlockForm();
    bindFilters();
    const cached = sessionStorage.getItem(PASS_KEY);
    if (cached) {
      const ok = await tryLoad(cached);
      if (!ok) sessionStorage.removeItem(PASS_KEY);
    }
  }

  function bindUnlockForm() {
    const form = $("#unlock-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = $("#unlock-pass").value;
      const err = $("#unlock-err");
      err.textContent = "";
      const ok = await tryLoad(pass);
      if (ok) {
        sessionStorage.setItem(PASS_KEY, pass);
      } else {
        err.textContent = "復号できません。パスフレーズを確認してください。";
        $("#unlock-pass").select();
      }
    });
    $("#sign-out").addEventListener("click", (e) => {
      e.preventDefault();
      sessionStorage.removeItem(PASS_KEY);
      location.reload();
    });
  }

  async function tryLoad(passphrase) {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (res.status === 404) {
        // first run — show empty state
        showEmpty();
        return true;
      }
      if (!res.ok) throw new Error("fetch failed");
      const env = await res.json();
      const data = await CardsCrypto.decryptEnvelope(env, passphrase);
      state.data = data;
      showDashboard();
      render();
      return true;
    } catch (e) {
      return false;
    }
  }

  function showEmpty() {
    $("#unlock").classList.add("hidden");
    $("#dash").classList.remove("hidden");
    $("#dash-content").innerHTML =
      `<div class="empty-dash">明細がまだありません。<br>` +
      `<a href="admin.html" style="border-bottom:1px solid var(--line); font-style:normal;">管理者モードから CSV を取り込んでください</a></div>`;
  }

  function showDashboard() {
    $("#unlock").classList.add("hidden");
    $("#dash").classList.remove("hidden");
  }

  // ---------- Aggregations ----------
  function txInRange(txs, fromDate, toDate) {
    return txs.filter(t => t.date >= fromDate && t.date <= toDate);
  }

  function dailySeries(txs, days) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = [];
    const idx = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = isoDate(d);
      const row = { date: key, paypay: 0, saison: 0 };
      out.push(row);
      idx.set(key, row);
    }
    for (const t of txs) {
      const row = idx.get(t.date);
      if (row && t.amount > 0) row[t.card] = (row[t.card] || 0) + t.amount;
    }
    return out;
  }

  function monthlySeries(txs, monthsBack) {
    const today = new Date();
    const out = [];
    const idx = new Map();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = { month: key, paypay: 0, saison: 0 };
      out.push(row);
      idx.set(key, row);
    }
    for (const t of txs) {
      const m = t.date.slice(0, 7);
      const row = idx.get(m);
      if (row && t.amount > 0) row[t.card] = (row[t.card] || 0) + t.amount;
    }
    return out;
  }

  function categorySlices(txs) {
    const m = new Map();
    for (const t of txs) {
      if (t.amount <= 0) continue;
      m.set(t.category, (m.get(t.category) || 0) + t.amount);
    }
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---------- Render ----------
  function render() {
    if (!state.data) return;
    const txs = state.data.transactions || [];
    if (!txs.length) {
      $("#dash-content").innerHTML = `<div class="empty-dash">明細がまだありません。</div>`;
      return;
    }

    // Build content scaffold once
    if (!$("#kpi-row")) buildScaffold();

    renderKpis(txs);
    renderDaily(txs);
    renderMonthly(txs);
    renderCategory(txs);
    renderTable(txs);
  }

  function buildScaffold() {
    $("#dash-content").innerHTML = `
      <div class="kpi-row" id="kpi-row"></div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title">日次推移（過去60日）</h2>
          <div class="chart-block__legend">
            <span><span class="legend__dot legend__dot--paypay"></span>PayPay</span>
            <span><span class="legend__dot legend__dot--saison"></span>セゾン</span>
          </div>
        </div>
        <div class="chart-wrap">
          <svg class="chart-svg" id="chart-daily" aria-label="日次推移"></svg>
          <div class="chart-tip" id="tip-daily"></div>
        </div>
      </div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title">月別合計（直近12か月）</h2>
          <div class="chart-block__legend">
            <span><span class="legend__dot legend__dot--paypay"></span>PayPay</span>
            <span><span class="legend__dot legend__dot--saison"></span>セゾン</span>
          </div>
        </div>
        <svg class="chart-svg" id="chart-monthly" aria-label="月別合計"></svg>
      </div>

      <div class="two-col">
        <div class="chart-block">
          <div class="chart-block__head">
            <h2 class="chart-block__title">カテゴリ別（当月）</h2>
          </div>
          <svg class="chart-svg" id="chart-category" aria-label="カテゴリ別"></svg>
        </div>
        <div class="chart-block">
          <div class="chart-block__head">
            <h2 class="chart-block__title">カテゴリ ランキング（当月）</h2>
          </div>
          <ul class="cat-list" id="cat-list"></ul>
        </div>
      </div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title">明細</h2>
        </div>
        <div class="tx-controls" id="tx-controls"></div>
        <table class="tx-table" id="tx-table">
          <thead><tr>
            <th>日付</th><th>カード</th><th>店舗</th><th>カテゴリ</th><th style="text-align:right;">金額</th>
          </tr></thead>
          <tbody></tbody>
        </table>
        <div class="tx-pager" id="tx-pager"></div>
      </div>
    `;
    rebindFilterControls();
  }

  function renderKpis(txs) {
    const today = isoDate(new Date());
    const ymThis = today.slice(0, 7);
    const dPrev = new Date(); dPrev.setMonth(dPrev.getMonth() - 1);
    const ymPrev = `${dPrev.getFullYear()}-${String(dPrev.getMonth() + 1).padStart(2, "0")}`;

    const todaySpend = txs.filter(t => t.date === today && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const thisMonth = txs.filter(t => t.date.startsWith(ymThis) && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const prevMonth = txs.filter(t => t.date.startsWith(ymPrev) && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const paypayMonth = txs.filter(t => t.date.startsWith(ymThis) && t.card === "paypay" && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const saisonMonth = txs.filter(t => t.date.startsWith(ymThis) && t.card === "saison" && t.amount > 0).reduce((s, t) => s + t.amount, 0);

    const diff = thisMonth - prevMonth;
    const diffPct = prevMonth ? ((diff / prevMonth) * 100).toFixed(1) : null;
    const diffCls = diff > 0 ? "kpi__sub--up" : "kpi__sub--down";
    const diffSign = diff > 0 ? "+" : "";
    const diffSub = prevMonth
      ? `<span class="${diffCls}">前月比 ${diffSign}${fmt(diff)} (${diffSign}${diffPct}%)</span>`
      : `<span>前月データなし</span>`;

    $("#kpi-row").innerHTML = `
      <div class="kpi"><div class="kpi__label">今日の利用</div><div class="kpi__value">${fmt(todaySpend)}</div></div>
      <div class="kpi"><div class="kpi__label">今月合計</div><div class="kpi__value">${fmt(thisMonth)}</div><div class="kpi__sub">${diffSub}</div></div>
      <div class="kpi"><div class="kpi__label">PayPay 今月</div><div class="kpi__value">${fmt(paypayMonth)}</div></div>
      <div class="kpi"><div class="kpi__label">セゾン 今月</div><div class="kpi__value">${fmt(saisonMonth)}</div></div>
    `;
  }

  function renderDaily(txs) {
    const points = dailySeries(txs, 60);
    CardsCharts.renderLineDaily($("#chart-daily"), points, { tooltip: $("#tip-daily") });
  }

  function renderMonthly(txs) {
    const months = monthlySeries(txs, 12);
    CardsCharts.renderBarMonthly($("#chart-monthly"), months);
  }

  function renderCategory(txs) {
    const ymThis = isoDate(new Date()).slice(0, 7);
    const monthTx = txs.filter(t => t.date.startsWith(ymThis));
    const slicesAll = categorySlices(monthTx);
    // Donut: top 8, rest grouped as その他+
    const top = slicesAll.slice(0, 8);
    const rest = slicesAll.slice(8).reduce((s, x) => s + x.value, 0);
    const slices = rest > 0 ? [...top, { label: "他", value: rest }] : top;
    CardsCharts.renderDonutCategory($("#chart-category"), slices);

    // Ranking list
    const total = slicesAll.reduce((s, x) => s + x.value, 0) || 1;
    const list = $("#cat-list");
    list.innerHTML = "";
    for (const s of slicesAll) {
      const li = document.createElement("li");
      const pct = (s.value / total) * 100;
      li.innerHTML = `
        <span class="cat-name">${escapeHtml(s.label)}</span>
        <span class="cat-amount">${fmt(s.value)}</span>
        <div class="cat-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      `;
      list.appendChild(li);
    }
    if (!slicesAll.length) list.innerHTML = `<li><span class="cat-name" style="color:var(--ink-faint);">当月のデータがありません</span><span></span></li>`;
  }

  function rebindFilterControls() {
    const txs = state.data.transactions || [];
    const months = [...new Set(txs.map(t => t.date.slice(0, 7)))].sort().reverse();
    const cats = [...new Set(txs.map(t => t.category))].sort();

    const ctl = $("#tx-controls");
    ctl.innerHTML = `
      <select id="f-card">
        <option value="all">すべてのカード</option>
        <option value="paypay">PayPay</option>
        <option value="saison">セゾン</option>
      </select>
      <select id="f-month">
        <option value="all">すべての月</option>
        ${months.map(m => `<option value="${m}">${m}</option>`).join("")}
      </select>
      <select id="f-cat">
        <option value="all">すべてのカテゴリ</option>
        ${cats.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("")}
      </select>
      <input type="search" id="f-q" placeholder="店舗名で絞込" />
    `;
    $("#f-card").addEventListener("change", e => { state.filter.card = e.target.value; state.page = 1; renderTable(txs); });
    $("#f-month").addEventListener("change", e => { state.filter.month = e.target.value; state.page = 1; renderTable(txs); });
    $("#f-cat").addEventListener("change", e => { state.filter.category = e.target.value; state.page = 1; renderTable(txs); });
    $("#f-q").addEventListener("input", e => { state.filter.q = e.target.value; state.page = 1; renderTable(txs); });
  }

  function bindFilters() { /* installed after scaffold; no-op early */ }

  function renderTable(txs) {
    const f = state.filter;
    const filtered = txs.filter(t => {
      if (f.card !== "all" && t.card !== f.card) return false;
      if (f.month !== "all" && !t.date.startsWith(f.month)) return false;
      if (f.category !== "all" && t.category !== f.category) return false;
      if (f.q && !t.merchant.toLowerCase().includes(f.q.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = filtered.slice(start, start + state.pageSize);

    const tbody = $("#tx-table tbody");
    tbody.innerHTML = slice.map(t => {
      const cardCls = t.card === "paypay" ? "card-tag--paypay" : "card-tag--saison";
      const cardLabel = t.card === "paypay" ? "PayPay" : "セゾン";
      const refundCls = t.amount < 0 ? "refund" : "";
      return `<tr class="${refundCls}">
        <td>${t.date}</td>
        <td><span class="card-tag ${cardCls}">${cardLabel}</span></td>
        <td class="merchant">${escapeHtml(t.merchant)}</td>
        <td>${escapeHtml(t.category)}</td>
        <td class="amount">${fmt(t.amount)}</td>
      </tr>`;
    }).join("");

    $("#tx-pager").innerHTML = `
      <button id="pg-prev" ${state.page <= 1 ? "disabled" : ""}>‹ 前</button>
      <span>${state.page} / ${pages} （全 ${total} 件）</span>
      <button id="pg-next" ${state.page >= pages ? "disabled" : ""}>次 ›</button>
    `;
    $("#pg-prev").addEventListener("click", () => { state.page--; renderTable(txs); });
    $("#pg-next").addEventListener("click", () => { state.page++; renderTable(txs); });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
