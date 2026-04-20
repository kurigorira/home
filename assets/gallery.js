(() => {
  const DATA_URL = "data/events.json";

  const state = {
    site: null,
    events: [],
    allPhotos: [],
    activeSlug: "all",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      state.site = data.site || {};
      state.events = (data.events || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      state.allPhotos = state.events.flatMap(e =>
        (e.photos || []).map((p, i) => ({ ...p, eventSlug: e.slug, eventTitle: e.title, indexInEvent: i }))
      );
      render();
    } catch (err) {
      console.error(err);
      renderEmpty("データを読み込めませんでした。");
    }
  }

  function renderHeader() {
    const s = state.site || {};
    const totalCount = state.allPhotos.length;
    $("#site-title").textContent = s.title || "Family Album";
    $("#site-subtitle").textContent = s.subtitle || "";
    $("#site-meta").textContent = totalCount > 0
      ? `${state.events.length} Stories · ${totalCount} Frames`
      : "";
    document.title = s.title ? `${s.title}` : "Family Album";
  }

  function renderFilter() {
    const bar = $("#filter-bar-inner");
    bar.innerHTML = "";
    if (state.events.length <= 1) {
      $("#filter-bar").classList.add("hidden");
      return;
    }
    $("#filter-bar").classList.remove("hidden");
    const chips = [{ slug: "all", title: "All" }, ...state.events];
    for (const c of chips) {
      const btn = document.createElement("button");
      btn.className = "filter-chip" + (state.activeSlug === c.slug ? " is-active" : "");
      btn.textContent = c.title;
      btn.dataset.slug = c.slug;
      btn.addEventListener("click", () => {
        state.activeSlug = c.slug;
        $$(".filter-chip", bar).forEach(b => b.classList.toggle("is-active", b.dataset.slug === c.slug));
        if (c.slug === "all") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          const target = document.getElementById("event-" + c.slug);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      bar.appendChild(btn);
    }
  }

  function renderEvents() {
    const root = $("#events");
    root.innerHTML = "";
    if (state.events.length === 0) {
      renderEmpty("まだ写真がありません。管理者モードからアップロードしてください。");
      return;
    }
    for (const e of state.events) {
      const section = document.createElement("section");
      section.className = "event";
      section.id = "event-" + e.slug;

      const header = document.createElement("div");
      header.className = "event__header";
      header.innerHTML = `
        <div class="event__date">${formatDate(e.date)}</div>
        <h2 class="event__title">${escapeHtml(e.title || "Untitled")}</h2>
        ${e.description ? `<p class="event__desc">${escapeHtml(e.description)}</p>` : ""}
      `;
      section.appendChild(header);

      const masonry = document.createElement("div");
      masonry.className = "masonry";
      (e.photos || []).forEach((p, i) => masonry.appendChild(photoEl(p, e, i)));
      section.appendChild(masonry);
      root.appendChild(section);
    }
    observeFadeIn();
  }

  function photoEl(p, event, i) {
    const fig = document.createElement("figure");
    fig.className = "photo";
    fig.dataset.event = event.slug;
    fig.dataset.index = i;
    const aspect = (p.w && p.h) ? `aspect-ratio: ${p.w} / ${p.h};` : "";
    fig.innerHTML = `
      <div class="photo__frame" style="${aspect}">
        <img loading="lazy" src="${encodeURI(p.src)}" alt="${escapeHtml(p.caption || event.title || "")}">
      </div>
      ${p.caption ? `<figcaption class="photo__caption">${escapeHtml(p.caption)}</figcaption>` : ""}
    `;
    fig.addEventListener("click", () => openLightbox(event.slug, i));
    return fig;
  }

  function renderEmpty(msg) {
    $("#events").innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
  }

  function observeFadeIn() {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    $$(".photo").forEach(el => io.observe(el));
  }

  // ---------- Lightbox ----------
  const lb = {
    el: null, img: null, cap: null,
    current: null, list: [],
    open(list, idx) {
      this.list = list;
      this.current = idx;
      this.update();
      this.el.classList.add("is-open");
      document.body.style.overflow = "hidden";
    },
    close() {
      this.el.classList.remove("is-open");
      document.body.style.overflow = "";
    },
    next(dir) {
      this.current = (this.current + dir + this.list.length) % this.list.length;
      this.update();
    },
    update() {
      const p = this.list[this.current];
      this.img.src = encodeURI(p.src);
      this.img.alt = p.caption || "";
      this.cap.textContent = p.caption || "";
    }
  };

  function openLightbox(eventSlug, indexInEvent) {
    const event = state.events.find(e => e.slug === eventSlug);
    if (!event) return;
    lb.open(event.photos, indexInEvent);
  }

  function initLightbox() {
    lb.el = $("#lightbox");
    lb.img = $("#lightbox-img");
    lb.cap = $("#lightbox-cap");
    $("#lightbox-close").addEventListener("click", () => lb.close());
    $("#lightbox-prev").addEventListener("click", (e) => { e.stopPropagation(); lb.next(-1); });
    $("#lightbox-next").addEventListener("click", (e) => { e.stopPropagation(); lb.next(+1); });
    lb.el.addEventListener("click", (e) => { if (e.target === lb.el) lb.close(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.el.classList.contains("is-open")) return;
      if (e.key === "Escape") lb.close();
      else if (e.key === "ArrowLeft") lb.next(-1);
      else if (e.key === "ArrowRight") lb.next(+1);
    });
  }

  // ---------- Utils ----------
  function formatDate(d) {
    if (!d) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return d;
    return `${m[1]}.${m[2]}.${m[3]}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function render() {
    renderHeader();
    renderFilter();
    renderEvents();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initLightbox();
    load();
  });
})();
