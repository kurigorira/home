(() => {
  // ---- Config ----
  // SHA-256 hash of the admin password. Default password: "family"
  // To change: echo -n "newpw" | shasum -a 256
  const PASSWORD_HASH = "d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b";

  // GitHub repo target for direct upload
  const REPO_OWNER  = "kurigorira";
  const REPO_NAME   = "home";
  const REPO_BRANCH = "main";

  const DATA_URL = "data/events.json";
  const PAT_KEY  = "family_album_pat";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const state = {
    existing: { site: { title: "家族のアルバム", subtitle: "Our Family Memories" }, events: [] },
    existingSha: null, // blob sha of data/events.json on main
    photos: [],
    nextId: 1,
  };

  // ---------- Auth (password gate) ----------
  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
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
    await loadExisting();
    initForm();
    initDropzone();
    initGenerate();
    initDirectUpload();
  }

  async function loadExisting() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.events) state.existing = data;
      }
    } catch (e) { /* first-run: keep defaults */ }
    const count = (state.existing.events || []).length;
    $("#existing-count").textContent = count === 0
      ? "既存イベント: なし（初めてのアップロードです）"
      : `既存イベント: ${count} 件（今回追加されます）`;
  }

  // ---------- Event form / slug ----------
  function initForm() {
    const today = new Date().toISOString().slice(0, 10);
    $("#event-date").value = today;
    $("#event-title").addEventListener("input", updateSlugPreview);
    $("#event-date").addEventListener("input", updateSlugPreview);
    updateSlugPreview();
  }

  function computeSlug() {
    const title = $("#event-title").value.trim();
    const date = $("#event-date").value || "undated";
    const base = title
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const ym = date.slice(0, 7);
    if (base) return `${ym}-${base}`;
    const seed = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const suffix = seed.toString(36).slice(0, 4).padStart(4, "0");
    return `${date}-${suffix}`;
  }

  function updateSlugPreview() {
    $("#slug-preview").textContent = computeSlug();
  }

  // ---------- Dropzone / thumbs ----------
  function initDropzone() {
    const dz = $("#dropzone");
    const file = $("#file-input");
    dz.addEventListener("click", () => file.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("is-drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-drag");
      handleFiles(e.dataTransfer.files);
    });
    file.addEventListener("change", (e) => handleFiles(e.target.files));
  }

  async function handleFiles(fileList) {
    const files = [...fileList].filter(f => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    for (const f of files) {
      state.photos.push(await readPhoto(f));
    }
    renderThumbs();
    updateButtonsEnabled();
  }

  function readPhoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({
          id: state.nextId++,
          file, url, caption: "",
          w: img.naturalWidth, h: img.naturalHeight,
        });
      };
      img.src = url;
    });
  }

  function renderThumbs() {
    const wrap = $("#thumbs");
    wrap.innerHTML = "";
    state.photos.forEach((p, idx) => {
      const el = document.createElement("div");
      el.className = "thumb";
      el.draggable = true;
      el.dataset.id = p.id;
      el.innerHTML = `
        <button class="remove" title="削除" aria-label="削除">×</button>
        <img src="${p.url}" alt="">
        <input class="caption" placeholder="キャプション（任意）" value="${escapeAttr(p.caption)}">
      `;
      el.querySelector(".remove").addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(p.url);
        state.photos.splice(idx, 1);
        renderThumbs();
        updateButtonsEnabled();
      });
      el.querySelector(".caption").addEventListener("input", (e) => { p.caption = e.target.value; });
      el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", p.id); el.style.opacity = "0.4"; });
      el.addEventListener("dragend", () => { el.style.opacity = ""; });
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        const draggedId = Number(e.dataTransfer.getData("text/plain"));
        if (!draggedId || draggedId === p.id) return;
        const fromIdx = state.photos.findIndex(x => x.id === draggedId);
        const toIdx = state.photos.findIndex(x => x.id === p.id);
        const [moved] = state.photos.splice(fromIdx, 1);
        state.photos.splice(toIdx, 0, moved);
        renderThumbs();
      });
      wrap.appendChild(el);
    });
  }

  function updateButtonsEnabled() {
    const has = state.photos.length > 0;
    $("#generate").disabled = !has;
    const direct = $("#upload-direct");
    if (direct) direct.disabled = !has;
  }

  // ---------- Build merged events.json + photo entries ----------
  function buildEventPayload() {
    const title = $("#event-title").value.trim();
    const date = $("#event-date").value;
    const desc = $("#event-description").value.trim();
    if (!title) return { error: "イベント名を入力してください" };
    if (!date)  return { error: "日付を入力してください" };
    if (state.photos.length === 0) return { error: "写真を追加してください" };

    const slug = computeSlug();
    const photoEntries = state.photos.map((p, i) => {
      const ext = extFromType(p.file.type) || extFromName(p.file.name) || "jpg";
      const name = `${String(i + 1).padStart(2, "0")}.${ext}`;
      return {
        path: `photos/${slug}/${name}`,
        file: p.file,
        w: p.w, h: p.h,
        caption: p.caption || ""
      };
    });

    const next = JSON.parse(JSON.stringify(state.existing));
    next.events = (next.events || []).filter(e => e.slug !== slug);
    next.events.push({
      slug, title, date, description: desc,
      photos: photoEntries.map(p => ({ src: p.path, w: p.w, h: p.h, caption: p.caption }))
    });
    next.events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return { slug, title, photoEntries, eventsJson: JSON.stringify(next, null, 2) + "\n" };
  }

  // ---------- ZIP fallback ----------
  function initGenerate() {
    $("#generate").addEventListener("click", generateZip);
    updateButtonsEnabled();
  }

  async function generateZip() {
    const payload = buildEventPayload();
    if (payload.error) { setZipStatus(payload.error); return; }
    setZipStatus("ZIP を生成中…");
    const zip = new JSZip();
    for (const p of payload.photoEntries) zip.file(p.path, p.file);
    zip.file("data/events.json", payload.eventsJson);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.slug}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    setZipStatus(`ダウンロード完了: ${payload.slug}.zip`);
  }

  // ---------- Direct GitHub upload (via Git Data API) ----------
  function getPat() { return localStorage.getItem(PAT_KEY) || ""; }
  function setPat(v) { localStorage.setItem(PAT_KEY, v); }
  function clearPat() { localStorage.removeItem(PAT_KEY); }

  function initDirectUpload() {
    renderUploadSection();

    $("#pat-save").addEventListener("click", async () => {
      const v = $("#pat-input").value.trim();
      $("#pat-error").textContent = "";
      if (!v) { $("#pat-error").textContent = "トークンを入力してください"; return; }
      $("#pat-error").textContent = "検証中…";
      const ok = await verifyPat(v);
      if (ok.ok) {
        setPat(v);
        $("#pat-error").textContent = "";
        $("#pat-input").value = "";
        renderUploadSection();
      } else {
        $("#pat-error").textContent = `検証失敗: ${ok.msg}`;
      }
    });

    $("#pat-reset").addEventListener("click", () => {
      if (!confirm("保存されているトークンを削除しますか？")) return;
      clearPat();
      renderUploadSection();
    });

    $("#upload-direct").addEventListener("click", uploadDirect);
  }

  function renderUploadSection() {
    const hasPat = !!getPat();
    $("#upload-ready").classList.toggle("hidden", !hasPat);
    $("#pat-setup").classList.toggle("hidden", hasPat);
    updateButtonsEnabled();
  }

  async function verifyPat(pat) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
        headers: ghHeaders(pat)
      });
      if (res.status === 401) return { ok: false, msg: "トークンが無効です" };
      if (res.status === 404) return { ok: false, msg: "リポジトリにアクセスできません（権限/対象リポジトリを確認）" };
      if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
      const data = await res.json();
      if (!data.permissions || (!data.permissions.push && !data.permissions.admin && !data.permissions.maintain)) {
        return { ok: false, msg: "書き込み権限がありません (Contents: Read and write が必要)" };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message || "ネットワークエラー" };
    }
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
      headers: ghHeaders(pat, init.headers || {}),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch {}
      throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Chunked conversion to avoid call-stack limits on big images
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function uploadDirect() {
    const pat = getPat();
    if (!pat) { setUploadStatus("トークンが未登録です"); return; }

    const payload = buildEventPayload();
    if (payload.error) { setUploadStatus(payload.error); return; }

    const btn = $("#upload-direct");
    btn.disabled = true;
    try {
      setUploadStatus("最新の状態を取得中…");
      const ref = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`);
      const latestCommit = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${ref.object.sha}`);
      const baseTreeSha = latestCommit.tree.sha;

      // 1. Create blobs for photos (binary → base64)
      const treeEntries = [];
      for (let i = 0; i < payload.photoEntries.length; i++) {
        const p = payload.photoEntries[i];
        setUploadStatus(`写真をアップロード中… ${i + 1}/${payload.photoEntries.length}`);
        const content = await fileToBase64(p.file);
        const blob = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, encoding: "base64" }),
        });
        treeEntries.push({ path: p.path, mode: "100644", type: "blob", sha: blob.sha });
      }

      // 2. events.json blob
      setUploadStatus("メタデータを更新中…");
      const jsonBlob = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload.eventsJson, encoding: "utf-8" }),
      });
      treeEntries.push({ path: "data/events.json", mode: "100644", type: "blob", sha: jsonBlob.sha });

      // 3. Create tree based on latest
      const tree = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
      });

      // 4. Create commit
      const commit = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `add event: ${payload.title}`,
          tree: tree.sha,
          parents: [ref.object.sha],
        }),
      });

      // 5. Fast-forward the branch
      setUploadStatus("公開ブランチを更新中…");
      await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha }),
      });

      setUploadStatus(`✓ 公開しました。GitHub Pages 反映まで 1〜2 分程度: https://${REPO_OWNER}.github.io/${REPO_NAME}/`);
      // Clear form
      state.photos.forEach(p => URL.revokeObjectURL(p.url));
      state.photos = [];
      renderThumbs();
      await loadExisting();
      $("#event-title").value = "";
      $("#event-description").value = "";
      updateSlugPreview();
    } catch (err) {
      setUploadStatus(`エラー: ${err.message}`);
    } finally {
      updateButtonsEnabled();
    }
  }

  // ---------- Helpers ----------
  function extFromType(type) {
    if (type === "image/jpeg") return "jpg";
    if (type === "image/png")  return "png";
    if (type === "image/webp") return "webp";
    if (type === "image/gif")  return "gif";
    return null;
  }
  function extFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : null;
  }
  function setZipStatus(msg) { $("#status").textContent = msg; }
  function setUploadStatus(msg) { $("#upload-status").textContent = msg; }
  function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

  document.addEventListener("DOMContentLoaded", initGate);
})();
