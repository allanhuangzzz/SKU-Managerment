/* ============ 产品信息模块 ============ */
const Products = {
  data: [],
  expanded: new Set(),
  cargoTypes: ["普货", "带电", "敏货", "特货"],

  renderToolbar(toolbar) {
    toolbar.innerHTML = `<button class="btn btn-primary" id="btn-add-product">新增产品</button>`;
    $("#btn-add-product").addEventListener("click", () => this.openModal());
  },

  async load() {
    ensureFreshRates();
    const tbody = $("#product-tbody");
    tbody.innerHTML = `<tr><td colspan="10"><div class="loading"><span class="spinner"></span>加载中...</div></tr>`;
    try {
      this.data = await api("/api/products");
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">加载失败：${esc(e.message)}</td></tr>`;
    }
  },

  render() {
    const tbody = $("#product-tbody");
    const kw = ($("#product-search").value || "").trim().toLowerCase();
    const list = this.data.filter((p) =>
      !kw || [p.sku, p.name].some((v) => String(v || "").toLowerCase().includes(kw))
    );
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">${
        kw ? "未找到匹配的产品" : "暂无产品，点击右上角「新增产品」开始录入"
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((p) => {
      const dims = [p.length, p.width, p.height].filter((v) => v != null && v > 0);
      const dimText = dims.length === 3 ? dims.join("×") : (dims.length ? dims.join("×") : "—");
      const thumb = p.image_path ? `/static/uploads/${p.image_path}` : "";
      return `
      <tr data-id="${p.id}" class="product-row" style="cursor:pointer">
        <td>${thumb ? `<img src="${thumb}" class="product-thumb" alt="">` : '<span class="no-thumb">—</span>'}</td>
        <td>${esc(p.name)}${p.link ? ` <a href="${esc(p.link)}" target="_blank" rel="noopener" class="ext-link" title="${esc(p.link)}" onclick="event.stopPropagation()">🔗</a>` : ""}</td>
        <td><span class="sku-badge">${esc(p.sku)}</span></td>
        <td><span class="tag">${esc(p.cargo_type || "普货")}</span></td>
        <td>${dimText}</td>
        <td class="num">${fmtMoney(p.purchase_price)}</td>
        <td class="num">${fmtMoney(p.domestic_shipping)}</td>
        <td class="num">${fmtMoney(p.agent_fee)}</td>
        <td class="num">${fmtNum(p.weight)}</td>
        <td class="op">
          <button class="link-btn" data-edit="${p.id}">编辑</button>
          <button class="link-btn" data-del="${p.id}" style="color:var(--danger)">删除</button>
        </td>
      </tr>
      <tr class="detail-row" data-detail="${p.id}" style="display:none">
        <td colspan="10"><div class="detail-box" data-box="${p.id}"></div></td>
      </tr>`}).join("");

    tbody.querySelectorAll(".product-row").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest(".link-btn")) return;
        this.toggleShipping(Number(tr.dataset.id));
      }));
    tbody.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => this.openModal(Number(b.dataset.edit))));
    tbody.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => this.remove(Number(b.dataset.del))));
  },

  async toggleShipping(id) {
    const box = $(`[data-box="${id}"]`);
    const row = $(`[data-detail="${id}"]`);
    const isOpen = row.style.display !== "none";
    row.style.display = isOpen ? "none" : "";
    if (!isOpen && !box.dataset.loaded) {
      box.innerHTML = `<div class="loading"><span class="spinner"></span>计算中...</div>`;
      try {
        const r = await api(`/api/products/${id}/shipping`);
        box.dataset.loaded = "1";
        box.innerHTML = this.shippingHtml(id, r.weight, r.items);
        // 绑定售价编辑
        this.bindSellingPriceEvents(id, box);
      } catch (e) {
        box.innerHTML = `<div class="loading">加载失败：${esc(e.message)}</div>`;
      }
    }
  },

  bindSellingPriceEvents(productId, box) {
    const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
    // 数字输入过滤：minus=是否允许负号，maxInt=整数位上限，小数最多 2 位
    const filterNum = (input, { minus, maxInt }) => {
      let v = input.value.replace(/[^\d.-]/g, "");
      if (!minus) {
        v = v.replace(/-/g, "");
      } else {
        const neg = v.startsWith("-");
        v = v.replace(/-/g, "");
        if (neg) v = "-" + v;
      }
      const dot = v.indexOf(".");
      if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
      const re = new RegExp(`^(${minus ? "-?" : ""}\\d{0,${maxInt}})(\\.(\\d{0,2})?)?`);
      const m = v.match(re);
      if (m) v = m[0];
      if (input.value !== v) input.value = v;
      return v;
    };
    // 当地币种预估收益的实时展示（与 money() 口径一致，保证保存前后无跳动）
    const localProfitHtml = (sym, val) => {
      if (val == null || isNaN(val)) return `<span class="money-cell money-neutral"><span class="money-sym"></span><span class="money-val">—</span></span>`;
      const pos = val >= 0;
      const s = pos ? "+" + sym : sym;
      const color = pos ? "var(--success)" : "var(--danger)";
      const v = Number(val).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `<span class="money-cell" style="color:${color}"><span class="money-sym">${s}</span><span class="money-val">${v}</span></span>`;
    };

    // 脏行跟踪：修改过但未保存的渠道（key = countryId__channel）
    const dirty = new Set();
    const rowKey = (priceInp) => `${priceInp.dataset.country}__${priceInp.dataset.channel}`;
    const openBtn = box.querySelector(".batch-open");
    const updateDirty = () => {
      if (openBtn) openBtn.textContent = dirty.size ? `批量修改（${dirty.size} 项待保存）` : "批量修改";
    };
    const rerender = async () => {
      const r = await api(`/api/products/${productId}/shipping`);
      box.innerHTML = this.shippingHtml(productId, r.weight, r.items);
      this.bindSellingPriceEvents(productId, box);
    };

    box.querySelectorAll("tbody tr").forEach((tr) => {
      const priceInp = tr.querySelector('.editable-price[data-field="price"]');
      const profitInp = tr.querySelector('.editable-price[data-field="profit"]');
      const localBox = tr.querySelector(".profit-local");
      if (!priceInp) return;
      const rate = parseFloat(priceInp.dataset.rate);
      const be = parseFloat(priceInp.dataset.be);
      const sym = priceInp.dataset.sym || "";
      const linkable = !isNaN(rate) && rate > 0 && !isNaN(be);
      const setLocalProfit = (val) => { if (localBox) localBox.innerHTML = localProfitHtml(sym, val); };

      // 售价输入 → 实时联动 收益RMB 与当地收益，并标记待保存
      priceInp.addEventListener("input", () => {
        const v = filterNum(priceInp, { minus: false, maxInt: 4 });
        dirty.add(rowKey(priceInp)); updateDirty();
        if (!linkable) return;
        if (v === "" || isNaN(parseFloat(v))) {
          if (profitInp) profitInp.value = "";
          setLocalProfit(null);
          return;
        }
        const profitLocal = r2(parseFloat(v) - be);
        if (profitInp) profitInp.value = String(r2(profitLocal * rate));
        setLocalProfit(profitLocal);
      });

      // 收益RMB输入 → 实时反算 售价 与当地收益，并标记待保存
      if (profitInp && linkable) {
        profitInp.addEventListener("input", () => {
          const v = filterNum(profitInp, { minus: true, maxInt: 6 });
          dirty.add(rowKey(priceInp)); updateDirty();
          if (v === "" || v === "-" || isNaN(parseFloat(v))) {
            priceInp.value = "";
            setLocalProfit(null);
            return;
          }
          const price = r2(be + parseFloat(v) / rate);
          priceInp.value = String(price);
          setLocalProfit(r2(price - be));
        });
      }
    });

    // 收集所有脏行为待提交 items；返回 { items, err }
    const collectItems = () => {
      const items = [];
      let err = "";
      box.querySelectorAll("tbody tr").forEach((tr) => {
        const priceInp = tr.querySelector('.editable-price[data-field="price"]');
        if (!priceInp || !dirty.has(rowKey(priceInp))) return;
        const label = tr.querySelector("td") ? tr.querySelector("td").textContent.trim() : priceInp.dataset.channel;
        const v = priceInp.value.trim();
        if (v === "") {
          items.push({ country_id: Number(priceInp.dataset.country), channel: priceInp.dataset.channel, selling_price: null });
          return;
        }
        const sp = parseFloat(v);
        if (isNaN(sp) || sp < 0) { if (!err) err = `「${label}」对应售价无效（不能为负）`; return; }
        items.push({ country_id: Number(priceInp.dataset.country), channel: priceInp.dataset.channel, selling_price: sp });
      });
      return { items, err };
    };

    // 批量修改弹窗：统一设置 + 保存全部 + 重置
    if (openBtn) openBtn.addEventListener("click", () => {
      const m = openModal({
        title: "批量修改预估收益（RMB）",
        body: `
          <div class="modal-note">将当前产品<b>所有可计算渠道</b>的预估收益（RMB）统一设为同一目标值；也可先在表格逐行修改后，再一起保存。</div>
          <div class="form-item">
            <label>统一目标收益（RMB）</label>
            <div class="batch-modal-row">
              <span class="price-sym">¥</span>
              <input class="input-sm batch-profit-input" placeholder="如 100，负数表示亏损" style="flex:1">
              <button type="button" class="btn btn-sm batch-apply">应用到全部渠道</button>
            </div>
          </div>
          <div class="modal-note">当前 <b class="batch-count">${dirty.size}</b> 项待保存，保存后生效。</div>`,
        buttons: `<button class="btn batch-reset">重置</button><button class="btn btn-primary batch-save">保存全部修改</button>`,
      });
      const mb = m.box;
      const batchInp = mb.querySelector(".batch-profit-input");
      const countEl = mb.querySelector(".batch-count");
      const refreshCount = () => { countEl.textContent = String(dirty.size); updateDirty(); };

      batchInp.addEventListener("input", () => filterNum(batchInp, { minus: true, maxInt: 6 }));
      batchInp.addEventListener("keydown", (e) => { if (e.key === "Enter") mb.querySelector(".batch-apply").click(); });

      // 统一应用到全部可联动渠道（逐行触发联动与脏标记）
      mb.querySelector(".batch-apply").addEventListener("click", () => {
        const raw = (batchInp.value || "").trim();
        if (raw === "" || raw === "-" || isNaN(parseFloat(raw))) { toast("请输入目标收益金额", "error"); return; }
        const val = String(r2(parseFloat(raw)));
        let n = 0;
        box.querySelectorAll("tbody tr").forEach((tr) => {
          const p = tr.querySelector('.editable-price[data-field="profit"]');
          if (!p || p.disabled) return;
          p.value = val;
          p.dispatchEvent(new Event("input", { bubbles: true }));
          n++;
        });
        if (n === 0) { toast("没有可应用的渠道（可能缺少汇率）", "error"); return; }
        refreshCount();
        toast(`已应用到 ${n} 个渠道`, "success");
      });

      // 重置：放弃未保存修改
      mb.querySelector(".batch-reset").addEventListener("click", async () => {
        if (dirty.size > 0) { await rerender(); toast("已重置，未保存的修改已放弃"); }
        m.close();
      });

      // 保存全部：一次批量提交
      mb.querySelector(".batch-save").addEventListener("click", async () => {
        if (dirty.size === 0) { toast("没有需要保存的修改"); m.close(); return; }
        const { items, err } = collectItems();
        if (err) { toast(err, "error"); return; }
        const btn = mb.querySelector(".batch-save");
        btn.disabled = true;
        try {
          await api(`/api/products/${productId}/selling-prices`, "PUT", { items });
          toast(`已保存 ${items.length} 项修改`, "success");
          m.close();
          await rerender();
        } catch (e) {
          toast(e.message, "error");
          btn.disabled = false;
        }
      });
    });
  },

  shippingHtml(productId, weight, items) {
    const note = weight > 0
      ? `按产品重量 ${fmtNum(weight)} kg，货物类型匹配`
      : `产品重量为 0，请在编辑中设置重量后计算`;
    if (!items.length) {
      return `<h4>各国运费明细（${note}）</h4>
        <div class="loading" style="padding:16px 0">暂无匹配的运费规则或该货物类型无对应规则，请先在「运费维护」中添加对应国家的规则</div>`;
    }
    return `<div class="detail-head">
        <h4>各国运费明细（${note}）</h4>
        <button type="button" class="btn btn-sm batch-open">批量修改</button>
      </div>
      <table class="detail-table compact">
        <thead><tr>
          <th class="ctr">国家（渠道）</th>
          <th class="ctr">售价</th>
          <th class="ctr">预估收益</th>
          <th class="ctr">预估收益（RMB）</th>
          <th class="ctr">盈亏平衡售价</th>
          <th class="ctr">预估国外运费</th>
          <th class="ctr">预估国外运费（RMB）</th>
          <th class="ctr">平台佣金</th>
          <th class="ctr">佣金率</th>
        </tr></thead>
        <tbody>${items.map((it, idx) => {
          const prev = idx > 0 ? items[idx - 1] : null;
          const isGroupStart = !prev || prev.country_name !== it.country_name;
          const sym = it.currency_symbol || it.currency;
          // 货币金额单元格：符号固定居左、数字右对齐（保证符号同列、数字位数对齐）
          const money = (symbol, val, color) => {
            if (val == null) return `<span class="money-cell money-neutral"><span class="money-sym"></span><span class="money-val">—</span></span>`;
            const cls = color ? "" : " money-neutral";
            const clr = color ? ` style="color:${color}"` : "";
            return `<span class="money-cell${cls}"${clr}><span class="money-sym">${symbol}</span><span class="money-val">${fmtMoney(val)}</span></span>`;
          };
          const localStr = money(sym, it.break_even_local);
          const costStr = money(sym, it.cost_original != null ? Number(it.cost_original) : null);
          const cnyStr = money("¥", it.cost_cny);
          const commStr = money("¥", it.platform_commission);
          const spVal = it.selling_price != null ? String(it.selling_price) : "";
          const rate = it.rate;
          const be = it.break_even_local;
          // 汇率/盈亏平衡价齐备时，售价与收益RMB才可双向联动
          const linkable = rate != null && rate > 0 && be != null;
          const profitRmbVal = it.estimated_profit_rmb != null ? String(it.estimated_profit_rmb) : "";
          // 预估收益（当地币种）：随售价/收益RMB实时联动刷新
          const profitLocalHtml = it.estimated_profit != null
            ? money((it.estimated_profit >= 0 ? "+" : "") + sym, it.estimated_profit,
                    it.estimated_profit >= 0 ? "var(--success)" : "var(--danger)")
            : money(sym, null);
          const dataAttrs = `data-country="${it.country_id}" data-channel="${esc(it.channel)}" data-rate="${rate ?? ""}" data-be="${be ?? ""}" data-sym="${esc(sym)}"`;
          return `<tr class="${isGroupStart ? 'country-group' : ''}">
            <td class="ctr">${esc(it.country_name)}（${esc(it.channel)}）</td>
            <td class="ctr">
              <span class="price-input-wrap">
                <span class="price-sym">${sym}</span>
                <input type="text" inputmode="decimal" class="editable-price" data-field="price" ${dataAttrs}
                  value="${spVal}" placeholder="—">
              </span>
            </td>
            <td class="ctr"><span class="profit-local">${profitLocalHtml}</span></td>
            <td class="ctr">
              <span class="price-input-wrap">
                <span class="price-sym">¥</span>
                <input type="text" inputmode="decimal" class="editable-price" data-field="profit" ${dataAttrs}
                  value="${profitRmbVal}" placeholder="—"${linkable ? "" : " disabled"}>
              </span>
            </td>
            <td class="ctr"><b>${localStr}</b></td>
            <td class="ctr">${costStr}</td>
            <td class="ctr">${cnyStr}</td>
            <td class="ctr">${commStr}</td>
            <td class="ctr">${fmtNum(it.commission_rate)}%</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`;
  },

  openModal(id) {
    const p = this.data.find((x) => x.id === id);
    const cargoOptions = this.cargoTypes.map((t) =>
      `<option value="${t}" ${(p ? p.cargo_type : "普货") === t ? "selected" : ""}>${t}</option>`).join("");
    const thumb = p && p.image_path ? `/static/uploads/${p.image_path}` : "";
    const body = `
      <div class="form-grid">
        <div class="form-item"><label>产品名称<span class="req">*</span></label>
          <input class="input" id="p-name" value="${esc(p ? p.name : "")}" placeholder="产品名称"></div>
        <div class="form-item"><label>SKU<span class="req">*</span></label>
          <input class="input" id="p-sku" value="${esc(p ? p.sku : "")}" placeholder="如：SKU-001"></div>
        <div class="form-item"><label>货物类型<span class="req">*</span></label>
          <select class="input" id="p-cargo">${cargoOptions}</select></div>
        <div class="form-item"><label>长（cm）</label>
          <input class="input" type="number" step="0.1" min="0" id="p-length" value="${p && p.length ? p.length : ""}" placeholder="0"></div>
        <div class="form-item"><label>宽（cm）</label>
          <input class="input" type="number" step="0.1" min="0" id="p-width" value="${p && p.width ? p.width : ""}" placeholder="0"></div>
        <div class="form-item"><label>高（cm）</label>
          <input class="input" type="number" step="0.1" min="0" id="p-height" value="${p && p.height ? p.height : ""}" placeholder="0"></div>
        <div class="form-item"><label>重量（kg）</label>
          <input class="input" type="number" step="0.001" min="0" id="p-weight" value="${p ? p.weight : ""}" placeholder="0"></div>
        <div class="form-item"><label>进货价（¥）</label>
          <input class="input" type="number" step="0.01" min="0" id="p-price" value="${p ? p.purchase_price : ""}" placeholder="0.00"></div>
        <div class="form-item"><label>国内运费（¥）</label>
          <input class="input" type="number" step="0.01" min="0" id="p-dom" value="${p ? p.domestic_shipping : ""}" placeholder="0.00"></div>
        <div class="form-item"><label>货代处理费（¥）</label>
          <input class="input" type="number" step="0.01" min="0" id="p-agent" value="${p ? (p.agent_fee ?? 0) : ""}" placeholder="0.00"></div>
        <div class="form-item full"><label>产品图片</label>
          <div class="img-upload-zone" id="p-image-zone">
            <input type="file" id="p-image" accept="image/*" hidden>
            <span class="img-zone-text">点击选择、拖拽图片到此处，或按 <b>Ctrl+V</b> 粘贴截图</span>
            <img id="p-image-preview" class="img-zone-preview"${thumb ? ` src="${thumb}"` : ` style="display:none"`}>
          </div>
        </div>
        <div class="form-item full"><label>链接</label>
          <input class="input" id="p-link" value="${esc(p ? p.link : "")}" placeholder="产品来源链接（选填，如 1688 详情页）"></div>
        <div class="form-item full"><label>备注</label>
          <textarea class="input" id="p-remark" placeholder="选填">${esc(p ? p.remark : "")}</textarea></div>
      </div>`;
    const { box, close } = openModal({
      title: p ? `编辑产品（${esc(p.sku)}）` : "新增产品",
      body,
      buttons: `<button class="btn btn-primary" id="btn-save-product">保存</button>`,
    });
    // ---- 图片上传：点击选择 / 拖拽 / 粘贴（Ctrl+V）三种入口 ----
    let pendingFile = null; // 待保存时上传的图片（选择/拖拽/粘贴统一写入）
    const fileInput = $("#p-image");
    const zone = $("#p-image-zone");
    const preview = $("#p-image-preview");
    const overlay = $("#modal-overlay");

    const IMG_EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
    // 粘贴的截图没有文件名/后缀，按图片类型补一个文件名，便于后端扩展名校验
    function normalizeImageFile(file) {
      if (!file || !file.type || !file.type.startsWith("image/")) return null;
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || "")) return file;
      const ext = IMG_EXT_BY_MIME[file.type] || "png";
      return new File([file], `paste.${ext}`, { type: file.type });
    }
    function showPreview(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = "";
      };
      reader.readAsDataURL(file);
    }
    function setImageFile(file, silent) {
      const f = normalizeImageFile(file);
      if (!f) { toast("请选择图片文件（png / jpg / gif / webp / bmp）", "error"); return; }
      pendingFile = f;
      showPreview(f);
      if (!silent) toast("已添加图片，保存后生效", "success");
    }

    // 点击上传区 = 触发文件选择
    zone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) setImageFile(fileInput.files[0], true);
    });
    // 拖拽图片到上传区
    zone.addEventListener("dragover", (e) => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setImageFile(f);
    });
    // 粘贴（Ctrl+V）：document 级监听，仅弹窗打开时生效；每次打开先移除旧监听，避免累积
    if (this._onPasteImage) document.removeEventListener("paste", this._onPasteImage);
    this._onPasteImage = (e) => {
      if (overlay.style.display === "none") return; // 弹窗已关闭，忽略
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); setImageFile(f); break; }
        }
      }
    };
    document.addEventListener("paste", this._onPasteImage);
    $("#btn-save-product").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const payload = {
        sku: $("#p-sku").value.trim(),
        name: $("#p-name").value.trim(),
        category: "",
        cargo_type: $("#p-cargo").value,
        length: $("#p-length").value,
        width: $("#p-width").value,
        height: $("#p-height").value,
        weight: $("#p-weight").value,
        purchase_price: $("#p-price").value,
        domestic_shipping: $("#p-dom").value,
        agent_fee: $("#p-agent").value,
        link: $("#p-link").value.trim(),
        remark: $("#p-remark").value.trim(),
      };
      if (!payload.sku || !payload.name) { toast("SKU 与产品名称不能为空", "error"); return; }
      btn.disabled = true;
      try {
        if (id) {
          await api(`/api/products/${id}`, "PUT", payload);
          // 上传图片
          await uploadImage(id);
          toast("保存成功", "success");
        } else {
          const r = await api("/api/products", "POST", payload);
          await uploadImage(r.id);
          toast("新增成功", "success");
        }
        close();
        this.load();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    });

    async function uploadImage(pid) {
      if (pendingFile) {
        const fd = new FormData();
        fd.append("file", pendingFile);
        await api(`/api/products/${pid}/image`, "POST", fd);
      }
    }
  },

  remove(id) {
    const p = this.data.find((x) => x.id === id);
    confirmDialog(`确定删除产品「${esc(p ? p.sku : id)}」吗？删除后不可恢复。`, async (btn) => {
      try {
        await api(`/api/products/${id}`, "DELETE");
        toast("已删除", "success");
        btn.closest(".modal-overlay").style.display = "none";
        this.load();
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    });
  },
};

$("#product-search").addEventListener("input", () => Products.render());