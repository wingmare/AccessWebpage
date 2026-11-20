const PAGE_SIZE = 48;

const state = {
  items: [],
  categories: [],
  segment: "ALL",
  brand: "ALL",
  model: "ALL",
  search: "",
  brandFilter: "",
  modelFilter: "",
  withImageOnly: false,
  page: 1,
};

function toArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.trim() !== "") return [val.trim()];
  return [];
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getKurokiWebsiteUrl() {
  const override = new URLSearchParams(window.location.search).get("lang");
  const lang = (override || navigator.language || "").toLowerCase();
  if (lang.startsWith("ja")) return "https://kurokis.com/jp/";
  if (lang.startsWith("zh")) return "https://kurokis.com/";
  return "https://kurokis.com/en/";
}

async function init() {
  const res = await fetch("data/catalog.json");
  const data = await res.json();

  state.categories = data.categories || [];
  state.items = (data.items || []).map((item) => {
    const cleanModels = toArray(item.models).filter(
      (m) => !m.includes("=") && !m.includes("*")
    );
    return {
      ...item,
      models: cleanModels,
      images: toArray(item.images),
      _searchBlob: [
        item.item_no,
        item.brand,
        item.oem_text,
        item.description_text,
        item.category_name,
        cleanModels.join(" "),
      ]
        .join(" ")
        .toLowerCase(),
    };
  });

  let updated = "";
  if (data.generated_at) {
    const d = new Date(data.generated_at);
    updated = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
  const siteUrl = getKurokiWebsiteUrl();
  document.getElementById("catalogMeta").innerHTML =
    `<a href="${siteUrl}" target="_blank" rel="noopener noreferrer">Kuroki Website</a> • ${state.items.length} parts • Updated ${escapeHtml(updated)}`;

  bindEvents();
  renderAll();
}

function bindEvents() {
  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    state.page = 1;
    renderAll();
  });

  document.getElementById("brandFilterInput").addEventListener("input", (e) => {
    state.brandFilter = e.target.value.trim().toLowerCase();
    renderBrands();
  });

  document.getElementById("modelFilterInput").addEventListener("input", (e) => {
    state.modelFilter = e.target.value.trim().toLowerCase();
    state.model = "ALL";
    state.page = 1;
    renderModels();
    renderResults();
  });

  document.getElementById("withImageOnly").addEventListener("change", (e) => {
    state.withImageOnly = e.target.checked;
    state.page = 1;
    renderAll();
  });

  document.getElementById("clearAllBtn").addEventListener("click", () => {
    state.segment = "ALL";
    state.brand = "ALL";
    state.model = "ALL";
    state.search = "";
    state.brandFilter = "";
    state.modelFilter = "";
    state.withImageOnly = false;
    state.page = 1;
    document.getElementById("searchInput").value = "";
    document.getElementById("brandFilterInput").value = "";
    document.getElementById("modelFilterInput").value = "";
    document.getElementById("withImageOnly").checked = false;
    renderAll();
  });

  const mobileToggle = document.getElementById("mobileFilterToggle");
  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => {
      const panel = document.getElementById("sidebarFilters");
      const arrow = document.getElementById("mobileFilterArrow");
      const isOpen = panel.classList.toggle("open");
      mobileToggle.setAttribute("aria-expanded", String(isOpen));
      arrow.textContent = isOpen ? "▴ Hide" : "▾ Show";
    });
  }

  const segToggle = document.getElementById("mobileSegmentToggle");
  if (segToggle) {
    segToggle.addEventListener("click", () => {
      const tabs = document.getElementById("segmentTabs");
      const arrow = document.getElementById("mobileSegmentArrow");
      const isOpen = tabs.classList.toggle("open");
      segToggle.setAttribute("aria-expanded", String(isOpen));
      arrow.textContent = isOpen ? "▴ Hide" : "▾ Show";
    });
  }

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("modalBackdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

function matchesSegment(item) {
  if (state.segment === "ALL") return true;
  if (state.segment === "COPIER_A3") return item.segment === "Copier (A3)";
  if (state.segment === "PRINTER_A4") return item.segment === "Printer (A4)";
  return item.category_id === state.segment;
}

function getBaseFilteredItems() {
  return state.items.filter((item) => {
    if (!matchesSegment(item)) return false;
    if (state.withImageOnly && item.images.length === 0) return false;
    if (state.search && !item._searchBlob.includes(state.search)) return false;
    return true;
  });
}

function getFinalFilteredItems() {
  return getBaseFilteredItems().filter((item) => {
    if (state.brand !== "ALL" && item.brand !== state.brand) return false;
    if (state.model !== "ALL") {
      if (!item.models.includes(state.model)) return false;
    } else if (state.modelFilter) {
      const hitModel = item.models.some((m) =>
        m.toLowerCase().includes(state.modelFilter)
      );
      const hitDesc = (item.description_text || "")
        .toLowerCase()
        .includes(state.modelFilter);
      if (!hitModel && !hitDesc) return false;
    }
    return true;
  });
}

function updateMobileFilterLabel() {
  const lbl = document.getElementById("mobileFilterLabel");
  if (lbl) {
    const active = [];
    if (state.brand !== "ALL") active.push(state.brand);
    if (state.model !== "ALL") active.push(state.model);
    else if (state.modelFilter) active.push(`*${state.modelFilter}*`);
    lbl.textContent = active.length
      ? `Filters (${active.join(" • ")})`
      : "Filters: Brand & Machine Model";
  }

  const segLbl = document.getElementById("mobileSegmentLabel");
  if (segLbl) {
    let segName = "All Parts";
    if (state.segment === "COPIER_A3") segName = "Copier (A3)";
    else if (state.segment === "PRINTER_A4") segName = "Printer (A4)";
    else if (state.segment !== "ALL") {
      const cat = state.categories.find((c) => c.id === state.segment);
      segName = cat ? cat.name : state.segment;
    }
    segLbl.textContent = `Parts Type: ${segName}`;
  }
}

function renderAll() {
  renderSegmentTabs();
  renderBrands();
  renderModels();
  renderResults();
  updateMobileFilterLabel();
}

function renderSegmentTabs() {
  const tabs = [
    { id: "ALL", label: "All Parts" },
    { id: "COPIER_A3", label: "Copier (A3)" },
    { id: "PRINTER_A4", label: "Printer (A4)" },
    ...state.categories
      .filter((c) => c.id !== "1" && c.id !== "2")
      .map((c) => ({ id: c.id, label: c.name })),
  ];

  const container = document.getElementById("segmentTabs");
  container.innerHTML = tabs
    .map(
      (t) => `
      <button class="segment-tab ${state.segment === t.id ? "active" : ""}" data-seg="${escapeHtml(t.id)}">
        ${escapeHtml(t.label)}
      </button>`
    )
    .join("");

  container.querySelectorAll(".segment-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.segment = btn.dataset.seg;
      state.brand = "ALL";
      state.model = "ALL";
      state.page = 1;
      renderAll();
    });
  });
}

