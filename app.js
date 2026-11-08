/* 小账本：本地账单台账 */
(function () {
  "use strict";

  const BP = window.BillParser;
  const CATS = BP.CATS;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const money = (n) =>
    "¥" + Math.abs(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const LS_KEY = "ledger.v1.transactions";
  const state = { view: "overview", month: "all", dir: "all", cat: "all", q: "", net: false, limit: 60 };
  let TX = [];
  let storageOk = true;

  /* ---------------- 存储 ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      TX = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(TX)) TX = [];
    } catch (e) {
      storageOk = false;
      TX = [];
    }
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(TX));
    } catch (e) {
      storageOk = false;
      toast("保存失败：浏览器存储不可用或空间不足，先把数据导出一份");
    }
  }

  /* ---------------- 小工具 ---------------- */
  const monthOf = (t) => t.time.slice(0, 7);
  const inMonth = (t) => state.month === "all" || monthOf(t) === state.month;
  const sum = (list) => list.reduce((a, b) => a + b.amount, 0);
  const refundCat = (t) => t.refundCat || BP.baseCat(t);
  const catOf = (t) => CATS.includes(t.category) ? t.category : "其他";

  let toastTimer = 0;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2400);
  }

  /* ---------------- 统计 ---------------- */
  function scoped() {
    return TX.filter(inMonth);
  }
  function overviewStats() {
    const list = scoped();
    const exp = sum(list.filter((t) => t.direction === "支出"));
    const inc = sum(list.filter((t) => t.direction === "收入"));
    const refunds = list.filter(BP.isRefund);
    const rf = sum(refunds);
    const deduct = state.net ? rf : 0;
    return {
      exp: exp - deduct,
      inc: state.net ? inc - deduct : inc,
      count: list.length,
      refund: rf,
      refundCount: refunds.length,
    };
  }

  /* ---------------- 顶栏 ---------------- */
  function renderHead() {
    const months = [...new Set(TX.map(monthOf))].sort();
    const sel = $("#monthSel");
    sel.innerHTML = '<option value="all">全部</option>' +
      months.slice().reverse().map((m) => `<option value="${m}">${m}</option>`).join("");
    sel.value = state.month;

    const sub = $("#headSub");
    if (!TX.length) {
      sub.textContent = "还没有数据，去「导入」加一份账单";
      return;
    }
    const times = TX.map((t) => t.time).sort();
    const srcs = [...new Set(TX.map((t) => t.source))].join(" · ");
    sub.textContent = `${TX.length} 笔 · ${times[0].slice(0, 10)} ~ ${times[times.length - 1].slice(0, 10)} · ${srcs}`;
  }

  /* ---------------- 总览 ---------------- */
  function renderOverview() {
    const s = overviewStats();
    $("#kExpLabel").textContent = state.net ? "支出（净）" : "支出";
    $("#kIncLabel").textContent = state.net ? "收入（净）" : "收入";
    $("#kExp").textContent = TX.length ? money(s.exp) : "—";
    $("#kInc").textContent = TX.length ? money(s.inc) : "—";
    $("#kNet").textContent = TX.length
      ? (s.inc - s.exp >= 0 ? "+" : "-") + money(s.inc - s.exp).slice(1)
      : "—";
    $("#kCnt").textContent = TX.length ? s.count + " 笔" : "—";

    const note = $("#netNote");
    if (state.net && TX.length) {
      note.style.display = "";
      note.textContent = `净额口径：把 ${s.refundCount} 笔退款（${money(s.refund)}）从支出和收入里同时扣掉。退款按到账时间算，可能和原消费不在同一个月。`;
    } else {
      note.style.display = "none";
    }

    renderMonthChart();
    renderCatList();
  }

  function renderMonthChart() {
    const months = [...new Set(TX.map(monthOf))].sort().slice(-8);
    const box = $("#monthChart");
    if (!months.length) {
      box.innerHTML = '<div class="empty">导入账单后这里会出现月度趋势</div>';
      return;
    }
    const data = months.map((m) => {
      const list = TX.filter((t) => monthOf(t) === m);
      let exp = sum(list.filter((t) => t.direction === "支出"));
      let inc = sum(list.filter((t) => t.direction === "收入"));
      if (state.net) {
        const rf = sum(list.filter(BP.isRefund));
        exp -= rf;
        inc -= rf;
      }
      return { m, exp, inc };
    });
    const W = 340, H = 180, pad = { l: 36, r: 6, t: 10, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...data.map((d) => Math.max(d.exp, d.inc)));
    const step = iw / data.length;
    const bw = Math.min(18, step / 3.2);
    const y = (v) => pad.t + ih - (v / max) * ih;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="月度收支">`;
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i, yy = y(v);
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="#f0f2f5"/>`;
      svg += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#8a9099">${v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v)}</text>`;
    }
    data.forEach((d, i) => {
      const cx = pad.l + step * i + step / 2;
      const active = state.month === d.m;
      const op = state.month === "all" || active ? 1 : 0.35;
      svg += `<g class="bar" data-month="${d.m}" opacity="${op}" style="cursor:pointer">
        <title>${d.m} 支出 ${money(d.exp)} 收入 ${money(d.inc)}</title>
        <rect x="${cx - bw - 1.5}" y="${y(d.exp)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(d.exp))}" rx="2.5" fill="#e0554e"/>
        <rect x="${cx + 1.5}" y="${y(d.inc)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(d.inc))}" rx="2.5" fill="#2e9e6b"/>
        <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${active ? "#1b1f26" : "#8a9099"}" font-weight="${active ? 600 : 400}">${d.m.slice(5)}月</text>
      </g>`;
    });
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#e8eaee"/></svg>`;
    box.innerHTML = svg;
    box.querySelectorAll(".bar").forEach((g) =>
      g.addEventListener("click", () => {
        const m = g.dataset.month;
        state.month = state.month === m ? "all" : m;
        $("#monthSel").value = state.month;
        renderHead();
        renderOverview();
        renderDetail();
      })
    );
  }

  function renderCatList() {
    const box = $("#catList");
    const scope = scoped().filter((t) => t.direction === "支出");
    const by = {};
    scope.forEach((t) => (by[catOf(t)] = (by[catOf(t)] || 0) + t.amount));
    if (state.net) {
      scoped().filter(BP.isRefund).forEach((t) => {
        const c = refundCat(t);
        by[c] = (by[c] || 0) - t.amount;
      });
    }
    const items = Object.entries(by).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!items.length) {
      box.innerHTML = '<div class="empty">还没有支出记录</div>';
      return;
    }
    const total = items.reduce((a, b) => a + b[1], 0) || 1;
    const max = items[0][1];
    box.innerHTML = items.map(([cat, v]) => {
      const on = state.cat === cat;
      return `<div class="cat-row ${on ? "on" : ""}" data-cat="${cat}">
        <span class="name">${cat}</span>
        <span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span></span>
        <span class="amt">${money(v)}<br><em>${((v / total) * 100).toFixed(0)}%</em></span>
      </div>`;
    }).join("");
    box.querySelectorAll(".cat-row").forEach((el) =>
      el.addEventListener("click", () => {
        state.cat = state.cat === el.dataset.cat ? "all" : el.dataset.cat;
        $("#fCat").value = state.cat;
        state.view = "detail";
        state.limit = 60;
        paint();
      })
    );
  }

  /* ---------------- 明细 ---------------- */
  function detailRows() {
    const q = state.q.toLowerCase();
    return TX.filter(
      (t) =>
        inMonth(t) &&
        (state.dir === "all" || t.direction === state.dir) &&
        (state.cat === "all" || catOf(t) === state.cat) &&
        (!q || (t.counterparty + " " + t.item + " " + t.type + " " + t.method + " " + t.id).toLowerCase().includes(q))
    ).sort((a, b) => b.time.localeCompare(a.time));
  }

  function renderDetail() {
    const box = $("#txList");
    const all = detailRows();
    if (!all.length) {
      box.innerHTML = '<div class="empty">没有符合条件的记录<br>换个筛选，或者去「导入」加数据</div>';
      return;
    }
    const list = all.slice(0, state.limit);

    const groups = [];
    let cur = null;
    list.forEach((t) => {
      const d = t.time.slice(0, 10);
      if (!cur || cur.day !== d) { cur = { day: d, rows: [], sum: 0 }; groups.push(cur); }
      cur.rows.push(t);
      if (t.direction !== "其他") cur.sum += t.direction === "支出" ? t.amount : -t.amount;
    });

    const rowHtml = (t) => {
      const cls = t.direction === "支出" ? "exp" : t.direction === "收入" ? "inc" : "other";
      const sign = t.direction === "支出" ? "−" : t.direction === "收入" ? "+" : "";
      const cat = catOf(t);
      const edited = t._edited ? "edited" : "";
      return `<div class="tx">
        <div class="mid">
          <div class="who">${escapeHtml(t.counterparty) || "—"}${t.item ? ` <span class="pill">${escapeHtml(t.item).slice(0, 12)}</span>` : ""}</div>
          <div class="meta">
            <select class="cat-sel ${edited}" data-key="${escapeHtml(t.source + "|" + t.id)}">${CATS.map((c) => `<option ${c === cat ? "selected" : ""}>${c}</option>`).join("")}</select>
            <span class="pill src">${escapeHtml(t.source)}</span>
            <span>${t.time.slice(11, 16)}</span>
            ${t.method ? `<span>${escapeHtml(t.method).slice(0, 14)}</span>` : ""}
          </div>
        </div>
        <div class="right"><div class="amt ${cls}">${sign}${money(t.amount).slice(1)}</div></div>
      </div>`;
    };

    let html = groups.map((g) =>
      `<div class="day-group"><div class="day-head"><span>${g.day.slice(5)}</span><span>${money(g.sum)}</span></div>` +
      g.rows.map(rowHtml).join("") + "</div>"
    ).join("");

    if (all.length > state.limit) {
      html += `<button class="more" id="moreBtn">还有 ${all.length - state.limit} 笔，显示更多</button>`;
    }
    box.innerHTML = html;
    box.querySelectorAll(".cat-sel").forEach((sel) =>
      sel.addEventListener("change", (e) => {
        const key = sel.dataset.key;
        const t = TX.find((x) => x.source + "|" + x.id === key);
        if (!t) return;
        t.category = e.target.value;
        t._edited = true;
        save();
        renderOverview();
        toast("分类已更新");
      })
    );
    const more = box.querySelector("#moreBtn");
    if (more) more.addEventListener("click", () => { state.limit += 100; renderDetail(); });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- 导入 ---------------- */
  async function importFiles(files) {
    if (!files || !files.length) return;
    const box = $("#impResult");
    box.innerHTML = '<div class="empty">正在解析…</div>';
    const lines = [];
    let added = 0, dup = 0;
    const keys = new Set(TX.map((t) => t.source + "|" + t.id));

    for (const file of files) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const { results } = await BP.parseBuffer(file.name, buf);
        let fileAdded = 0;
        for (const r of results) {
          for (const t of r.transactions) {
            const k = t.source + "|" + t.id;
            if (keys.has(k)) { dup++; continue; }
            keys.add(k);
            TX.push(t);
            fileAdded++;
          }
          lines.push({
            name: r.source === "备份" ? file.name : `${file.name} → ${r.source}`,
            n: r.transactions.length,
            warn: r.warnings || [],
          });
        }
        added += fileAdded;
        if (!fileAdded && results.every((r) => r.transactions.length)) {
          lines.push({ name: file.name, n: 0, warn: ["这些记录之前已经导入过了"] });
        }
      } catch (err) {
        lines.push({ name: file.name, n: 0, warn: [String(err.message || err)] });
      }
    }

    if (added) {
      save();
      state.month = "all";
      refreshAll();
    }
    box.innerHTML =
      lines.map((l) => `<div class="line"><span>${escapeHtml(l.name)}</span><span>${l.n ? l.n + " 笔" : "—"}</span></div>`).join("") +
      (added ? `<div class="line"><b>新增 ${added} 笔</b><span>${dup ? `跳过重复 ${dup} 笔` : ""}</span></div>` : "") +
      (lines.flatMap((l) => l.warn).map((w) => `<div class="note" style="color:#c23a34">${escapeHtml(w)}</div>`).join(""));
    if (added) toast(`导入成功，新增 ${added} 笔`);
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    const box = $("#stats");
    if (!TX.length) {
      box.innerHTML = '<div class="empty">还没有数据</div>';
      return;
    }
    const bySrc = {};
    TX.forEach((t) => (bySrc[t.source] = (bySrc[t.source] || 0) + 1));
    const times = TX.map((t) => t.time).sort();
    box.innerHTML = `
      <div class="row"><span>总笔数</span><span class="v">${TX.length} 笔</span></div>
      <div class="row"><span>时间范围</span><span class="v">${times[0].slice(0, 10)} ~ ${times[times.length - 1].slice(0, 10)}</span></div>
      ${Object.entries(bySrc).map(([s, n]) => `<div class="row"><span>${s}</span><span class="v">${n} 笔</span></div>`).join("")}
      <div class="row"><span>存储</span><span class="v">${storageOk ? "本机浏览器" : "不可用（只读）"}</span></div>`;
  }

  function download(name, text, type) {
    const head = (type || "").includes("json") ? "" : "\ufeff";
    const blob = new Blob([head + text], { type: type || "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportJson() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), transactions: TX };
    download(`小账本备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1), "application/json");
    toast("已导出 JSON 备份");
  }

  function exportCsv() {
    const list = detailRows();
    if (!list.length) return toast("当前筛选没有记录");
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["日期", "时间", "来源", "收支", "金额", "分类", "交易对方", "商品", "支付方式", "交易单号"];
    const rows = list.map((t) =>
      [t.time.slice(0, 10), t.time.slice(11), t.source, t.direction, t.amount.toFixed(2), catOf(t),
       t.counterparty, t.item, t.method, t.id].map(esc).join(","));
    download(`小账本-${state.month === "all" ? "全部" : state.month}.csv`, [head.join(",")].concat(rows).join("\r\n"));
    toast(`已导出 ${list.length} 笔`);
  }

  /* ---------------- 视图切换 ---------------- */
  function paint() {
    $$(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + state.view));
    $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
    window.scrollTo(0, 0);
    renderHead();
    if (state.view === "overview") renderOverview();
    if (state.view === "detail") renderDetail();
    if (state.view === "settings") renderSettings();
  }

  function refreshAll() {
    fillCatSelect();
    renderHead();
    renderOverview();
    renderDetail();
    renderSettings();
  }

  function fillCatSelect() {
    const sel = $("#fCat");
    const cats = [...new Set(TX.map(catOf))].sort();
    sel.innerHTML = '<option value="all">分类</option>' + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
    sel.value = state.cat;
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $$("#tabbar button").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view;
        state.limit = 60;
        paint();
        if (state.view === "import") $("#seedRow").style.display = TX.length ? "none" : "";
      })
    );

    $("#monthSel").addEventListener("change", (e) => {
      state.month = e.target.value;
      state.limit = 60;
      renderHead();
      renderOverview();
      renderDetail();
    });

    $$("#modeSeg button").forEach((b) =>
      b.addEventListener("click", () => {
        state.net = b.dataset.net === "1";
        $$("#modeSeg button").forEach((x) => x.classList.toggle("on", x === b));
        renderOverview();
      })
    );

    $("#fDir").addEventListener("change", (e) => { state.dir = e.target.value; state.limit = 60; renderDetail(); });
    $("#fCat").addEventListener("change", (e) => { state.cat = e.target.value; state.limit = 60; renderDetail(); });
    let qTimer = 0;
    $("#fQ").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim(); state.limit = 60; renderDetail(); }, 180);
    });

    const drop = $("#drop");
    const input = $("#fileInput");
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => { importFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hot"); })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hot"); })
    );
    drop.addEventListener("drop", (e) => importFiles(e.dataTransfer.files));

    $("#loadSeed").addEventListener("click", async () => {
      try {
        const res = await fetch("seed/wechat-2026.json");
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        await importFiles([new File([JSON.stringify(data)], "wechat-2026.json", { type: "application/json" })]);
      } catch (e) {
        // 托管版没有 seed 文件：直接让用户挑 json
        toast("请选择你的备份文件");
        $("#fileInput").click();
      }
    });

    $("#expJson").addEventListener("click", exportJson);
    $("#expCsv").addEventListener("click", exportCsv);
    $("#clearAll").addEventListener("click", () => {
      if (!TX.length) return toast("还没有数据");
      if (!confirm(`确认清空全部 ${TX.length} 笔记录？建议先导出备份。`)) return;
      if (!confirm("再确认一次：清空后无法恢复。")) return;
      TX = [];
      save();
      state.month = "all";
      state.cat = "all";
      refreshAll();
      toast("已清空");
    });
  }

  /* ---------------- 启动 ---------------- */
  load();
  bind();
  refreshAll();
  if (!TX.length) $("#seedRow").style.display = "";
  if (!storageOk) toast("浏览器存储不可用，导入的数据不会保存");

  // 允许从其他页面直接带筛选进入
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "detail") { state.view = "detail"; paint(); }
})();
