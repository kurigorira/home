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
    renderExistingEvents();
  }

  // ---------- Existing events list / delete ----------
  function renderExistingEvents() {
    const details = $("#existing-events-details");
    const listEl = $("#existing-events-list");
    if (!details || !listEl) return;
    const events = (state.existing.events || []).slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (events.length === 0) {
      details.classList.add("hidden");
      listEl.innerHTML = "";
      return;
    }
    details.classList.remove("hidden");
    listEl.innerHTML = "";
    for (const ev of events) {
      const row = document.createElement("div");
      row.className = "event-row";
      const photoCount = (ev.photos || []).length;
      row.innerHTML = `
        <div class="event-row__info">
          <div class="event-row__title">${escapeHtml(ev.title || ev.slug)}</div>
          <div class="event-row__meta">${escapeHtml(ev.date || "")} · ${photoCount} 点 · <code>${escapeHtml(ev.slug)}</code></div>
        </div>
        <button type="button" class="event-row__delete">削除</button>
      `;
      row.querySelector(".event-row__delete").addEventListener("click", () => deleteEvent(ev));
      listEl.appendChild(row);
    }
  }

  async function deleteEvent(ev) {
    const pat = getPat();
    if (!pat) {
      setExistingStatus("削除するには下の「アップロード方法」から GitHub トークンを登録してください。");
      return;
    }
    const photoCount = (ev.photos || []).length;
    const confirmMsg = `「${ev.title || ev.slug}」を削除します。\n写真・動画 ${photoCount} 点も一緒に削除されます。\n元に戻せません。本当によろしいですか？`;
    if (!confirm(confirmMsg)) return;

    // Disable all delete buttons during operation
    $$(".event-row__delete").forEach(b => b.disabled = true);

    try {
      setExistingStatus("最新の状態を取得中…");
      const ref = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`);
      const latestCommit = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${ref.object.sha}`);
      const baseTreeSha = latestCommit.tree.sha;

      // Find all files under photos/<slug>/
      const recursive = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${baseTreeSha}?recursive=1`);
      const prefix = `photos/${ev.slug}/`;
      const deletions = recursive.tree
        .filter(t => t.type === "blob" && t.path.startsWith(prefix))
        .map(t => ({ path: t.path, mode: "100644", type: "blob", sha: null }));

      // Build new events.json without this event
      const next = JSON.parse(JSON.stringify(state.existing));
      next.events = (next.events || []).filter(e => e.slug !== ev.slug);

      setExistingStatus(`削除を適用中…（ファイル ${deletions.length} 件）`);
      const jsonBlob = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(next, null, 2) + "\n", encoding: "utf-8" }),
      });

      const treeEntries = [
        ...deletions,
        { path: "data/events.json", mode: "100644", type: "blob", sha: jsonBlob.sha },
      ];

      const tree = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
      });

      const commit = await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `delete event: ${ev.title || ev.slug}`,
          tree: tree.sha,
          parents: [ref.object.sha],
        }),
      });

      await ghApi(pat, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha }),
      });

      setExistingStatus(`✓ 削除しました: ${ev.title || ev.slug}（反映まで 1〜2 分）`);
      await loadExisting();
    } catch (err) {
      setExistingStatus(`エラー: ${err.message}`);
      $$(".event-row__delete").forEach(b => b.disabled = false);
    }
  }

  function setExistingStatus(msg) {
    const el = $("#existing-events-status");
    if (el) el.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ---------- Event form / slug ----------
  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function initForm() {
    $("#event-date").value = todayLocal();
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

    $("#youtube-add").addEventListener("click", addYoutube);
    $("#youtube-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addYoutube(); } });
  }

  function parseYouTubeId(input) {
    if (!input) return null;
    const s = input.trim();
    // Raw ID (11 chars)
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
      if (host.endsWith("youtube.com")) {
        const v = u.searchParams.get("v");
        if (v) return v;
        const parts = u.pathname.split("/").filter(Boolean);
        // /shorts/<id>, /embed/<id>, /v/<id>
        if (["shorts", "embed", "v"].includes(parts[0]) && parts[1]) return parts[1];
      }
    } catch { /* not a URL */ }
    return null;
  }

  function addYoutube() {
    const input = $("#youtube-url");
    const err = $("#youtube-error");
    err.textContent = "";
    const id = parseYouTubeId(input.value);
    if (!id) { err.textContent = "YouTube の URL を認識できませんでした"; return; }
    state.photos.push({
      id: state.nextId++, type: "youtube",
      videoId: id, caption: "",
      w: 16, h: 9, // aspect ratio hint for masonry
    });
    input.value = "";
    renderThumbs();
    updateButtonsEnabled();
  }

  const MAX_BYTES = 100 * 1024 * 1024;   // GitHub Pages per-file ceiling
  const MAX_VIDEO_SECONDS = 130;         // 2 minutes + small buffer

  function isImage(t) { return /^image\/(jpeg|png|webp|gif)$/.test(t); }
  function isVideo(t) { return /^video\/(mp4|webm|quicktime|x-m4v)$/.test(t); }
  function isHeic(f) {
    return /^image\/hei[cf]$/i.test(f.type || "") ||
           /\.(heic|heif)$/i.test(f.name || "");
  }

  function setConvertStatus(msg) {
    const el = $("#convert-status");
    if (el) el.textContent = msg;
  }

  async function convertHeic(file) {
    if (typeof heic2any !== "function") throw new Error("HEIC 変換ライブラリが読み込めていません");
    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const out = Array.isArray(blob) ? blob[0] : blob;
    const newName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    return new File([out], newName, { type: "image/jpeg", lastModified: file.lastModified });
  }

  async function handleFiles(fileList) {
    const rejected = [];
    const all = [...fileList];
    for (let i = 0; i < all.length; i++) {
      let f = all[i];
      try {
        if (isHeic(f)) {
          setConvertStatus(`HEIC を JPG に変換中… (${i + 1}/${all.length}) ${f.name}`);
          f = await convertHeic(f);
        }
      } catch (e) {
        rejected.push(`${f.name}: HEIC 変換に失敗 (${e.message || e})`);
        continue;
      }
      if (!isImage(f.type) && !isVideo(f.type)) { rejected.push(`${f.name}: 対応していない形式`); continue; }
      if (f.size > MAX_BYTES) { rejected.push(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)}MB は大きすぎます（100MB まで）`); continue; }
      try {
        const media = isVideo(f.type) ? await readVideo(f) : await readPhoto(f);
        if (media.type === "video" && media.duration > MAX_VIDEO_SECONDS) {
          URL.revokeObjectURL(media.url);
          rejected.push(`${f.name}: ${Math.round(media.duration)}秒は長すぎます（2 分以内）`);
          continue;
        }
        state.photos.push(media);
      } catch (e) {
        rejected.push(`${f.name}: ${e.message || "読み込みエラー"}`);
      }
    }
    setConvertStatus("");
    renderThumbs();
    updateButtonsEnabled();
    if (rejected.length) {
      alert("以下のファイルは追加できませんでした:\n\n" + rejected.join("\n"));
    }
  }

  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({
        id: state.nextId++, type: "image",
        file, url, caption: "",
        w: img.naturalWidth, h: img.naturalHeight,
      });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めません")); };
      img.src = url;
    });
  }

  function readVideo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => resolve({
        id: state.nextId++, type: "video",
        file, url, caption: "",
        w: v.videoWidth, h: v.videoHeight,
        duration: v.duration || 0,
      });
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("動画を読み込めません（形式がブラウザ非対応の可能性）")); };
      v.src = url;
    });
  }

  function renderThumbs() {
    const wrap = $("#thumbs");
    wrap.innerHTML = "";
    state.photos.forEach((p, idx) => {
      const el = document.createElement("div");
      el.className = "thumb" + (p.type === "video" ? " thumb--video" : "");
      el.draggable = true;
      el.dataset.id = p.id;
      let media;
      if (p.type === "video") {
        media = `<video src="${p.url}" muted playsinline preload="metadata"></video><span class="play">▶</span>`;
      } else if (p.type === "youtube") {
        const thumb = `https://img.youtube.com/vi/${p.videoId}/mqdefault.jpg`;
        media = `<img src="${thumb}" alt="YouTube"><span class="play">▶</span><span class="yt-badge">YouTube</span>`;
      } else {
        media = `<img src="${p.url}" alt="">`;
      }
      el.innerHTML = `
        <button class="remove" title="削除" aria-label="削除">×</button>
        ${media}
        <input class="caption" placeholder="キャプション（任意）" value="${escapeAttr(p.caption)}">
      `;
      el.querySelector(".remove").addEventListener("click", (e) => {
        e.stopPropagation();
        if (p.url) URL.revokeObjectURL(p.url);
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
    // Separate media kinds. Only file items need uploading; youtube items are URL-only.
    let imgI = 0, vidI = 0;
    const photoEntries = [];
    const jsonItems = [];
    for (const p of state.photos) {
      if (p.type === "youtube") {
        jsonItems.push({ type: "youtube", videoId: p.videoId, caption: p.caption || "" });
        continue;
      }
      const ext = extFromType(p.file.type) || extFromName(p.file.name) || (p.type === "video" ? "mp4" : "jpg");
      const idx = p.type === "video" ? ++vidI : ++imgI;
      const prefix = p.type === "video" ? "vid" : "";
      const name = `${prefix}${String(idx).padStart(2, "0")}.${ext}`;
      const path = `photos/${slug}/${name}`;
      photoEntries.push({ path, file: p.file });
      const item = { type: p.type, src: path, w: p.w, h: p.h, caption: p.caption || "" };
      if (p.type === "video" && p.duration) item.duration = Math.round(p.duration);
      jsonItems.push(item);
    }

    const next = JSON.parse(JSON.stringify(state.existing));
    next.events = (next.events || []).filter(e => e.slug !== slug);
    next.events.push({ slug, title, date, description: desc, photos: jsonItems });
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
      state.photos.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
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
    if (type === "video/mp4")  return "mp4";
    if (type === "video/webm") return "webm";
    if (type === "video/quicktime" || type === "video/x-m4v") return "mov";
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
