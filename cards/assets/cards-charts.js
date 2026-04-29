// Tiny SVG chart helpers — no dependencies.
// Exposes window.CardsCharts = { renderLineDaily, renderBarMonthly, renderDonutCategory, formatYen }.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(name, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      node.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    }
    return node;
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function formatYen(n) {
    if (n == null || isNaN(n)) return "—";
    const sign = n < 0 ? "-" : "";
    return sign + "¥" + Math.abs(Math.round(n)).toLocaleString("en-US");
  }

  function niceMax(v) {
    if (v <= 0) return 1000;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    let nice;
    if (n <= 1) nice = 1;
    else if (n <= 2) nice = 2;
    else if (n <= 5) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  // ---------- Daily line chart ----------
  // points: [{ date: "YYYY-MM-DD", paypay: number, saison: number }]
  function renderLineDaily(svg, points, opts = {}) {
    clearSvg(svg);
    const W = 800, H = 280;
    const PAD_L = 56, PAD_R = 16, PAD_T = 16, PAD_B = 32;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");

    if (!points.length) {
      svg.appendChild(el("text", {
        x: W / 2, y: H / 2, "text-anchor": "middle",
        class: "axis-label",
      }, ["データがありません"]));
      return;
    }

    const maxV = niceMax(Math.max(1, ...points.flatMap(p => [p.paypay || 0, p.saison || 0])));
    const x = i => PAD_L + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
    const y = v => PAD_T + innerH - (innerH * v) / maxV;

    // Y grid
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV * i) / ticks;
      const yy = y(v);
      svg.appendChild(el("line", { x1: PAD_L, x2: W - PAD_R, y1: yy, y2: yy, class: "axis-line" }));
      svg.appendChild(el("text", {
        x: PAD_L - 6, y: yy + 3, "text-anchor": "end", class: "axis-label",
      }, [formatYen(v).replace("¥", "¥ ")]));
    }

    // X labels: first, mid, last
    const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    for (const i of labelIdx) {
      svg.appendChild(el("text", {
        x: x(i), y: H - PAD_B + 18, "text-anchor": "middle", class: "axis-label",
      }, [points[i].date.slice(5)]));
    }

    // Lines
    for (const card of ["paypay", "saison"]) {
      const cls = card === "paypay" ? "line-paypay" : "line-saison";
      const dotCls = card === "paypay" ? "dot-paypay" : "dot-saison";
      let d = "";
      points.forEach((p, i) => {
        const v = p[card] || 0;
        const xx = x(i), yy = y(v);
        d += (i === 0 ? "M" : "L") + xx.toFixed(2) + " " + yy.toFixed(2) + " ";
      });
      if (d) svg.appendChild(el("path", { d: d.trim(), class: cls }));
      // dots only when small dataset
      if (points.length <= 31) {
        points.forEach((p, i) => {
          const v = p[card] || 0;
          if (v > 0) svg.appendChild(el("circle", { cx: x(i), cy: y(v), r: 2.5, class: dotCls }));
        });
      }
    }

    // Hover overlay
    if (opts.tooltip) attachHover(svg, points, x, y, PAD_L, PAD_R, PAD_T, PAD_B, W, H, opts.tooltip);
  }

  function attachHover(svg, points, x, y, PAD_L, PAD_R, PAD_T, PAD_B, W, H, tipEl) {
    const overlay = el("rect", {
      x: PAD_L, y: PAD_T, width: W - PAD_L - PAD_R, height: H - PAD_T - PAD_B,
      fill: "transparent",
    });
    const hoverLine = el("line", {
      x1: 0, x2: 0, y1: PAD_T, y2: H - PAD_B, class: "hover-line",
      style: "display:none",
    });
    svg.appendChild(hoverLine);
    svg.appendChild(overlay);

    overlay.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) * (W / rect.width);
      // Find nearest point
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = Math.abs(x(i) - sx);
        if (dx < bestD) { bestD = dx; bestI = i; }
      }
      const p = points[bestI];
      hoverLine.setAttribute("x1", x(bestI));
      hoverLine.setAttribute("x2", x(bestI));
      hoverLine.style.display = "";
      tipEl.classList.add("is-on");
      tipEl.innerHTML = `<strong>${p.date}</strong><br>` +
        `PayPay ${formatYen(p.paypay || 0)}<br>` +
        `セゾン ${formatYen(p.saison || 0)}`;
      tipEl.style.left = (ev.clientX - rect.left + 12) + "px";
      tipEl.style.top = (ev.clientY - rect.top + 12) + "px";
    });
    overlay.addEventListener("mouseleave", () => {
      hoverLine.style.display = "none";
      tipEl.classList.remove("is-on");
    });
  }

  // ---------- Monthly stacked bar ----------
  // months: [{ month: "YYYY-MM", paypay, saison }]
  function renderBarMonthly(svg, months, opts = {}) {
    clearSvg(svg);
    const W = 800, H = 260;
    const PAD_L = 56, PAD_R = 16, PAD_T = 16, PAD_B = 36;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    if (!months.length) {
      svg.appendChild(el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-label" }, ["データがありません"]));
      return;
    }

    const totals = months.map(m => (m.paypay || 0) + (m.saison || 0));
    const maxV = niceMax(Math.max(1, ...totals));
    const slot = innerW / months.length;
    const barW = Math.max(8, slot * 0.6);

    const yTo = v => PAD_T + innerH - (innerH * v) / maxV;
    // Y grid
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV * i) / ticks;
      const yy = yTo(v);
      svg.appendChild(el("line", { x1: PAD_L, x2: W - PAD_R, y1: yy, y2: yy, class: "axis-line" }));
      svg.appendChild(el("text", { x: PAD_L - 6, y: yy + 3, "text-anchor": "end", class: "axis-label" }, [formatYen(v).replace("¥", "¥ ")]));
    }

    months.forEach((m, i) => {
      const cx = PAD_L + slot * (i + 0.5);
      const xLeft = cx - barW / 2;
      const py = m.paypay || 0;
      const sy = m.saison || 0;
      const top = yTo(py + sy);
      const mid = yTo(sy);
      const base = yTo(0);
      // saison bottom
      if (sy > 0) {
        svg.appendChild(el("rect", { x: xLeft, y: mid, width: barW, height: base - mid, class: "bar-saison" }));
      }
      // paypay top
      if (py > 0) {
        svg.appendChild(el("rect", { x: xLeft, y: top, width: barW, height: mid - top, class: "bar-paypay" }));
      }
      // x label
      svg.appendChild(el("text", {
        x: cx, y: H - PAD_B + 16, "text-anchor": "middle", class: "axis-label",
      }, [m.month.slice(2)]));
    });
  }

  // ---------- Donut for categories ----------
  // slices: [{ label: "食費", value: 12345 }] (already sorted desc, top-N)
  function renderDonutCategory(svg, slices, opts = {}) {
    clearSvg(svg);
    const W = 360, H = 260;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const cx = 130, cy = H / 2, r = 90, ir = 60;

    const total = slices.reduce((s, x) => s + x.value, 0);
    if (!total) {
      svg.appendChild(el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-label" }, ["データがありません"]));
      return;
    }

    const palette = ["#1f1d1a", "#5a544c", "#9a938a", "#b8474a", "#2f5d7c", "#7a8a5a", "#c08a3e", "#8a4a7a", "#4a8a8a"];
    let a0 = -Math.PI / 2;
    slices.forEach((s, i) => {
      const frac = s.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const ix0 = cx + ir * Math.cos(a0), iy0 = cy + ir * Math.sin(a0);
      const ix1 = cx + ir * Math.cos(a1), iy1 = cy + ir * Math.sin(a1);
      const d = [
        `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
        `A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
        `A ${ir} ${ir} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,
        "Z",
      ].join(" ");
      svg.appendChild(el("path", { d, fill: palette[i % palette.length], stroke: "#fff", "stroke-width": 1 }));
      a0 = a1;
    });

    // Center total
    svg.appendChild(el("text", {
      x: cx, y: cy - 4, "text-anchor": "middle", class: "donut-label",
    }, [formatYen(total)]));
    svg.appendChild(el("text", {
      x: cx, y: cy + 14, "text-anchor": "middle", class: "axis-label",
    }, ["TOTAL"]));

    // Legend (right side)
    const legendX = 240;
    let legendY = 40;
    slices.forEach((s, i) => {
      const pct = ((s.value / total) * 100).toFixed(1);
      svg.appendChild(el("rect", { x: legendX, y: legendY - 8, width: 10, height: 10, fill: palette[i % palette.length] }));
      svg.appendChild(el("text", { x: legendX + 16, y: legendY + 1, class: "axis-label" }, [`${s.label} ${pct}%`]));
      legendY += 20;
    });
  }

  window.CardsCharts = { renderLineDaily, renderBarMonthly, renderDonutCategory, formatYen };
})();
