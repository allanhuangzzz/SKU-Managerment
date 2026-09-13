/* ============ 公共逻辑 ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(url, method = "GET", body) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) {
      // FormData 由浏览器自动设置 multipart 边界，不能手动指定 Content-Type
      opts.body = body;
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const resp = await fetch(url, opts);
  let data = null;
  try { data = await resp.json(); } catch (e) { /* 非 JSON 响应 */ }
  if (!resp.ok) throw new Error((data && data.message) || `请求失败（${resp.status}）`);
  return data;
}

/* ---------- 提示 ---------- */
function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

/* ---------- 弹窗 ---------- */
function openModal({ title, body, buttons, wide }) {
  const overlay = $("#modal-overlay");
  const box = $("#modal-box");
  box.classList.toggle("modal-lg", !!wide);
  box.innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" data-close>×</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">
      <button class="btn" data-close>取消</button>
      ${(buttons || "").trim()}
    </div>`;
  overlay.style.display = "flex";
  const close = () => { overlay.style.display = "none"; };
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  return { box, overlay, close };
}

function confirmDialog(message, onConfirm) {
  openModal({
    title: "操作确认",
    body: `<div class="modal-note" style="font-size:14px">${message}</div>`,
    buttons: `<button class="btn btn-primary" data-confirm>确定</button>`,
  }).box.querySelector("[data-confirm]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await onConfirm(btn);
  });
}

/* ---------- 格式化 ---------- */
function fmtMoney(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtNum(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(Number(v));
}
function fmtWeightRange(min, max) {
  const m = max === null || max === undefined ? "∞" : fmtNum(max);
  return `${fmtNum(min)} ~ ${m}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ---------- 视图切换 ---------- */
const views = { products: "产品信息", shipping: "运费维护", commissions: "佣金维护", taxes: "税费维护", rates: "汇率维护" };
let currentView = "products";

function switchView(name) {
  if (!views[name]) return;
  currentView = name;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  $("#page-title").textContent = views[name];
  const toolbar = $("#toolbar");
  toolbar.innerHTML = "";
  if (name === "products") Products.renderToolbar(toolbar);
  else if (name === "shipping") Shipping.renderToolbar(toolbar);
  else if (name === "commissions") Commissions.renderToolbar(toolbar);
  else if (name === "taxes") Taxes.renderToolbar(toolbar);
  else if (name === "rates") Rates.renderToolbar(toolbar);
  if (name === "products") Products.load();
  else if (name === "shipping") Shipping.load();
  else if (name === "commissions") Commissions.load();
  else if (name === "taxes") Taxes.load();
  else if (name === "rates") Rates.load();
}

/* 汇率过期检查：超过 6 小时未自动更新则静默刷新 */
async function ensureFreshRates(silent = true) {
  try {
    const st = await api("/api/exchange-rates/status");
    if (st.stale) {
      const r = await api("/api/exchange-rates/refresh", "POST");
      if (!silent) toast(`已刷新汇率，更新 ${r.updated} 个币种`, "success");
    }
  } catch (e) { /* 静默失败，不打扰用户 */ }
}

/* ---------- 系统更新（一键更新，交由 Watchtower 拉取并重建容器） ---------- */
const SystemUpdate = {
  version: null,
  running: false,

  short(v) { return String(v || "dev").slice(0, 7); },

  async init() {
    const btn = $("#btn-system-update");
    let st = null;
    try { st = await api("/api/system/version"); } catch (e) { return; }
    this.version = st.version;
    $("#ver-text").textContent = this.short(st.version);
    if (!st.update_enabled) {
      btn.title = "本地运行模式不支持一键更新，请在群晖 Container Manager 中更新";
      return;
    }
    btn.disabled = false;
    btn.addEventListener("click", () => this.run());
  },

  async run() {
    if (this.running) return;
    this.running = true;
    const oldVer = this.version;
    const { box } = openModal({
      title: "系统更新",
      body: `<div class="update-status" id="upd-status"><span class="spinner"></span>正在触发更新检查...</div>
             <div class="update-tip">
               更新流程：检查远端最新镜像 → 有新版本则拉取 → 重建容器并重启应用。<br>
               若已是最新版本，服务不会重启，可继续正常使用；更新期间页面会短暂无法访问，属正常现象。
             </div>`,
      buttons: `<button class="btn btn-primary" id="upd-reload" style="display:none">刷新页面</button>`,
    });
    const status = box.querySelector("#upd-status");
    const reloadBtn = box.querySelector("#upd-reload");
    const setStatus = (html, cls = "") => {
      status.className = "update-status " + cls;
      status.innerHTML = html;
    };
    const finish = (html, cls) => {
      setStatus(html, cls);
      if (cls === "ok") {
        reloadBtn.style.display = "";
        reloadBtn.addEventListener("click", () => location.reload());
      }
      this.running = false;
    };

    try {
      await api("/api/system/update", "POST");
    } catch (e) {
      finish(`更新触发失败：${esc(e.message)}`, "err");
      return;
    }

    const deadline = Date.now() + 180000;
    let restarted = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      let st = null;
      try { st = await api("/api/system/version"); } catch (e) { st = null; }

      if (!st) {                        // 服务暂时不可达 → 容器正在重建
        restarted = true;
        setStatus(`<span class="spinner"></span>应用正在重建重启，等待服务恢复...`);
        continue;
      }
      if (st.version !== oldVer) {      // 版本已变化 → 更新成功
        this.version = st.version;
        $("#ver-text").textContent = this.short(st.version);
        finish(`更新完成：${this.short(oldVer)} → ${this.short(st.version)}`, "ok");
        return;
      }
      if (st.update_error) {            // 触发/拉取失败
        finish(st.update_error, "err");
        return;
      }
      if (restarted) {                  // 已重启但版本未变
        finish(`已重建容器，版本仍为 ${this.short(oldVer)}`, "ok");
        return;
      }
      setStatus(`<span class="spinner"></span>正在检查并拉取最新镜像（已等待 ${Math.round((180000 - (deadline - Date.now())) / 1000)} 秒）...`);
    }
    finish("已是最新版本，无需更新。", "ok");
  },
};

document.addEventListener("DOMContentLoaded", () => {
  $$(".nav-item").forEach((n) => n.addEventListener("click", () => switchView(n.dataset.view)));
  switchView("products");
  SystemUpdate.init();
});
