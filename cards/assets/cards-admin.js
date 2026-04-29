// Cards admin: password gate + passphrase + CSV import + GitHub commit.
(() => {
  // Same admin password hash as the photo album (default: "family"). Reuses PAT key as well.
  const PASSWORD_HASH = "d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b";
  const REPO_OWNER  = "kurigorira";
  const REPO_NAME   = "home";
  const REPO_BRANCH = "main";
  const DATA_PATH   = "data/cards.json.enc";
  const DATA_URL    = "../data/cards.json.enc";
  const PAT_KEY     = "family_album_pat";
  const PASS_KEY    = "cards_passphrase";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const state = {
    data: { v: 1, transactions: [], rules: [...CardsCSV.DEFAULT_RULES], categories: [...CardsCSV.DEFAULT_CATEGORIES] },
    existingIds: new Set(),
    pending: [],   // [{tx, dup, manualCat?}]
    parseErrors: [], // [{file, message}]
  };

  document.addEventListener("DOMContentLoaded", initGate);

  // ---------- Password gate ----------
  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function initGate() {
    const form = $("#gate-form");
    const input = $("#gate-password");
    const err = $("#gate-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      const hash = await sha256Hex(input.value);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem("admin_ok", "1");
        unlock();
      } else {
        err.textContent = "パスワードが違います";
        input.select();
      }
    });
    if (sessionStorage.getItem("admin_ok") === "1") unlock();
    else input.focus();
  }

  async function unlock() {
    $("#gate").classList.add("hidden");
    $("#admin").classList.remove("hidden");
    initPassphrase();
    initPat();
    initDropzone();
    initRules();
    initCommit();
  }

  // ---------- Passphrase ----------
  function initPassphrase() {
    const cached = sessionStorage.getItem(PASS_KEY);
    if (cached) {
      $("#pp-input").value = cached;
      $("#pp-confirm").value = cached;
    }
    $("#pp-save").addEventListener("click", async () => {
      const a = $("#pp-input").value;
      const b = $("#pp-confirm").value;
      const status = $("#pp-status");
      status.textContent = "";
      if (!a || a.length < 8) { status.textContent = "8 文字以上にしてください"; return; }
      if (a !== b) { status.textContent = "確認用と一致しません"; return; }
      sessionStorage.setItem(PASS_KEY, a);
      status.textContent = "セッションに保存しました。既存データを取得中…";
      const ok = await loadExisting(a);
      if (ok) {
        status.textContent = `既存 ${state.data.transactions.length} 件を読み込み済み。CSV を取り込めます。`;
        $("#import-section").classList.remove("hidden");
        $("#rules-section").classList.remove("hidden");
        $("#commit-section").classList.remove("hidden");
        renderRules();
      } else {
        status.textContent = "取得失敗（パスフレーズを確認してください）。新規ならそのまま続行可能。";
        $("#import-section").classList.remove("hidden");
        $("#rules-section").classList.remove("hidden");
        $("#commit-section").classList.remove("hidden");
        renderRules();
      }
    });
  }

  async function loadExisting(passphrase) {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (res.status === 404) {
        return true; // first run, keep defaults
      }
      if (!res.ok) return false;
      const env = await res.json();
      const data = await CardsCrypto.decryptEnvelope(env, passphrase);
      state.data = {
        v: data.v || 1,
        transactions: data.transactions || [],
        rules: (data.rules && data.rules.length) ? data.rules : [...CardsCSV.DEFAULT_RULES],
        categories: data.categories || [...CardsCSV.DEFAULT_CATEGORIES],
      };
      state.existingIds = new Set(state.data.transactions.map(t => t.id));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- PAT ----------
  function getPat() { return localStorage.getItem(PAT_KEY) || ""; }
  function setPat(v) { localStorage.setItem(PAT_KEY, v); }
  function initPat() {
    const banner = $("#pat-banner");
    const saved = getPat();
    if (saved) {
      banner.innerHTML = `PAT 登録済み <button class="linklike" id="pat-reset">再設定</button>`;
      $("#pat-reset").addEventListener("click", () => {
        localStorage.removeItem(PAT_KEY);
        initPat();
      });
    } else {
      banner.innerHTML = `
        <div class="field">
          <label>GitHub Personal Access Token</label>
          <input type="password" id="pat-input" placeholder="github_pat_..." />
          <button class="btn" type="button" id="pat-save" style="margin-top:10px;">トークンを保存</button>
        </div>`;
      $("#pat-save").addEventListener("click", () => {
        const v = $("#pat-input").value.trim();
        if (v) { setPat(v); initPat(); }
      });
    }
  }

  // ---------- Dropzone / parse ----------
  function initDropzone() {
    const dz = $("#dropzone");
    const fileInput = $("#file-input");
    dz.addEventListener("click", () => fileInput.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("is-drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-drag");
      handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener("change", () => handleFiles(fileInput.files));
  }

  async function handleFiles(fileList) {
    const files = [...fileList].filter(f => /\.csv$/i.test(f.name));
    if (!files.length) {
      $("#parse-status").textContent = "CSV ファイルを選んでください";
      return;
    }
    $("#parse-status").textContent = `${files.length} ファイルを解析中…`;
    state.parseErrors = [];
    const newTxs = [];
    for (const f of files) {
      const r = await CardsCSV.parseFile(f, state.data.rules);
      if (r.error) {
        state.parseErrors.push({ file: f.name, message: r.error });
        continue;
      }
      newTxs.push(...r.transactions);
    }
    // Mark duplicates against existing + within-this-import
    const seen = new Set(state.existingIds);
    state.pending = [];
    for (const tx of newTxs) {
      const dup = seen.has(tx.id);
      if (!dup) seen.add(tx.id);
      state.pending.push({ tx, dup });
    }
    renderImportTable();
    const newCount = state.pending.filter(p => !p.dup).length;
    const dupCount = state.pending.length - newCount;
    const errLine = state.parseErrors.length
      ? ` / 解析エラー ${state.parseErrors.length} 件: ${state.parseErrors.map(e => `${e.file}（${e.message}）`).join(", ")}`
      : "";
    $("#parse-status").textContent = `新規 ${newCount} 件 / 重複 ${dupCount} 件${errLine}`;
  }

  function renderImportTable() {
    const wrap = $("#import-table-wrap");
    if (!state.pending.length) {
      wrap.innerHTML = "";
      return;
    }
    const cats = state.data.categories;
    const rows = state.pending.map((p, idx) => {
      const t = p.tx;
      const cls = p.dup ? "dup" : "";
      const cardLabel = t.card === "paypay" ? "PayPay" : "セゾン";
      const dupTag = p.dup ? `<td class="dup-tag">重複</td>` : `<td></td>`;
      const opts = cats.map(c => `<option value="${c}" ${c === t.category ? "selected" : ""}>${c}</option>`).join("");
      return `<tr class="${cls}">
        <td>${t.date}</td>
        <td>${cardLabel}</td>
        <td>${escapeHtml(t.merchant)}</td>
        <td><select data-i="${idx}">${opts}</select></td>
        <td class="amount">${CardsCharts.formatYen(t.amount)}</td>
        ${dupTag}
      </tr>`;
    }).join("");
    wrap.innerHTML = `
      <table class="import-table">
        <thead><tr>
          <th>日付</th><th>カード</th><th>店舗</th><th>カテゴリ</th><th style="text-align:right;">金額</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="status" style="margin-top:8px;">行ごとにカテゴリを上書きできます。重複行はコミット時に除外されます。</div>
    `;
    wrap.querySelectorAll("select[data-i]").forEach(sel => {
      sel.addEventListener("change", (e) => {
        const i = parseInt(e.target.dataset.i, 10);
        state.pending[i].tx.category = e.target.value;
        state.pending[i].tx.categorySource = "manual";
      });
    });
  }

  // ---------- Rules ----------
  function initRules() {
    $("#rule-add-btn").addEventListener("click", () => {
      const m = $("#rule-add-match").value.trim();
      const c = $("#rule-add-cat").value;
      if (!m || !c) return;
      state.data.rules.push({ match: m, category: c });
      $("#rule-add-match").value = "";
      renderRules();
      // Reapply rules to pending non-manual rows
      for (const p of state.pending) {
        if (p.tx.categorySource !== "manual") {
          p.tx.category = CardsCSV.applyRules(p.tx.merchant, state.data.rules);
        }
      }
      renderImportTable();
    });
  }

  function renderRules() {
    const cats = state.data.categories;
    $("#rule-add-cat").innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join("");
    const list = $("#rule-list");
    if (!state.data.rules.length) {
      list.innerHTML = `<li><span class="rule-match" style="color:var(--ink-faint);">ルールなし</span><span></span><span></span></li>`;
      return;
    }
    list.innerHTML = state.data.rules.map((r, i) => `
      <li>
        <span class="rule-match">${escapeHtml(r.match)}</span>
        <span>${escapeHtml(r.category)}</span>
        <button class="rule-del" data-i="${i}">削除</button>
      </li>
    `).join("");
    list.querySelectorAll("button.rule-del").forEach(b => {
      b.addEventListener("click", () => {
        const i = parseInt(b.dataset.i, 10);
        state.data.rules.splice(i, 1);
        renderRules();
      });
    });
  }

  // ---------- Commit ----------
  function initCommit() {
    $("#commit-btn").addEventListener("click", commit);
  }

  function ghHeaders(pat, extra = {}) {
    return {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${pat}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }
  async function ghApi(pat, path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      cache: "no-store",
      headers: ghHeaders(pat, init.headers || {}),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch {}
      throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  async function commit() {
    const status = $("#commit-status");
    const pat = getPat();
    if (!pat) { status.textContent = "PAT が未登録です"; return; }
    const passphrase = sessionStorage.getItem(PASS_KEY);
    if (!passphrase) { status.textContent = "パスフレーズが未設定です"; return; }

    const newOnes = state.pending.filter(p => !p.dup).map(p => p.tx);
    if (!newOnes.length && state.pending.length === 0) {
      // allow committing rules-only changes
      const proceed = confirm("新規明細はありませんが、ルール／カテゴリの変更をコミットしますか？");
      if (!proceed) return;
    }

    // Merge transactions
    const merged = [...state.data.transactions, ...newOnes].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const payload = {
      v: 1,
      updatedAt: new Date().toISOString(),
      transactions: merged,
      rules: state.data.rules,
      categories: state.data.categories,
    };

    const btn = $("#commit-btn");
    btn.disabled = true;
    try {
      status.textContent = "暗号化中…";
      const env = await CardsCrypto.encryptJson(payload, passphrase);
      const envJson = JSON.stringify(env, null, 2);

      status.textContent = "GitHub の最新状態を取得中…";
      const ref = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`);
      const latestCommit = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${ref.object.sha}`);
      const baseTreeSha = latestCommit.tree.sha;

      status.textContent = "blob 作成中…";
      const blob = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: envJson, encoding: "utf-8" }),
      });

      status.textContent = "tree 作成中…";
      const tree = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [{ path: DATA_PATH, mode: "100644", type: "blob", sha: blob.sha }],
        }),
      });

      status.textContent = "commit 作成中…";
      const commitObj = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `update card statements (+${newOnes.length} tx, ${merged.length} total)`,
          tree: tree.sha,
          parents: [ref.object.sha],
        }),
      });

      status.textContent = "ref 更新中…";
      await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commitObj.sha }),
      });

      status.textContent = `✓ コミット完了。新規 ${newOnes.length} / 全 ${merged.length} 件。1〜2 分後に Pages へ反映されます。`;
      // Update state
      state.data.transactions = merged;
      state.existingIds = new Set(merged.map(t => t.id));
      state.pending = [];
      renderImportTable();
    } catch (e) {
      status.textContent = `エラー: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
