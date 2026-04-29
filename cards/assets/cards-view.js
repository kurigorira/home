// Cards dashboard viewer.
// Reads ../data/cards.json.enc, decrypts with passphrase, renders KPIs/charts/table.
(() => {
  const DATA_URL = "../data/cards.json.enc";
  const PASS_KEY = "cards_passphrase";

  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => CardsCharts.formatYen(n);

  const state = {
    data: null,
    selectedMonth: null, // "YYYY-MM"
    filter: { card: "all", category: "all", month: "all", q: "" },
    page: 1,
    pageSize: 50,
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindUnlockForm();
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
  function dailySeriesForMonth(txs, ym) {
    const [y, m] = ym.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const out = [];
    const idx = new Map();
    for (let d = 1; d <= lastDay; d++) {
      const key = `${ym}-${String(d).padStart(2, "0")}`;
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

  function merchantRanking(txs) {
    const m = new Map();
    for (const t of txs) {
      if (t.amount <= 0) continue;
      const key = t.merchant;
      const cur = m.get(key) || { merchant: key, total: 0, count: 0, lastDate: "", category: t.category };
      cur.total += t.amount;
      cur.count += 1;
      if (t.date > cur.lastDate) cur.lastDate = t.date;
      m.set(key, cur);
    }
    return [...m.values()]
      .map(x => ({ ...x, avg: Math.round(x.total / x.count) }))
      .sort((a, b) => b.total - a.total);
  }

  function monthsWithData(txs) {
    return [...new Set(txs.map(t => t.date.slice(0, 7)))].sort().reverse();
  }

  function prevYm(ym) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function statsForMonth(txs, ym) {
    const monthTx = txs.filter(t => t.date.startsWith(ym));
    const positives = monthTx.filter(t => t.amount > 0);
    const total = positives.reduce((s, t) => s + t.amount, 0);
    const paypay = positives.filter(t => t.card === "paypay").reduce((s, t) => s + t.amount, 0);
    const saison = positives.filter(t => t.card === "saison").reduce((s, t) => s + t.amount, 0);
    const refunds = monthTx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const count = positives.length;
    const avg = count ? Math.round(total / count) : 0;
    let max = null;
    for (const t of positives) {
      if (!max || t.amount > max.amount) max = t;
    }
    return { ym, total, paypay, saison, refunds, count, avg, max };
  }

  // ---------- Render ----------
  function render() {
    if (!state.data) return;
    const txs = state.data.transactions || [];
    if (!txs.length) {
      $("#dash-content").innerHTML = `<div class="empty-dash">明細がまだありません。</div>`;
      return;
    }

    if (!$("#kpi-row")) buildScaffold();

    const months = monthsWithData(txs);
    const today = isoDate(new Date());
    const ymCurrent = today.slice(0, 7);
    if (!state.selectedMonth || !months.includes(state.selectedMonth)) {
      state.selectedMonth = months.includes(ymCurrent) ? ymCurrent : months[0];
    }

    renderMonthSelector(months);
    renderKpis(txs, state.selectedMonth);
    renderDaily(txs, state.selectedMonth);
    renderMonthly(txs);
    renderCategory(txs, state.selectedMonth);
    renderMerchantRanking(txs, state.selectedMonth);
    renderMonthlySummary(txs, months);
    renderTable(txs);
  }

  function buildScaffold() {
    $("#dash-content").innerHTML = `
      <div class="month-selector" id="month-selector"></div>
      <div class="kpi-row" id="kpi-row"></div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title" id="title-daily">日次推移</h2>
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
            <h2 class="chart-block__title" id="title-cat-donut">カテゴリ別</h2>
          </div>
          <svg class="chart-svg" id="chart-category" aria-label="カテゴリ別"></svg>
        </div>
        <div class="chart-block">
          <div class="chart-block__head">
            <h2 class="chart-block__title" id="title-cat-rank">カテゴリ ランキング</h2>
          </div>
          <ul class="cat-list" id="cat-list"></ul>
        </div>
      </div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title" id="title-merchant">ショップ別ランキング</h2>
          <div class="chart-block__legend" id="merchant-controls"></div>
        </div>
        <div id="merchant-ranking"></div>
      </div>

      <div class="chart-block">
        <div class="chart-block__head">
          <h2 class="chart-block__title">各月のサマリー</h2>
        </div>
        <div id="month-summary"></div>
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

  function renderMonthSelector(months) {
    const sel = $("#month-selector");
    const cur = state.selectedMonth;
    const idx = months.indexOf(cur);
    const newer = idx > 0 ? months[idx - 1] : null; // months is desc
    const older = idx < months.length - 1 ? months[idx + 1] : null;
    sel.innerHTML = `
      <button class="month-nav" id="ms-older" ${older ? "" : "disabled"} aria-label="前の月">‹</button>
      <select id="ms-pick">
        ${months.map(m => `<option value="${m}" ${m === cur ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}
      </select>
      <button class="month-nav" id="ms-newer" ${newer ? "" : "disabled"} aria-label="次の月">›</button>
    `;
    $("#ms-pick").addEventListener("change", e => { state.selectedMonth = e.target.value; render(); });
    if (older) $("#ms-older").addEventListener("click", () => { state.selectedMonth = older; render(); });
    if (newer) $("#ms-newer").addEventListener("click", () => { state.selectedMonth = newer; render(); });
  }

  function monthLabel(ym) {
    const [y, m] = ym.split("-");
    return `${y} 年 ${parseInt(m, 10)} 月`;
  }

  function renderKpis(txs, ym) {
    const cur = statsForMonth(txs, ym);
    const prev = statsForMonth(txs, prevYm(ym));

    const diff = cur.total - prev.total;
    const diffPct = prev.total ? ((diff / prev.total) * 100).toFixed(1) : null;
    const diffCls = diff > 0 ? "kpi__sub--up" : "kpi__sub--down";
    const diffSign = diff > 0 ? "+" : "";
    const diffSub = prev.total
      ? `<span class="${diffCls}">前月比 ${diffSign}${fmt(diff)} (${diffSign}${diffPct}%)</span>`
      : `<span>前月データなし</span>`;

    const maxLine = cur.max
      ? `<div class="kpi__sub">${escapeHtml(cur.max.merchant)} (${cur.max.date.slice(5)})</div>`
      : `<div class="kpi__sub">—</div>`;

    const refundLine = cur.refunds
      ? `<div class="kpi__sub kpi__sub--down">返金 ${fmt(cur.refunds)}</div>`
      : "";

    $("#kpi-row").innerHTML = `
      <div class="kpi"><div class="kpi__label">合計</div><div class="kpi__value">${fmt(cur.total)}</div><div class="kpi__sub">${diffSub}</div>${refundLine}</div>
      <div class="kpi"><div class="kpi__label">PayPay</div><div class="kpi__value">${fmt(cur.paypay)}</div></div>
      <div class="kpi"><div class="kpi__label">セゾン</div><div class="kpi__value">${fmt(cur.saison)}</div></div>
      <div class="kpi"><div class="kpi__label">件数 / 平均</div><div class="kpi__value">${cur.count} 件</div><div class="kpi__sub">平均 ${fmt(cur.avg)}</div></div>
      <div class="kpi"><div class="kpi__label">最大1件</div><div class="kpi__value">${fmt(cur.max ? cur.max.amount : 0)}</div>${maxLine}</div>
    `;
  }

  function renderDaily(txs, ym) {
    $("#title-daily").textContent = `日次推移（${monthLabel(ym)}）`;
    const points = dailySeriesForMonth(txs, ym);
    CardsCharts.renderLineDaily($("#chart-daily"), points, { tooltip: $("#tip-daily") });
  }

  function renderMonthly(txs) {
    const months = monthlySeries(txs, 12);
    CardsCharts.renderBarMonthly($("#chart-monthly"), months);
  }

  function renderCategory(txs, ym) {
    $("#title-cat-donut").textContent = `カテゴリ別（${monthLabel(ym)}）`;
    $("#title-cat-rank").textContent = `カテゴリ ランキング（${monthLabel(ym)}）`;
    const monthTx = txs.filter(t => t.date.startsWith(ym));
    const slicesAll = categorySlices(monthTx);
    const top = slicesAll.slice(0, 8);
    const rest = slicesAll.slice(8).reduce((s, x) => s + x.value, 0);
    const slices = rest > 0 ? [...top, { label: "他", value: rest }] : top;
    CardsCharts.renderDonutCategory($("#chart-category"), slices);

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
    if (!slicesAll.length) list.innerHTML = `<li><span class="cat-name" style="color:var(--ink-faint);">この月のデータがありません</span><span></span></li>`;
  }

  function renderMerchantRanking(txs, ym) {
    const scope = state.merchantScope || "month";
    const limit = state.merchantExpanded ? Infinity : 15;
    const scoped = scope === "all" ? txs : txs.filter(t => t.date.startsWith(ym));
    const ranking = merchantRanking(scoped);

    $("#title-merchant").textContent = scope === "all"
      ? "ショップ別ランキング（全期間）"
      : `ショップ別ランキング（${monthLabel(ym)}）`;

    const ctlHtml = `
      <button class="rank-toggle ${scope === "month" ? "is-active" : ""}" data-scope="month">この月</button>
      <button class="rank-toggle ${scope === "all" ? "is-active" : ""}" data-scope="all">全期間</button>
    `;
    $("#merchant-controls").innerHTML = ctlHtml;
    $("#merchant-controls").querySelectorAll(".rank-toggle").forEach(b => {
      b.addEventListener("click", () => {
        state.merchantScope = b.dataset.scope;
        state.merchantExpanded = false;
        renderMerchantRanking(state.data.transactions || [], state.selectedMonth);
      });
    });

    const wrap = $("#merchant-ranking");
    if (!ranking.length) {
      wrap.innerHTML = `<div class="empty-dash" style="padding:32px 0;">この期間のデータがありません</div>`;
      return;
    }
    const max = ranking[0].total;
    const shown = ranking.slice(0, limit);
    const rows = shown.map((r, i) => {
      const pct = (r.total / max) * 100;
      const lastDate = r.lastDate ? r.lastDate.slice(5).replace("-", "/") : "";
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td class="merchant">
          <div class="merchant-name">${escapeHtml(r.merchant)}</div>
          <div class="merchant-meta">${escapeHtml(r.category)} · 最終 ${lastDate}</div>
          <div class="merchant-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        </td>
        <td class="amount">${fmt(r.total)}</td>
        <td class="amount count">${r.count} 件</td>
        <td class="amount avg">平均 ${fmt(r.avg)}</td>
      </tr>`;
    }).join("");

    const moreBtn = ranking.length > limit
      ? `<div class="rank-more"><button id="merchant-more">もっと見る（残り ${ranking.length - limit} 件）</button></div>`
      : (state.merchantExpanded && ranking.length > 15
        ? `<div class="rank-more"><button id="merchant-less">折りたたむ</button></div>`
        : "");

    wrap.innerHTML = `
      <table class="merchant-table">
        <thead><tr>
          <th></th><th>ショップ</th>
          <th style="text-align:right;">合計</th>
          <th style="text-align:right;">件数</th>
          <th style="text-align:right;">平均1件</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${moreBtn}
    `;
    const more = $("#merchant-more");
    if (more) more.addEventListener("click", () => {
      state.merchantExpanded = true;
      renderMerchantRanking(state.data.transactions || [], state.selectedMonth);
    });
    const less = $("#merchant-less");
    if (less) less.addEventListener("click", () => {
      state.merchantExpanded = false;
      renderMerchantRanking(state.data.transactions || [], state.selectedMonth);
    });
  }

  function renderMonthlySummary(txs, months) {
    const wrap = $("#month-summary");
    if (!months.length) { wrap.innerHTML = ""; return; }
    const rows = months.map(m => {
      const s = statsForMonth(txs, m);
      const isSelected = m === state.selectedMonth;
      return `<tr class="${isSelected ? "is-selected" : ""}" data-month="${m}">
        <td>${monthLabel(m)}</td>
        <td class="amount">${fmt(s.total)}</td>
        <td class="amount">${fmt(s.paypay)}</td>
        <td class="amount">${fmt(s.saison)}</td>
        <td class="amount">${s.count}</td>
        <td class="amount">${fmt(s.avg)}</td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `
      <table class="month-summary-table">
        <thead><tr>
          <th>月</th>
          <th style="text-align:right;">合計</th>
          <th style="text-align:right;">PayPay</th>
          <th style="text-align:right;">セゾン</th>
          <th style="text-align:right;">件数</th>
          <th style="text-align:right;">平均1件</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    wrap.querySelectorAll("tr[data-month]").forEach(tr => {
      tr.addEventListener("click", () => {
        state.selectedMonth = tr.dataset.month;
        render();
        const sel = $("#month-selector");
        if (sel) sel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function rebindFilterControls() {
    const txs = state.data.transactions || [];
    const months = monthsWithData(txs);
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
