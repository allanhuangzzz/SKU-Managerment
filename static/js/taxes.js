/* ============ 税费维护模块 ============ */
const Taxes = {
  data: [],

  renderToolbar(toolbar) {
    toolbar.innerHTML = `<span style="font-size:13px;color:var(--text-secondary)">可编辑各国家税率与固定附加费</span>`;
  },

  async load() {
    const tbody = $("#tax-tbody");
    tbody.innerHTML = `<tr><td colspan="5"><div class="loading"><span class="spinner"></span>加载中...</div></td></tr>`;
    try {
      this.data = await api("/api/taxes");
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">加载失败：${esc(e.message)}</td></tr>`;
    }
  },

  render() {
    const tbody = $("#tax-tbody");
    if (!this.data.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">暂无税费数据</td></tr>`;
      return;
    }
    tbody.innerHTML = this.data.map((r) => `
      <tr data-id="${r.country_id}">
        <td>${esc(r.country_name)}</td>
        <td>${esc(r.country_code)}</td>
        <td class="num"><b>${fmtNum(r.rate)}%</b></td>
        <td class="num"><b>€${fmtMoney(r.fee)}</b></td>
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
        <div class="form-item"><label>税率（%）</label>
          <input class="input" type="number" step="0.1" min="0" max="99.9" id="t-rate" value="${row.rate}"></div>
        <div class="form-item"><label>附加费（€）</label>
          <input class="input" type="number" step="0.01" min="0" id="t-fee" value="${row.fee}"></div>
      </div>
      <div class="modal-note">税费计入产品成本，影响产品明细中的盈亏平衡售价。<br>计算公式：税费 = 售价 − 售价 ÷ (1 + 税率) + 附加费（附加费为固定欧元金额）</div>`;
    const { close } = openModal({
      title: `修改税费（${esc(row.country_name)}）`,
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-tax">保存</button>`,
    });
    $("#btn-save-tax").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const rate = $("#t-rate").value;
      const fee = $("#t-fee").value;
      if (rate === "" || Number(rate) < 0 || Number(rate) >= 100) {
        toast("税率必须在 0~100 之间", "error"); return;
      }
      if (fee === "" || Number(fee) < 0) {
        toast("附加费不能小于 0", "error"); return;
      }
      btn.disabled = true;
      try {
        await api(`/api/taxes/${countryId}`, "PUT", { rate, fee });
        toast("保存成功", "success");
        close();
        this.load();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  },
};
