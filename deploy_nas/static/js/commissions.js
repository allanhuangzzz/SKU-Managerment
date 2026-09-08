/* ============ 佣金维护模块 ============ */
const Commissions = {
  data: [],

  renderToolbar(toolbar) {
    toolbar.innerHTML = `<span style="font-size:13px;color:var(--text-secondary)">可编辑各国家平台佣金率</span>`;
  },

  async load() {
    const tbody = $("#commission-tbody");
    tbody.innerHTML = `<tr><td colspan="4"><div class="loading"><span class="spinner"></span>加载中...</div></td></tr>`;
    try {
      this.data = await api("/api/commissions");
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">加载失败：${esc(e.message)}</td></tr>`;
    }
  },

  render() {
    const tbody = $("#commission-tbody");
    if (!this.data.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">暂无佣金数据</td></tr>`;
      return;
    }
    tbody.innerHTML = this.data.map((r) => `
      <tr data-id="${r.country_id}">
        <td>${esc(r.country_name)}</td>
        <td>${esc(r.country_code)}</td>
        <td class="num"><b>${fmtNum(r.rate)}%</b></td>
        <td class="op">
          <button class="link-btn" data-edit="${r.country_id}">修改</button>
        </td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => this.openModal(Number(b.dataset.edit))));
  },

  openModal(countryId) {
    const row = this.data.find((x) => x.country_id === countryId);
    if (!row) return;
    const body = `
      <div class="form-grid">
        <div class="form-item"><label>国家</label>
          <input class="input" value="${esc(row.country_name)}" disabled></div>
        <div class="form-item"><label>佣金率（%）<span class="req">*</span></label>
          <input class="input" type="number" step="0.1" min="0" max="99.9" id="c-rate" value="${row.rate}"></div>
      </div>
      <div class="modal-note">该佣金率将用于产品运费明细中的盈亏平衡售价计算。<br>计算公式：盈亏平衡售价 = (进货价 + 国内运费 + 国外运费(RMB)) / (1 - 佣金率)</div>`;
    const { box, close } = openModal({
      title: `修改佣金率（${esc(row.country_name)}）`,
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-commission">保存</button>`,
    });
    $("#btn-save-commission").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const v = $("#c-rate").value;
      if (v === "" || Number(v) <= 0 || Number(v) >= 100) {
        toast("佣金率必须在 0~100 之间", "error"); return;
      }
      btn.disabled = true;
      try {
        await api(`/api/commissions/${countryId}`, "PUT", { rate: v });
        toast("保存成功", "success");
        close();
        this.load();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  },
};