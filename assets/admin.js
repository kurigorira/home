(() => {
  // SHA-256 hash of the admin password.
  // Default password: "family"
  // To change: compute a new hash with `echo -n "yournewpassword" | shasum -a 256`
  // and replace the string below.
  const PASSWORD_HASH = "d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b";

  const DATA_URL = "data/events.json";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const state = {
    existing: { site: { title: "家族のアルバム", subtitle: "Our Family Memories" }, events: [] },
    photos: [], // { file, url, caption, w, h, id }
    nextId: 1,
  };

  // ---------- Auth ----------
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
  }

  async function loadExisting() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.events) state.existing = data;
      }
    } catch (e) {
      // First-time setup: keep defaults.
    }
    const count = (state.existing.events || []).length;
    $("#existing-count").textContent = count === 0
      ? "既存イベント: なし（初めてのアップロードです）"
      : `既存イベント: ${count} 件（今回追加されます）`;
  }

  // ---------- Form ----------
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
    // Japanese-only titles (no ASCII): derive stable 4-char suffix from title
    const seed = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const suffix = seed.toString(36).slice(0, 4).padStart(4, "0");
    return `${date}-${suffix}`;
  }

  function updateSlugPreview() {
    $("#slug-preview").textContent = computeSlug();
  }

  // ---------- Dropzone ----------
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
      const photo = await readPhoto(f);
      state.photos.push(photo);
    }
    renderThumbs();
    updateGenerateEnabled();
  }

  function readPhoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({
          id: state.nextId++,
          file, url,
          caption: "",
          w: img.naturalWidth,
          h: img.naturalHeight,
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
        updateGenerateEnabled();
      });
      el.querySelector(".caption").addEventListener("input", (e) => {
        p.caption = e.target.value;
      });
      // Drag sort
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

  function updateGenerateEnabled() {
    $("#generate").disabled = state.photos.length === 0;
  }

  // ---------- Generate ZIP ----------
  function initGenerate() {
    $("#generate").addEventListener("click", generate);
    updateGenerateEnabled();
  }

  async function generate() {
    const title = $("#event-title").value.trim();
    const date = $("#event-date").value;
    const desc = $("#event-description").value.trim();
    if (!title) { setStatus("イベント名を入力してください"); return; }
    if (!date)  { setStatus("日付を入力してください"); return; }
    if (state.photos.length === 0) { setStatus("写真を追加してください"); return; }

    setStatus("ZIP を生成中…");
    const slug = computeSlug();
    const zip = new JSZip();

    // Build new photo entries with sequential filenames
    const newPhotos = [];
    state.photos.forEach((p, i) => {
      const ext = extFromType(p.file.type) || extFromName(p.file.name) || "jpg";
      const name = `${String(i + 1).padStart(2, "0")}.${ext}`;
      const path = `photos/${slug}/${name}`;
      zip.file(path, p.file);
      newPhotos.push({
        src: path,
        w: p.w,
        h: p.h,
        caption: p.caption || ""
      });
    });

    // Merge with existing events
    const next = JSON.parse(JSON.stringify(state.existing));
    next.events = (next.events || []).filter(e => e.slug !== slug);
    next.events.push({
      slug,
      title,
      date,
      description: desc,
      photos: newPhotos
    });
    next.events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    zip.file("data/events.json", JSON.stringify(next, null, 2) + "\n");

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    setStatus(`ZIP をダウンロードしました: ${slug}.zip`);
  }

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

  function setStatus(msg) { $("#status").textContent = msg; }
  function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

  document.addEventListener("DOMContentLoaded", initGate);
})();