function renderBrands() {
  const baseItems = getBaseFilteredItems();
  const counts = new Map();
  for (const item of baseItems) {
    const b = item.brand || "(Unbranded)";
    counts.set(b, (counts.get(b) || 0) + 1);
  }

  let brands = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (state.brandFilter) {
    brands = brands.filter(([b]) => b.toLowerCase().includes(state.brandFilter));
  }

  document.getElementById("brandCount").textContent = counts.size;
  const list = document.getElementById("brandList");

  const allRow = `
    <li class="filter-item ${state.brand === "ALL" ? "active" : ""}" data-brand="ALL">
      <span>All Brands</span>
      <span class="item-count">${baseItems.length}</span>
    </li>`;

  const rows = brands
    .map(
      ([b, cnt]) => `
      <li class="filter-item ${state.brand === b ? "active" : ""}" data-brand="${escapeHtml(b)}">
        <span>${escapeHtml(b)}</span>
        <span class="item-count">${cnt}</span>
      </li>`
    )
    .join("");

  list.innerHTML = allRow + rows;
  list.querySelectorAll(".filter-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.brand = el.dataset.brand;
      state.model = "ALL";
      state.page = 1;
      renderAll();
    });
  });
}

function renderModels() {
  const list = document.getElementById("modelList");
  if (!list) return;

  const brandItems = getBaseFilteredItems().filter(
    (item) => state.brand === "ALL" || item.brand === state.brand
  );

  const counts = new Map();
  for (const item of brandItems) {
    for (const m of item.models) {
      counts.set(m, (counts.get(m) || 0) + 1);
    }
  }

  let models = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (state.modelFilter) {
    models = models.filter(([m]) => m.toLowerCase().includes(state.modelFilter));
  }

  const countEl = document.getElementById("modelCount");
  if (countEl) countEl.textContent = counts.size;

  const allRow = `
    <li class="filter-item ${state.model === "ALL" ? "active" : ""}" data-model="ALL">
      <span>All Models</span>
      <span class="item-count">${brandItems.length}</span>
    </li>`;

  const rows = models
    .slice(0, 300) // keep DOM fast if All Brands is selected
    .map(
      ([m, cnt]) => `
      <li class="filter-item ${state.model === m ? "active" : ""}" data-model="${escapeHtml(m)}">
        <span>${escapeHtml(m)}</span>
        <span class="item-count">${cnt}</span>
      </li>`
    )
    .join("");

  list.innerHTML = allRow + rows;
  list.querySelectorAll(".filter-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.model = el.dataset.model;
      state.page = 1;
      renderAll();
    });
  });
}

