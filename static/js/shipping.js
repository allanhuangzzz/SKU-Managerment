/* ============ 运费维护模块 ============ */
const Shipping = {
  data: [],
  countries: [],
  cargoTypes: ["普货", "带电", "敏货", "特货"],
  expanded: new Set(),

  existingChannels() {
    return [...new Set(this.data.map((r) => r.channel).filter(Boolean))];
  },

  renderToolbar(toolbar) {
    toolbar.innerHTML = `<button class="btn btn-primary" id="btn-add-rule">新增运费规则</button>`;
    $("#btn-add-rule").addEventListener("click", () => this.openEditor(null));
  },

  async load() {
    const tbody = $("#shipping-tbody");
    tbody.innerHTML = `<tr><td colspan="4"><div class="loading"><span class="spinner"></span>加载中...</div></tr>`;
    try {
      this.countries = await api("/api/countries");
      this.data = await api("/api/shipping-rules");
      this.fillFilters();
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">加载失败：${esc(e.message)}</td></tr>`;
    }
  },

  fillFilters() {
    const countrySel = $("#shipping-country-filter");
    const channelSel = $("#shipping-channel-filter");
    const prevCountry = countrySel.value;
    const prevChannel = channelSel.value;
    const countryIds = new Set(this.data.map((r) => String(r.country_id)));
    const countries = this.countries.filter((c) => countryIds.has(String(c.id)));
    countrySel.innerHTML = `<option value="">全部国家</option>` +
      countries.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    countrySel.value = countryIds.has(prevCountry) ? prevCountry : "";
    const channels = this.existingChannels();
    channelSel.innerHTML = `<option value="">全部渠道</option>` +
      channels.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join("");
    channelSel.value = channels.includes(prevChannel) ? prevChannel : "";
  },

  render() {
    const tbody = $("#shipping-tbody");
    const cid = $("#shipping-country-filter").value;
    const channel = $("#shipping-channel-filter").value;
    const kw = ($("#shipping-search").value || "").trim().toLowerCase();
    const list = this.data.filter((r) => {
      if (cid && String(r.country_id) !== cid) return false;
      if (channel && r.channel !== channel) return false;
      if (kw && ![r.cargo_type, r.remark, r.country_name].some((v) => String(v || "").toLowerCase().includes(kw))) return false;
      return true;
    });

    const groups = new Map();
    for (const r of list) {
      if (!groups.has(r.country_id)) groups.set(r.country_id, []);
      groups.get(r.country_id).push(r);
    }
    // 按 sort_order 排序
    const sortedGroups = [...groups.entries()].sort((a, b) => {
      const ca = this.countries.find((x) => String(x.id) === String(a[0])) || {};
      const cb = this.countries.find((x) => String(x.id) === String(b[0])) || {};
      return (ca.sort_order || 0) - (cb.sort_order || 0);
    });

    if (!sortedGroups.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">${
        (cid || channel || kw) ? "未找到匹配的运费规则" : "暂无运费规则，点击右上角「新增运费规则」添加"
      }</td></tr>`;
      return;
    }

    let html = "";
    for (const [countryId, rules] of sortedGroups) {
      const c = this.countries.find((x) => String(x.id) === String(countryId)) || {};
      const name = c.name || rules[0].country_name;
      const code = c.code || rules[0].country_code;
      const open = this.expanded.has(countryId);
      html += `
      <tr class="country-row" data-country="${countryId}">
        <td class="drag-handle" draggable="true" title="拖动排序">⋮</td>
        <td>
          <b>${esc(name)}</b> <span style="color:#9aa8b8;font-size:12px">${esc(code)}</span>
        </td>
        <td class="num">${rules.length} 条</td>
        <td class="op">
          <button class="link-btn" data-toggle="${countryId}">${open ? "收起" : "展开"}</button>
          <button class="link-btn" data-edit="${countryId}">编辑</button>
          <button class="link-btn" data-delcountry="${countryId}" style="color:var(--danger)">删除</button>
        </td>
      </tr>
      <tr class="detail-row" data-detail="${countryId}" style="display:${open ? "" : "none"}">
        <td colspan="4"><div class="detail-box">
          <h4>${esc(name)} 运费规则（币种：${esc(rules[0].currency || "—")}）</h4>
          <table class="detail-table">
            <thead><tr>
              <th>物流渠道</th><th>货物类型</th>
              <th class="num">重量范围(kg)</th>
              <th class="num">per Parcel</th><th class="num">per Kg</th>
              <th>备注</th>
            </tr></thead>
            <tbody>${rules.map((r) => `
              <tr>
                <td>${esc(r.channel)}</td>
                <td><span class="tag">${esc(r.cargo_type)}</span></td>
                <td class="num">${fmtWeightRange(r.weight_min, r.weight_max)}</td>
                <td class="num">${fmtMoney(r.per_parcel)}</td>
                <td class="num">${fmtMoney(r.per_kg)}</td>
                <td>${esc(r.remark) || "—"}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div></td>
      </tr>`;
    }
    tbody.innerHTML = html;
    this.initDragReorder(tbody);
  },

  initDragReorder(tbody) {
    let dragRow = null;
    let dragDetail = null;
    tbody.querySelectorAll(".country-row .drag-handle").forEach((h) => {
      h.addEventListener("dragstart", (e) => {
        dragRow = h.closest("tr");
        dragDetail = dragRow.nextElementSibling;
        dragRow.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
      });
    });
    tbody.addEventListener("dragover", (e) => {
      if (!dragRow) return;
      e.preventDefault();
      const row = e.target.closest(".country-row");
      if (!row || row === dragRow) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      if (after) {
        row.after(dragDetail);
        row.after(dragRow);
      } else {
        row.before(dragRow);
        row.before(dragDetail);
      }
    });
    tbody.addEventListener("drop", (e) => e.preventDefault());
    tbody.addEventListener("dragend", async () => {
      if (dragRow) dragRow.classList.remove("dragging");
      dragRow = null;
      // 保存新排序
      const rows = [...tbody.querySelectorAll(".country-row")];
      const order = rows.map((r) => ({ id: Number(r.dataset.country) }));
      try {
        await api("/api/countries/reorder", "PUT", { order });
      } catch (e) { /* 静默 */ }
    });
  },

  toggle(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.render();
  },

  currencyDatalist() {
    const codes = [...new Set(this.countries.map((c) => c.currency_code))];
    return `<datalist id="rule-currencies">${codes.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`;
  },

  openEditor(countryId) {
    const editing = countryId != null;
    const country = editing ? this.countries.find((x) => x.id === countryId) : null;
    const rules = editing ? this.data.filter((r) => r.country_id === countryId) : [];
    const countryField = editing
      ? `<input class="input" id="e-country" value="${esc(country ? country.name : "")}" disabled>`
      : `<input class="input" id="e-country" list="rule-countries" placeholder="输入或选择国家">
         <datalist id="rule-countries">${this.countries.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>`;
    const currency = editing ? (rules[0] ? rules[0].currency : (country ? country.currency_code : "")) : "";
    const body = `
      ${this.currencyDatalist()}
      <datalist id="rule-channels">${this.existingChannels().map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="form-grid" style="margin-bottom:14px">
        <div class="form-item"><label>国家<span class="req">*</span></label>${countryField}</div>
        <div class="form-item"><label>币种<span class="req">*</span>（该国家共用）</label>
          <input class="input" id="e-currency" list="rule-currencies" value="${esc(currency)}" placeholder="如：USD"></div>
      </div>
      <div class="rule-editor">
        <div class="rule-editor-head">运费规则列表（拖动「⋮」可排序，点击「添加一行」继续增加，可复制/删除行）</div>
        <table class="rule-table">
          <thead><tr>
            <th style="width:38px" title="拖动排序">⋮</th>
            <th style="width:128px">物流渠道</th>
            <th style="width:105px">货物类型</th>
            <th style="width:158px">重量范围(kg)</th>
            <th style="width:95px">per Parcel</th>
            <th style="width:95px">per Kg</th>
            <th>备注</th>
            <th style="width:96px">操作</th>
          </tr></thead>
          <tbody id="rule-rows"></tbody>
        </table>
        <button class="btn btn-sm" id="btn-add-row" style="margin-top:10px">添加一行</button>
      </div>`;
    const { box, close } = openModal({
      title: editing ? `编辑运费规则（${esc(country ? country.name : "")}）` : "新增运费规则",
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-rules">保存</button>`,
      wide: true,
    });
    const rows = $("#rule-rows");
    (rules.length ? rules : [null]).forEach((r) => this.addRow(rows, r));
    rows.addEventListener("click", (e) => {
      const copyBtn = e.target.closest(".row-copy");
      if (copyBtn) {
        const tr = copyBtn.closest("tr");
        tr.after(this.buildRowEl(this.readRow(tr)));
        return;
      }
      const del = e.target.closest(".row-del");
      if (del) del.closest("tr").remove();
    });
    let dragRow = null;
    rows.addEventListener("dragstart", (e) => {
      if (!e.target.closest(".drag-handle")) { e.preventDefault(); return; }
      dragRow = e.target.closest("tr");
      dragRow.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String([...rows.children].indexOf(dragRow)));
    });
    rows.addEventListener("dragover", (e) => {
      if (!dragRow) return;
      e.preventDefault();
      const row = e.target.closest("tr");
      if (!row || row === dragRow) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      if (after) row.after(dragRow);
      else row.before(dragRow);
    });
    rows.addEventListener("drop", (e) => e.preventDefault());
    rows.addEventListener("dragend", () => {
      if (dragRow) dragRow.classList.remove("dragging");
      dragRow = null;
    });
    $("#btn-add-row").addEventListener("click", () => this.addRow(rows, null));
    $("#e-country").addEventListener("input", (e) => {
      const c = this.countries.find((x) => x.name === e.target.value.trim());
      if (c && !$("#e-currency").value) $("#e-currency").value = c.currency_code;
    });
    $("#btn-save-rules").addEventListener("click", (e) => this.saveRules(e.currentTarget, editing ? countryId : null, close));
  },

  addRow(tbody, r) {
    tbody.appendChild(this.buildRowEl(r));
  },

  buildRowEl(r) {
    r = r || {};
    const cargoOptions = this.cargoTypes.map((t) =>
      `<option value="${t}" ${r.cargo_type === t ? "selected" : ""}>${t}</option>`) +
      `<option value="其他" ${r.cargo_type && !this.cargoTypes.includes(r.cargo_type) ? "selected" : ""}>其他</option>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="drag-handle" draggable="true" title="拖动排序">⋮</td>
      <td><input class="input" data-f="channel" list="rule-channels" value="${esc(r.channel || "")}" placeholder="如：云途"></td>
      <td><select class="input" data-f="cargo_type">${cargoOptions}</select></td>
      <td><div class="range-cell">
        <input class="input" data-f="weight_min" type="number" step="0.001" min="0" value="${r.weight_min ?? 0}">
        <span style="color:#9aa8b8">~</span>
        <input class="input" data-f="weight_max" type="number" step="0.001" min="0" value="${r.weight_max != null ? r.weight_max : ""}" placeholder="∞">
      </div></td>
      <td><input class="input" data-f="per_parcel" type="number" step="0.01" min="0" value="${r.per_parcel ?? 0}"></td>
      <td><input class="input" data-f="per_kg" type="number" step="0.01" min="0" value="${r.per_kg ?? 0}"></td>
      <td><input class="input" data-f="remark" value="${esc(r.remark || "")}" placeholder="选填"></td>
      <td>
        <button type="button" class="link-btn row-copy" title="复制一行">复制</button>
        <button type="button" class="link-btn row-del" style="color:var(--danger)">删除</button>
      </td>`;
    return tr;
  },

  readRow(tr) {
    return {
      channel: tr.querySelector('[data-f="channel"]').value.trim(),
      cargo_type: tr.querySelector('[data-f="cargo_type"]').value,
      weight_min: tr.querySelector('[data-f="weight_min"]').value,
      weight_max: tr.querySelector('[data-f="weight_max"]').value,
      per_parcel: tr.querySelector('[data-f="per_parcel"]').value,
      per_kg: tr.querySelector('[data-f="per_kg"]').value,
      remark: tr.querySelector('[data-f="remark"]').value.trim(),
    };
  },

  async saveRules(btn, countryId, close) {
    let country = countryId != null ? this.countries.find((x) => x.id === countryId) : null;
    if (!country) {
      const name = $("#e-country").value.trim();
      country = this.countries.find((x) => x.name === name);
      if (!country) { toast("请选择系统中已有的国家（如：美国）", "error"); return; }
    }
    const currency = $("#e-currency").value.trim().toUpperCase();
    if (!currency) { toast("币种不能为空", "error"); return; }
    const rows = [...$$("#rule-rows tr")].map((tr) => this.readRow(tr));
    const valid = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.channel && !r.remark) continue;
      if (!r.channel) { toast(`第 ${i + 1} 行：物流渠道不能为空`, "error"); return; }
      valid.push(r);
    }
    btn.disabled = true;
    try {
      await api(`/api/countries/${country.id}/shipping-rules`, "PUT", { currency, rules: valid });
      toast("保存成功", "success");
      close();
      this.load();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  },

  removeCountryRules(countryId) {
    const c = this.countries.find((x) => x.id === countryId) || {};
    const n = this.data.filter((r) => r.country_id === countryId).length;
    confirmDialog(`确定删除「${esc(c.name || countryId)}」的全部 ${n} 条运费规则吗？`, async (btn) => {
      try {
        await api(`/api/countries/${countryId}/shipping-rules`, "DELETE");
        toast("已删除", "success");
        btn.closest(".modal-overlay").style.display = "none";
        this.expanded.delete(countryId);
        this.load();
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    });
  },
};

$("#shipping-tbody").addEventListener("click", (e) => {
  const toggleBtn = e.target.closest("[data-toggle]");
  if (toggleBtn) { Shipping.toggle(Number(toggleBtn.dataset.toggle)); return; }
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) { Shipping.openEditor(Number(editBtn.dataset.edit)); return; }
  const delBtn = e.target.closest("[data-delcountry]");
  if (delBtn) { Shipping.removeCountryRules(Number(delBtn.dataset.delcountry)); return; }
  const row = e.target.closest(".country-row");
  if (row) Shipping.toggle(Number(row.dataset.country));
});

$("#shipping-country-filter").addEventListener("change", () => Shipping.render());
$("#shipping-channel-filter").addEventListener("change", () => Shipping.render());
$("#shipping-search").addEventListener("input", () => Shipping.render());