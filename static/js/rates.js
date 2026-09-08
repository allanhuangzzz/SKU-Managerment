/* ============ 汇率维护模块 ============ */
const Rates = {
  data: [],

  renderToolbar(toolbar) {
    toolbar.innerHTML = `
      <span class="rates-last" id="rates-last" style="font-size:13px;color:var(--text-secondary)"></span>
      <button class="btn" id="btn-refresh-rates">刷新实时汇率</button>
      <button class="btn btn-primary" id="btn-add-country">新增国家</button>`;
    $("#btn-refresh-rates").addEventListener("click", () => this.refresh());
    $("#btn-add-country").addEventListener("click", () => this.openCountryModal());
  },

  async load() {
    await ensureFreshRates();
    const tbody = $("#rates-tbody");
    tbody.innerHTML = `<tr><td colspan="7"><div class="loading"><span class="spinner"></span>加载中...</div></td></tr>`;
    try {
      const st = await api("/api/exchange-rates/status");
      const tip = $("#rates-tip");
      tip.textContent = st.last_auto_update
        ? `最近一次自动更新：${st.last_auto_update}${st.stale ? "（已超过 6 小时，可点击「刷新实时汇率」获取最新）" : ""}`
        : "尚未获取过实时汇率，点击右上角「刷新实时汇率」从公开接口获取最新汇率。";
      this.data = await api("/api/exchange-rates");
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">加载失败：${esc(e.message)}</td></tr>`;
    }
  },

  render() {
    const tbody = $("#rates-tbody");
    if (!this.data.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">暂无国家数据</td></tr>`;
      return;
    }
    tbody.innerHTML = this.data.map((r) => `
      <tr data-id="${r.country_id}">
        <td>${esc(r.country_name)}</td>
        <td>${esc(r.country_code)}</td>
        <td><span class="sku-badge">${esc(r.currency_code)}</span></td>
        <td class="num">${r.rate_to_cny != null ? fmtNum(r.rate_to_cny) : '<span style="color:#d64545">未设置</span>'}</td>
        <td>${r.source === "auto" ? '<span class="tag tag-auto">自动</span>' : '<span class="tag tag-manual">手动</span>'}</td>
        <td>${r.updated_at || "—"}</td>
        <td class="op">
          <button class="link-btn" data-rate="${r.rate_id || ""}" data-currency="${esc(r.currency_code)}" ${r.rate_id ? "" : "disabled"}>改汇率</button>
          <button class="link-btn" data-edit="${r.country_id}">编辑</button>
          <button class="link-btn" data-del="${r.country_id}" style="color:var(--danger)">删除</button>
        </td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-rate]").forEach((b) =>
      b.addEventListener("click", () => this.openRateModal(Number(b.dataset.rate), b.dataset.currency)));
    tbody.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => this.openCountryModal(Number(b.dataset.edit))));
    tbody.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => this.removeCountry(Number(b.dataset.del))));
  },

  async refresh() {
    const btn = $("#btn-refresh-rates");
    const last = $("#rates-last");
    if (btn.disabled) return;
    btn.disabled = true;
    last.textContent = "正在获取实时汇率...";
    try {
      const r = await api("/api/exchange-rates/refresh", "POST");
      last.textContent = `更新于 ${r.as_of}（${r.source}）`;
      toast(`汇率刷新成功，更新 ${r.updated} 个币种`, "success");
      this.load();
    } catch (e) {
      last.textContent = "";
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
    }
  },

  openRateModal(rateId, currency) {
    const body = `
      <div class="form-grid">
        <div class="form-item full"><label>币种</label>
          <input class="input" value="${esc(currency)}" disabled></div>
        <div class="form-item full"><label>1 ${esc(currency)} = ? 人民币<span class="req">*</span></label>
          <input class="input" type="number" step="0.000001" min="0" id="rate-value"></div>
      </div>
      <div class="modal-note">手动修改后该币种来源将标记为「手动」，刷新实时汇率时会覆盖为最新值。</div>`;
    const { box, close } = openModal({
      title: `修改汇率（${esc(currency)}）`,
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-rate">保存</button>`,
    });
    $("#btn-save-rate").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const v = $("#rate-value").value;
      if (v === "" || Number(v) <= 0) { toast("请输入大于 0 的汇率", "error"); return; }
      btn.disabled = true;
      try {
        await api(`/api/exchange-rates/${rateId}`, "PUT", { rate_to_cny: v });
        toast("保存成功", "success");
        close();
        this.load();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  },

  openCountryModal(id) {
    const row = this.data.find((x) => x.country_id === id);
    const body = `
      <div class="form-grid">
        <div class="form-item"><label>国家名称<span class="req">*</span></label>
          <input class="input" id="c-name" value="${esc(row ? row.country_name : "")}" placeholder="如：法国"></div>
        <div class="form-item"><label>国家代码<span class="req">*</span></label>
          <input class="input" id="c-code" value="${esc(row ? row.country_code : "")}" placeholder="如：FR" style="text-transform:uppercase"></div>
        <div class="form-item"><label>币种代码<span class="req">*</span></label>
          <input class="input" id="c-currency" value="${esc(row ? row.currency_code : "")}" placeholder="如：EUR" style="text-transform:uppercase"></div>
        <div class="form-item"><label>汇率（可选）</label>
          <input class="input" type="number" step="0.000001" min="0" id="c-rate" value="${row && row.rate_to_cny != null ? row.rate_to_cny : ""}" placeholder="留空则尝试自动获取"></div>
      </div>
      <div class="modal-note">填写汇率将保存为手动值；留空时系统会尝试从公开接口自动获取该币种的实时汇率。</div>`;
    const { box, close } = openModal({
      title: id ? "编辑国家" : "新增国家",
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-country">保存</button>`,
    });
    $("#btn-save-country").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const payload = {
        name: $("#c-name").value.trim(),
        code: $("#c-code").value.trim().toUpperCase(),
        currency_code: $("#c-currency").value.trim().toUpperCase(),
        rate_to_cny: $("#c-rate").value,
      };
      if (!payload.name || !payload.code || !payload.currency_code) {
        toast("国家名称、国家代码、币种均不能为空", "error"); return;
      }
      btn.disabled = true;
      try {
        if (id) { await api(`/api/countries/${id}`, "PUT", payload); toast("保存成功", "success"); }
        else { await api("/api/countries", "POST", payload); toast("新增成功", "success"); }
        close();
        this.load();
        Shipping.load(); // 同步运费模块的国家下拉
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  },

  removeCountry(id) {
    const row = this.data.find((x) => x.country_id === id);
    confirmDialog(
      `确定删除国家「${esc(row ? row.country_name : id)}」吗？<br>该国家下的所有运费规则将一并删除。`,
      async (btn) => {
        try {
          await api(`/api/countries/${id}`, "DELETE");
          toast("已删除", "success");
          btn.closest(".modal-overlay").style.display = "none";
          this.load();
          Shipping.load();
        } catch (e) { toast(e.message, "error"); btn.disabled = false; }
      });
  },
};