function renderResults() {
  const filtered = getFinalFilteredItems();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  // Breadcrumb
  const crumbs = [];
  if (state.segment === "ALL") crumbs.push("All Products");
  else if (state.segment === "COPIER_A3") crumbs.push("Copier (A3)");
  else if (state.segment === "PRINTER_A4") crumbs.push("Printer (A4)");
  else {
    const cat = state.categories.find((c) => c.id === state.segment);
    crumbs.push(cat ? cat.name : state.segment);
  }
  if (state.brand !== "ALL") crumbs.push(state.brand);
  if (state.model !== "ALL") crumbs.push(state.model);
  else if (state.modelFilter) crumbs.push(`Model: *${state.modelFilter}*`);

  document.getElementById("activeBreadcrumb").textContent = crumbs.join(" › ");
  document.getElementById("resultsCount").textContent = `${filtered.length} parts`;

  const grid = document.getElementById("partsGrid");
  if (pageItems.length === 0) {
    grid.innerHTML = `<p style="color:var(--muted)">No matching parts found. Try clearing filters or searching another OEM / model number.</p>`;
  } else {
    grid.innerHTML = pageItems
      .map((item) => {
        const thumb = item.images.length
          ? `<img src="${escapeHtml(item.images[0])}" alt="${escapeHtml(item.item_no)}" loading="lazy" />`
          : `<span class="no-image">No Image</span>`;

        const statusBadge = item.status
          ? `<span class="badge badge-status">${escapeHtml(item.status)}</span>`
          : "";

        const oemBlock = item.oem_html
          ? `<div class="oem-box"><div class="oem-label">OEM No</div><div class="rich-text">${item.oem_html}</div></div>`
          : "";

        return `
          <article class="part-card" data-uid="${escapeHtml(item.uid)}">
            <div class="part-thumb">${thumb}</div>
            <div class="part-body">
              <div class="part-top">
                <span class="item-no">${escapeHtml(item.item_no || "(No Item No)")}</span>
                <div>
                  ${statusBadge}
                  <span class="badge badge-brand">${escapeHtml(item.brand || "-")}</span>
                </div>
              </div>
              <div class="part-category">${escapeHtml(item.category_name || item.segment)}</div>
              <div class="rich-text">${item.description_html || escapeHtml(item.description_text)}</div>
              ${oemBlock}
            </div>
          </article>`;
      })
      .join("");

    grid.querySelectorAll(".part-card").forEach((card) => {
      card.addEventListener("click", () => {
        const item = state.items.find((x) => x.uid === card.dataset.uid);
        if (item) openModal(item);
      });
    });
  }

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const bar = document.getElementById("paginationBar");
  if (totalPages <= 1) {
    bar.innerHTML = "";
    return;
  }

  let html = `<button class="page-btn" ${state.page === 1 ? "disabled" : ""} data-page="${state.page - 1}">Prev</button>`;
  const maxButtons = 7;
  let startP = Math.max(1, state.page - 3);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  startP = Math.max(1, endP - maxButtons + 1);

  for (let p = startP; p <= endP; p++) {
    html += `<button class="page-btn ${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" ${state.page === totalPages ? "disabled" : ""} data-page="${state.page + 1}">Next</button>`;

  bar.innerHTML = html;
  bar.querySelectorAll(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.page);
      if (p >= 1 && p <= totalPages) {
        state.page = p;
        renderResults();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });
}

function openModal(item) {
  const imgsHtml = item.images.length
    ? item.images.map((src) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.item_no)}" />`).join("")
    : `<div class="part-thumb" style="border-radius:8px;border:1px solid var(--border)"><span class="no-image">No Image Available</span></div>`;

  const modelPills = item.models.length
    ? `<div style="margin-top:12px;"><div class="oem-label">Detected Models</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">${item.models
        .map((m) => `<span class="badge">${escapeHtml(m)}</span>`)
        .join("")}</div></div>`
    : "";

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-grid">
      <div class="modal-images">${imgsHtml}</div>
      <div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <span class="badge badge-brand">${escapeHtml(item.brand || "-")}</span>
          <span class="badge">${escapeHtml(item.category_name || item.segment)}</span>
          ${item.status ? `<span class="badge badge-status">${escapeHtml(item.status)}</span>` : ""}
        </div>
        <h2 style="margin:0 0 12px;color:var(--primary);">${escapeHtml(item.item_no)}</h2>
        <div class="oem-label">Description</div>
        <div class="rich-text" style="margin-top:4px;margin-bottom:14px;">
          ${item.description_html || escapeHtml(item.description_text)}
        </div>
        ${
          item.oem_html
            ? `<div class="oem-label">OEM Number(s)</div><div class="rich-text" style="margin-top:4px;">${item.oem_html}</div>`
            : ""
        }
        ${modelPills}
      </div>
    </div>`;

  document.getElementById("detailModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("detailModal").classList.add("hidden");
}

init();
