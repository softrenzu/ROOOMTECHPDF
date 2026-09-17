(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const elements = {
    openButton: $("openButton"), emptyOpenButton: $("emptyOpenButton"), exportButton: $("exportButton"),
    pdfFileInput: $("pdfFileInput"), imageFileInput: $("imageFileInput"), documentTitle: $("documentTitle"),
    undoButton: $("undoButton"), redoButton: $("redoButton"), prevPageButton: $("prevPageButton"),
    nextPageButton: $("nextPageButton"), pageNumberInput: $("pageNumberInput"), pageCount: $("pageCount"),
    sidebarPageCount: $("sidebarPageCount"), zoomSelect: $("zoomSelect"), zoomInButton: $("zoomInButton"),
    zoomOutButton: $("zoomOutButton"), fitButton: $("fitButton"), rotatePageButton: $("rotatePageButton"),
    duplicatePageButton: $("duplicatePageButton"), addBlankPageButton: $("addBlankPageButton"),
    deletePageButton: $("deletePageButton"), thumbnailList: $("thumbnailList"), emptyState: $("emptyState"),
    canvasStage: $("canvasStage"), canvasShell: $("canvasShell"), canvas: $("editorCanvas"),
    dropZone: $("dropZone"), statusText: $("statusText"), pageSizeText: $("pageSizeText"),
    colorInput: $("colorInput"), strokeInput: $("strokeInput"), strokeOutput: $("strokeOutput"),
    opacityInput: $("opacityInput"), opacityOutput: $("opacityOutput"), fontSizeInput: $("fontSizeInput"),
    toolHint: $("toolHint"), selectionToolbar: $("selectionToolbar"), editSelectionButton: $("editSelectionButton"),
    copySelectionButton: $("copySelectionButton"), deleteSelectionButton: $("deleteSelectionButton"),
    textDialog: $("textDialog"), textForm: $("textForm"), dialogEyebrow: $("dialogEyebrow"),
    dialogTitle: $("dialogTitle"), textValue: $("textValue"), dialogFontSize: $("dialogFontSize"),
    dialogColor: $("dialogColor"), dialogFontWeight: $("dialogFontWeight"), dialogTip: $("dialogTip"),
    exportDialog: $("exportDialog"), exportForm: $("exportForm"), exportFilename: $("exportFilename"),
    confirmExportButton: $("confirmExportButton"), exportProgress: $("exportProgress"),
    exportProgressBar: $("exportProgressBar"), exportProgressText: $("exportProgressText"),
    toastRegion: $("toastRegion")
  };

  const TOOL_HINTS = {
    select: "オブジェクトを選んで移動・サイズ変更できます",
    replaceText: "修正したい位置をクリックすると、元の文字を白く隠して置き換えます",
    text: "文字を置きたい位置をクリックしてください",
    rectangle: "ドラッグして四角を描きます",
    ellipse: "ドラッグして楕円を描きます",
    line: "ドラッグして線を描きます",
    arrow: "ドラッグして矢印を描きます",
    draw: "ドラッグして手書きします",
    highlight: "ドラッグしてマーカーを引きます",
    image: "PNG・JPEG・WebP画像を挿入します",
    whiteout: "ドラッグした範囲を白く隠します"
  };

  const state = {
    pdf: null,
    fileName: "",
    pages: [],
    currentPageIndex: 0,
    zoom: 1,
    tool: "select",
    selectedId: null,
    defaults: { color: "#e43b4f", strokeWidth: 3, opacity: 1, fontSize: 18 },
    baseViewport: null,
    backgroundCanvas: null,
    renderToken: 0,
    thumbToken: 0,
    interaction: null,
    draft: null,
    pendingText: null,
    clipboard: null,
    history: [],
    future: [],
    imageCache: new Map(),
    busy: false
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const currentPage = () => state.pages[state.currentPageIndex] || null;
  const currentAnnotations = () => currentPage()?.annotations || [];
  const selectedAnnotation = () => currentAnnotations().find((item) => item.id === state.selectedId) || null;

  function iconUse(id) {
    return `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    elements.toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3400);
  }

  function setStatus(message) {
    elements.statusText.textContent = message;
  }

  function snapshot() {
    return JSON.stringify({ pages: state.pages, currentPageIndex: state.currentPageIndex });
  }

  function beginMutation() {
    if (!state.pdf || state.busy) return;
    state.history.push(snapshot());
    if (state.history.length > 40) state.history.shift();
    state.future = [];
    updateUndoRedo();
  }

  function restoreSnapshot(serialized) {
    const restored = JSON.parse(serialized);
    state.pages = restored.pages;
    state.currentPageIndex = clamp(restored.currentPageIndex, 0, Math.max(0, state.pages.length - 1));
    state.selectedId = null;
    state.draft = null;
    updateDocumentControls();
    renderCurrentPage();
    renderThumbnails();
  }

  function undo() {
    if (!state.history.length || state.busy) return;
    state.future.push(snapshot());
    restoreSnapshot(state.history.pop());
    updateUndoRedo();
    toast("元に戻しました");
  }

  function redo() {
    if (!state.future.length || state.busy) return;
    state.history.push(snapshot());
    restoreSnapshot(state.future.pop());
    updateUndoRedo();
    toast("やり直しました");
  }

  function updateUndoRedo() {
    elements.undoButton.disabled = !state.history.length || state.busy;
    elements.redoButton.disabled = !state.future.length || state.busy;
  }

  function enableDocumentControls(enabled) {
    [elements.exportButton, elements.prevPageButton, elements.nextPageButton, elements.pageNumberInput,
      elements.zoomSelect, elements.zoomInButton, elements.zoomOutButton, elements.fitButton,
      elements.rotatePageButton, elements.duplicatePageButton, elements.addBlankPageButton,
      elements.deletePageButton].forEach((control) => { control.disabled = !enabled; });
    document.querySelectorAll(".tool").forEach((control) => { control.disabled = !enabled; });
  }

  function updateDocumentControls() {
    const hasPdf = Boolean(state.pdf && state.pages.length);
    enableDocumentControls(hasPdf && !state.busy);
    const count = state.pages.length;
    elements.pageCount.textContent = count;
    elements.sidebarPageCount.textContent = count;
    elements.pageNumberInput.value = count ? state.currentPageIndex + 1 : 0;
    elements.prevPageButton.disabled = !hasPdf || state.currentPageIndex <= 0 || state.busy;
    elements.nextPageButton.disabled = !hasPdf || state.currentPageIndex >= count - 1 || state.busy;
    elements.deletePageButton.disabled = !hasPdf || count <= 1 || state.busy;
    elements.zoomSelect.value = String(state.zoom);
    updateUndoRedo();
    updateSelectionToolbar();
  }

  function setTool(tool) {
    if (!state.pdf && tool !== "select") return;
    const previousTool = state.tool;
    state.tool = tool;
    document.querySelectorAll(".tool").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    elements.toolHint.textContent = TOOL_HINTS[tool] || "";
    if (tool === "highlight") {
      state.defaults.color = "#ffd84d";
      state.defaults.opacity = 0.45;
    } else if (tool === "whiteout") {
      state.defaults.color = "#ffffff";
      state.defaults.opacity = 1;
    } else if (["highlight", "whiteout"].includes(previousTool)) {
      state.defaults.color = "#e43b4f";
      state.defaults.opacity = 1;
    }
    syncOptionControls();
    updateCanvasCursor();
  }

  function updateCanvasCursor() {
    const cursor = state.tool === "select" ? "default" : state.tool === "text" || state.tool === "replaceText" ? "text" : "crosshair";
    elements.canvas.style.cursor = cursor;
  }

  function syncOptionControls() {
    const selected = selectedAnnotation();
    const source = selected || state.defaults;
    if (source.color) elements.colorInput.value = source.color;
    if (source.strokeWidth) elements.strokeInput.value = source.strokeWidth;
    if (typeof source.opacity === "number") elements.opacityInput.value = Math.round(source.opacity * 100);
    if (source.fontSize) elements.fontSizeInput.value = Math.round(source.fontSize);
    elements.strokeOutput.textContent = elements.strokeInput.value;
    elements.opacityOutput.textContent = `${elements.opacityInput.value}%`;
  }

  function updateSelectionToolbar() {
    const selected = selectedAnnotation();
    elements.selectionToolbar.hidden = !selected;
    elements.editSelectionButton.hidden = !selected || !["text", "replaceText"].includes(selected.type);
    syncOptionControls();
  }

  function getPageRotation(pdfPage, entry) {
    return ((pdfPage?.rotate || 0) + (entry.extraRotation || 0)) % 360;
  }

  async function getPageDescriptor(entry, scale = 1) {
    if (entry.blank) {
      const baseWidth = entry.width || 595.28;
      const baseHeight = entry.height || 841.89;
      const rotated = (entry.extraRotation || 0) % 180 !== 0;
      return {
        pdfPage: null,
        viewport: { width: (rotated ? baseHeight : baseWidth) * scale, height: (rotated ? baseWidth : baseHeight) * scale },
        baseWidth: rotated ? baseHeight : baseWidth,
        baseHeight: rotated ? baseWidth : baseHeight
      };
    }
    const pdfPage = await state.pdf.getPage(entry.sourceIndex);
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: getPageRotation(pdfPage, entry) });
    const viewport = pdfPage.getViewport({ scale, rotation: getPageRotation(pdfPage, entry) });
    return { pdfPage, viewport, baseWidth: baseViewport.width, baseHeight: baseViewport.height };
  }

  function getImage(dataUrl) {
    if (state.imageCache.has(dataUrl)) return state.imageCache.get(dataUrl).promise;
    const record = { image: null, promise: null };
    record.promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { record.image = image; resolve(image); };
      image.onerror = reject;
      image.src = dataUrl;
    });
    state.imageCache.set(dataUrl, record);
    return record.promise;
  }

  async function preloadImages(annotations) {
    const images = annotations.filter((item) => item.type === "image" && item.dataUrl).map((item) => getImage(item.dataUrl).catch(() => null));
    await Promise.all(images);
  }

  function drawArrowHead(ctx, x1, y1, x2, y2, scale, color, width, opacity) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const size = Math.max(9, width * 3.5);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width * scale;
    ctx.beginPath();
    ctx.moveTo(x2 * scale, y2 * scale);
    ctx.lineTo((x2 - size * Math.cos(angle - Math.PI / 6)) * scale, (y2 - size * Math.sin(angle - Math.PI / 6)) * scale);
    ctx.lineTo((x2 - size * Math.cos(angle + Math.PI / 6)) * scale, (y2 - size * Math.sin(angle + Math.PI / 6)) * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawAnnotation(ctx, item, scale = 1) {
    ctx.save();
    ctx.globalAlpha = typeof item.opacity === "number" ? item.opacity : 1;
    ctx.strokeStyle = item.color || "#e43b4f";
    ctx.fillStyle = item.color || "#e43b4f";
    ctx.lineWidth = (item.strokeWidth || 2) * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (item.type === "rectangle") {
      ctx.strokeRect(item.x * scale, item.y * scale, item.width * scale, item.height * scale);
    } else if (item.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse((item.x + item.width / 2) * scale, (item.y + item.height / 2) * scale,
        Math.abs(item.width * scale / 2), Math.abs(item.height * scale / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.type === "highlight") {
      ctx.fillRect(item.x * scale, item.y * scale, item.width * scale, item.height * scale);
    } else if (item.type === "whiteout") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(item.x * scale, item.y * scale, item.width * scale, item.height * scale);
    } else if (item.type === "line" || item.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(item.x1 * scale, item.y1 * scale);
      ctx.lineTo(item.x2 * scale, item.y2 * scale);
      ctx.stroke();
      if (item.type === "arrow") drawArrowHead(ctx, item.x1, item.y1, item.x2, item.y2, scale, item.color, item.strokeWidth || 2, item.opacity ?? 1);
    } else if (item.type === "draw") {
      if (item.points?.length > 1) {
        ctx.beginPath();
        ctx.moveTo(item.points[0].x * scale, item.points[0].y * scale);
        for (let i = 1; i < item.points.length; i += 1) ctx.lineTo(item.points[i].x * scale, item.points[i].y * scale);
        ctx.stroke();
      }
    } else if (item.type === "text" || item.type === "replaceText") {
      const fontSize = item.fontSize || 18;
      const lineHeight = fontSize * 1.25;
      const lines = String(item.text || "").split("\n");
      if (item.type === "replaceText") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect((item.x - 3) * scale, (item.y - 3) * scale, (item.width + 6) * scale, (item.height + 6) * scale);
      }
      ctx.globalAlpha = typeof item.opacity === "number" ? item.opacity : 1;
      ctx.fillStyle = item.color || "#172033";
      ctx.font = `${item.fontWeight || 400} ${fontSize * scale}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textBaseline = "top";
      lines.forEach((line, index) => ctx.fillText(line, item.x * scale, (item.y + index * lineHeight) * scale));
    } else if (item.type === "image" && item.dataUrl) {
      const cached = state.imageCache.get(item.dataUrl);
      if (cached?.image) ctx.drawImage(cached.image, item.x * scale, item.y * scale, item.width * scale, item.height * scale);
      else if (cached?.promise) cached.promise.then(() => redrawCanvas()).catch(() => {});
      else getImage(item.dataUrl).then(() => redrawCanvas()).catch(() => {});
    }
    ctx.restore();
  }

  function getBounds(item) {
    if (["rectangle", "ellipse", "highlight", "whiteout", "text", "replaceText", "image"].includes(item.type)) {
      return { x: item.x, y: item.y, width: item.width, height: item.height };
    }
    if (item.type === "line" || item.type === "arrow") {
      return { x: Math.min(item.x1, item.x2), y: Math.min(item.y1, item.y2), width: Math.abs(item.x2 - item.x1), height: Math.abs(item.y2 - item.y1) };
    }
    if (item.type === "draw" && item.points?.length) {
      const xs = item.points.map((point) => point.x);
      const ys = item.points.map((point) => point.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  function drawSelection(ctx, item, scale) {
    const bounds = getBounds(item);
    const pad = 5;
    const x = (bounds.x - pad) * scale, y = (bounds.y - pad) * scale;
    const width = (bounds.width + pad * 2) * scale, height = (bounds.height + pad * 2) * scale;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#5c63ff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, scale * 1.2);
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    const handle = clamp(8 * scale, 8, 14);
    [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
      ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
    });
    ctx.restore();
  }

  function redrawCanvas() {
    if (!state.backgroundCanvas || !state.baseViewport) return;
    const canvas = elements.canvas;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(state.backgroundCanvas, 0, 0);
    const physicalScale = canvas.width / state.baseViewport.width;
    currentAnnotations().forEach((item) => drawAnnotation(context, item, physicalScale));
    if (state.draft) drawAnnotation(context, state.draft, physicalScale);
    const selected = selectedAnnotation();
    if (selected) drawSelection(context, selected, physicalScale);
  }

  async function renderCurrentPage() {
    const entry = currentPage();
    if (!state.pdf || !entry) return;
    const token = ++state.renderToken;
    elements.canvasShell.classList.add("is-loading");
    setStatus(`ページ ${state.currentPageIndex + 1} を表示中…`);
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const descriptor = await getPageDescriptor(entry, state.zoom * dpr);
      if (token !== state.renderToken) return;
      const baseDescriptor = await getPageDescriptor(entry, 1);
      if (token !== state.renderToken) return;
      const background = document.createElement("canvas");
      background.width = Math.ceil(descriptor.viewport.width);
      background.height = Math.ceil(descriptor.viewport.height);
      const backgroundContext = background.getContext("2d", { alpha: false });
      backgroundContext.fillStyle = "#ffffff";
      backgroundContext.fillRect(0, 0, background.width, background.height);
      if (descriptor.pdfPage) {
        await descriptor.pdfPage.render({ canvasContext: backgroundContext, viewport: descriptor.viewport }).promise;
      }
      if (token !== state.renderToken) return;
      state.backgroundCanvas = background;
      state.baseViewport = { width: baseDescriptor.baseWidth, height: baseDescriptor.baseHeight };
      elements.canvas.width = background.width;
      elements.canvas.height = background.height;
      elements.canvas.style.width = `${Math.round(baseDescriptor.baseWidth * state.zoom)}px`;
      elements.canvas.style.height = `${Math.round(baseDescriptor.baseHeight * state.zoom)}px`;
      await preloadImages(entry.annotations);
      redrawCanvas();
      elements.pageSizeText.textContent = `${Math.round(baseDescriptor.baseWidth)} × ${Math.round(baseDescriptor.baseHeight)} pt`;
      setStatus(`${entry.blank ? "白紙" : "PDF"}ページ ${state.currentPageIndex + 1} / ${state.pages.length}`);
    } catch (error) {
      console.error(error);
      toast("ページを表示できませんでした", "error");
      setStatus("表示エラー");
    } finally {
      if (token === state.renderToken) elements.canvasShell.classList.remove("is-loading");
      updateDocumentControls();
    }
  }

  async function drawThumbnail(canvas, entry, targetWidth = 130) {
    const base = await getPageDescriptor(entry, 1);
    const scale = targetWidth / base.baseWidth;
    const descriptor = await getPageDescriptor(entry, scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(descriptor.viewport.width * dpr);
    canvas.height = Math.ceil(descriptor.viewport.height * dpr);
    canvas.style.aspectRatio = `${base.baseWidth} / ${base.baseHeight}`;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (descriptor.pdfPage) {
      const hiViewport = descriptor.pdfPage.getViewport({ scale: scale * dpr, rotation: getPageRotation(descriptor.pdfPage, entry) });
      await descriptor.pdfPage.render({ canvasContext: context, viewport: hiViewport }).promise;
    }
    const annotationScale = scale * dpr;
    entry.annotations.forEach((item) => drawAnnotation(context, item, annotationScale));
  }

  async function renderThumbnails() {
    if (!state.pdf) return;
    const token = ++state.thumbToken;
    elements.thumbnailList.replaceChildren();
    const entries = state.pages.slice();
    entries.forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = `thumbnail-item${index === state.currentPageIndex ? " active" : ""}`;
      item.dataset.pageIndex = index;
      item.innerHTML = `<canvas aria-label="${index + 1}ページのサムネイル"></canvas><span class="thumbnail-number">${index + 1}</span><span class="thumbnail-controls"><button data-move="up" title="前へ">↑</button><button data-move="down" title="後ろへ">↓</button></span>`;
      item.addEventListener("click", (event) => {
        const move = event.target.closest("button")?.dataset.move;
        if (move) {
          event.stopPropagation();
          movePage(index, move === "up" ? -1 : 1);
          return;
        }
        goToPage(index);
      });
      elements.thumbnailList.appendChild(item);
    });
    const nodes = [...elements.thumbnailList.querySelectorAll(".thumbnail-item")];
    for (let index = 0; index < entries.length; index += 1) {
      if (token !== state.thumbToken) return;
      try { await drawThumbnail(nodes[index].querySelector("canvas"), entries[index]); } catch (error) { console.warn("thumbnail", error); }
      if (index % 4 === 3) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  async function loadPdf(file) {
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      toast("PDFファイルを選んでください", "error");
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      toast("150MB以下のPDFを選んでください", "error");
      return;
    }
    if (!window.pdfjsLib || !window.PDFLib) {
      toast("PDF機能の読み込みに失敗しました。再読み込みしてください", "error");
      return;
    }
    state.busy = true;
    enableDocumentControls(false);
    setStatus("PDFを読み込んでいます…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const task = window.pdfjsLib.getDocument({ data: bytes });
      const pdf = await task.promise;
      state.pdf = pdf;
      state.fileName = file.name;
      state.pages = Array.from({ length: pdf.numPages }, (_, index) => ({
        id: uid(), sourceIndex: index + 1, extraRotation: 0, annotations: []
      }));
      state.currentPageIndex = 0;
      state.selectedId = null;
      state.history = [];
      state.future = [];
      state.clipboard = null;
      state.imageCache.clear();
      elements.documentTitle.querySelector("span").textContent = file.name;
      elements.emptyState.hidden = true;
      elements.canvasStage.hidden = false;
      state.busy = false;
      updateDocumentControls();
      await fitToScreen(false);
      renderThumbnails();
      toast(`${pdf.numPages}ページのPDFを開きました`, "success");
    } catch (error) {
      console.error(error);
      state.pdf = null;
      state.pages = [];
      toast(error?.name === "PasswordException" ? "パスワード付きPDFには現在対応していません" : "PDFを読み込めませんでした", "error");
      setStatus("PDFを開けませんでした");
    } finally {
      state.busy = false;
      updateDocumentControls();
      elements.pdfFileInput.value = "";
    }
  }

  function goToPage(index) {
    if (!state.pages.length || state.busy) return;
    const next = clamp(Number(index), 0, state.pages.length - 1);
    if (next === state.currentPageIndex) return;
    state.currentPageIndex = next;
    state.selectedId = null;
    state.draft = null;
    updateDocumentControls();
    renderCurrentPage();
    document.querySelectorAll(".thumbnail-item").forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === next));
    elements.thumbnailList.querySelector(`[data-page-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  async function fitToScreen(showToast = true) {
    const entry = currentPage();
    if (!entry) return;
    const descriptor = await getPageDescriptor(entry, 1);
    const availableWidth = Math.max(260, elements.dropZone.clientWidth - (window.innerWidth <= 760 ? 36 : 100));
    const availableHeight = Math.max(320, elements.dropZone.clientHeight - (window.innerWidth <= 760 ? 46 : 90));
    state.zoom = clamp(Math.min(availableWidth / descriptor.baseWidth, availableHeight / descriptor.baseHeight), 0.5, 2);
    state.zoom = [0.5, 0.75, 1, 1.25, 1.5, 2].reduce((best, value) => Math.abs(value - state.zoom) < Math.abs(best - state.zoom) ? value : best, 1);
    elements.zoomSelect.value = String(state.zoom);
    await renderCurrentPage();
    if (showToast) toast("画面に合わせました");
  }

  function setZoom(value) {
    if (!state.pdf || state.busy) return;
    state.zoom = clamp(Number(value), 0.5, 2);
    elements.zoomSelect.value = String(state.zoom);
    renderCurrentPage();
  }

  function canvasPoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (state.baseViewport.width / rect.width);
    const y = (event.clientY - rect.top) * (state.baseViewport.height / rect.height);
    return { x: clamp(x, 0, state.baseViewport.width), y: clamp(y, 0, state.baseViewport.height) };
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function hitTest(point) {
    const annotations = currentAnnotations();
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const item = annotations[index];
      if (item.type === "line" || item.type === "arrow") {
        if (distanceToSegment(point, { x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }) <= Math.max(8, item.strokeWidth * 2)) return item;
      } else if (item.type === "draw") {
        for (let i = 1; i < item.points.length; i += 1) {
          if (distanceToSegment(point, item.points[i - 1], item.points[i]) <= Math.max(8, item.strokeWidth * 2)) return item;
        }
      } else {
        const bounds = getBounds(item);
        if (point.x >= bounds.x - 6 && point.x <= bounds.x + bounds.width + 6 && point.y >= bounds.y - 6 && point.y <= bounds.y + bounds.height + 6) return item;
      }
    }
    return null;
  }

  function isResizeHandle(point, item) {
    if (!item || ["line", "arrow", "draw"].includes(item.type)) return false;
    const bounds = getBounds(item);
    return Math.abs(point.x - (bounds.x + bounds.width + 5)) <= 12 && Math.abs(point.y - (bounds.y + bounds.height + 5)) <= 12;
  }

  function normalizeRect(start, end) {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }

  function createShape(tool, start, end) {
    const common = { id: uid(), type: tool, color: state.defaults.color, strokeWidth: state.defaults.strokeWidth, opacity: state.defaults.opacity };
    if (tool === "line" || tool === "arrow") return { ...common, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    const rect = normalizeRect(start, end);
    if (tool === "highlight") return { ...common, ...rect, color: state.defaults.color || "#ffd84d", opacity: state.defaults.opacity };
    if (tool === "whiteout") return { ...common, ...rect, color: "#ffffff", opacity: 1 };
    return { ...common, ...rect };
  }

  function translateItem(item, dx, dy) {
    if (item.type === "line" || item.type === "arrow") {
      item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy;
    } else if (item.type === "draw") {
      item.points.forEach((point) => { point.x += dx; point.y += dy; });
    } else {
      item.x += dx; item.y += dy;
    }
  }

  function recalculateTextMetrics(item) {
    const helper = document.createElement("canvas").getContext("2d");
    helper.font = `${item.fontWeight || 400} ${item.fontSize || 18}px ${getComputedStyle(document.body).fontFamily}`;
    const lines = String(item.text || "").split("\n");
    item.width = Math.max(20, ...lines.map((line) => helper.measureText(line || " ").width));
    item.height = Math.max(item.fontSize || 18, lines.length * (item.fontSize || 18) * 1.25);
  }

  function onPointerDown(event) {
    if (!state.pdf || state.busy || !state.baseViewport) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = canvasPoint(event);
    elements.canvas.setPointerCapture?.(event.pointerId);
    if (state.tool === "select") {
      const selected = selectedAnnotation();
      if (selected && isResizeHandle(point, selected)) {
        beginMutation();
        state.interaction = { mode: "resize", start: point, original: deepClone(selected), id: selected.id };
        return;
      }
      const hit = hitTest(point);
      state.selectedId = hit?.id || null;
      updateSelectionToolbar();
      redrawCanvas();
      if (hit) {
        beginMutation();
        state.interaction = { mode: "move", start: point, last: point, id: hit.id };
      }
      return;
    }
    if (state.tool === "text" || state.tool === "replaceText") {
      openTextDialog({ mode: state.tool, point });
      return;
    }
    if (state.tool === "image") {
      elements.imageFileInput.click();
      return;
    }
    beginMutation();
    state.selectedId = null;
    if (state.tool === "draw") {
      state.draft = { id: uid(), type: "draw", points: [point], color: state.defaults.color, strokeWidth: state.defaults.strokeWidth, opacity: state.defaults.opacity };
      state.interaction = { mode: "drawFreehand" };
    } else {
      state.draft = createShape(state.tool, point, point);
      state.interaction = { mode: "drawShape", start: point };
    }
    redrawCanvas();
  }

  function onPointerMove(event) {
    if (!state.interaction || !state.baseViewport) return;
    const point = canvasPoint(event);
    const interaction = state.interaction;
    if (interaction.mode === "move") {
      const item = currentAnnotations().find((entry) => entry.id === interaction.id);
      if (!item) return;
      translateItem(item, point.x - interaction.last.x, point.y - interaction.last.y);
      interaction.last = point;
    } else if (interaction.mode === "resize") {
      const item = currentAnnotations().find((entry) => entry.id === interaction.id);
      if (!item) return;
      const original = interaction.original;
      if (item.type === "text" || item.type === "replaceText") {
        item.fontSize = clamp((original.fontSize || 18) + (point.y - interaction.start.y), 8, 96);
        recalculateTextMetrics(item);
      } else {
        item.width = Math.max(5, original.width + point.x - interaction.start.x);
        item.height = Math.max(5, original.height + point.y - interaction.start.y);
      }
    } else if (interaction.mode === "drawFreehand") {
      const last = state.draft.points[state.draft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1.5) state.draft.points.push(point);
    } else if (interaction.mode === "drawShape") {
      state.draft = createShape(state.tool, interaction.start, point);
    }
    redrawCanvas();
  }

  function onPointerUp() {
    if (!state.interaction) return;
    const interaction = state.interaction;
    if ((interaction.mode === "drawShape" || interaction.mode === "drawFreehand") && state.draft) {
      const bounds = getBounds(state.draft);
      const valid = interaction.mode === "drawFreehand" ? state.draft.points.length > 1 : Math.max(bounds.width, bounds.height) > 3;
      if (valid) {
        currentAnnotations().push(state.draft);
        state.selectedId = state.draft.id;
        setTool("select");
      }
      state.draft = null;
      renderThumbnails();
    } else if (interaction.mode === "move" || interaction.mode === "resize") {
      renderThumbnails();
    }
    state.interaction = null;
    updateSelectionToolbar();
    redrawCanvas();
  }

  function openTextDialog({ mode, point = null, annotation = null }) {
    const editing = Boolean(annotation);
    state.pendingText = { mode, point, annotationId: annotation?.id || null };
    elements.dialogEyebrow.textContent = mode === "replaceText" ? "文字を修正" : "文字を追加";
    elements.dialogTitle.textContent = editing ? "文字を編集" : "内容を入力";
    elements.dialogTip.textContent = mode === "replaceText" ? "入力した文字の下を白く塗り、元の文字を見えなくします。" : "クリックした場所に文字を追加します。";
    elements.textValue.value = annotation?.text || "";
    elements.dialogFontSize.value = Math.round(annotation?.fontSize || state.defaults.fontSize);
    elements.dialogColor.value = annotation?.color || (mode === "replaceText" ? "#172033" : state.defaults.color);
    elements.dialogFontWeight.value = String(annotation?.fontWeight || 400);
    elements.textDialog.showModal();
    window.setTimeout(() => elements.textValue.focus(), 30);
  }

  function applyTextDialog() {
    const pending = state.pendingText;
    const text = elements.textValue.value.trimEnd();
    if (!pending || !text.trim()) {
      toast("文字を入力してください", "error");
      return false;
    }
    beginMutation();
    const fontSize = clamp(Number(elements.dialogFontSize.value) || 18, 8, 96);
    const color = elements.dialogColor.value;
    const fontWeight = Number(elements.dialogFontWeight.value) || 400;
    if (pending.annotationId) {
      const item = currentAnnotations().find((entry) => entry.id === pending.annotationId);
      if (item) {
        item.text = text; item.fontSize = fontSize; item.color = color; item.fontWeight = fontWeight;
        recalculateTextMetrics(item);
      }
    } else {
      const item = {
        id: uid(), type: pending.mode, text, x: pending.point.x, y: pending.point.y,
        fontSize, color, fontWeight, opacity: 1, width: 20, height: fontSize
      };
      recalculateTextMetrics(item);
      item.x = clamp(item.x, 0, Math.max(0, state.baseViewport.width - item.width));
      item.y = clamp(item.y, 0, Math.max(0, state.baseViewport.height - item.height));
      currentAnnotations().push(item);
      state.selectedId = item.id;
    }
    state.defaults.fontSize = fontSize;
    state.pendingText = null;
    setTool("select");
    updateSelectionToolbar();
    redrawCanvas();
    renderThumbnails();
    return true;
  }

  async function insertImage(file) {
    if (!file || !state.pdf) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast("PNG・JPEG・WebP画像を選んでください", "error");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("画像は15MB以下にしてください", "error");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const image = await getImage(dataUrl);
      const width = Math.min(state.baseViewport.width * .42, image.naturalWidth);
      const height = width * (image.naturalHeight / image.naturalWidth);
      beginMutation();
      const item = {
        id: uid(), type: "image", dataUrl, opacity: 1,
        x: (state.baseViewport.width - width) / 2, y: (state.baseViewport.height - height) / 2,
        width, height
      };
      currentAnnotations().push(item);
      state.selectedId = item.id;
      setTool("select");
      redrawCanvas();
      renderThumbnails();
      toast("画像を追加しました", "success");
    } catch (error) {
      toast("画像を読み込めませんでした", "error");
    } finally {
      elements.imageFileInput.value = "";
    }
  }

  function deleteSelection() {
    if (!state.selectedId) return;
    const index = currentAnnotations().findIndex((item) => item.id === state.selectedId);
    if (index < 0) return;
    beginMutation();
    currentAnnotations().splice(index, 1);
    state.selectedId = null;
    updateSelectionToolbar();
    redrawCanvas();
    renderThumbnails();
  }

  function copySelection(pasteImmediately = false) {
    const item = selectedAnnotation();
    if (!item) return;
    state.clipboard = deepClone(item);
    if (pasteImmediately) pasteSelection();
    else toast("コピーしました");
  }

  function pasteSelection() {
    if (!state.clipboard || !state.pdf) return;
    beginMutation();
    const item = deepClone(state.clipboard);
    item.id = uid();
    translateItem(item, 12, 12);
    currentAnnotations().push(item);
    state.selectedId = item.id;
    updateSelectionToolbar();
    redrawCanvas();
    renderThumbnails();
  }

  function applyOptionChange(property, value) {
    const item = selectedAnnotation();
    if (item) {
      beginMutation();
      item[property] = value;
      if (property === "fontSize" && ["text", "replaceText"].includes(item.type)) recalculateTextMetrics(item);
      redrawCanvas();
      renderThumbnails();
    } else {
      state.defaults[property] = value;
    }
    syncOptionControls();
  }

  function rotateAnnotation90(item, oldHeight) {
    if (item.type === "line" || item.type === "arrow") {
      const p1 = { x: oldHeight - item.y1, y: item.x1 };
      const p2 = { x: oldHeight - item.y2, y: item.x2 };
      Object.assign(item, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    } else if (item.type === "draw") {
      item.points.forEach((point) => { const x = point.x; point.x = oldHeight - point.y; point.y = x; });
    } else {
      const { x, y, width, height } = item;
      item.x = oldHeight - (y + height);
      item.y = x;
      item.width = height;
      item.height = width;
    }
  }

  async function rotateCurrentPage() {
    const entry = currentPage();
    if (!entry) return;
    const descriptor = await getPageDescriptor(entry, 1);
    beginMutation();
    entry.annotations.forEach((item) => rotateAnnotation90(item, descriptor.baseHeight));
    entry.extraRotation = ((entry.extraRotation || 0) + 90) % 360;
    state.selectedId = null;
    renderCurrentPage();
    renderThumbnails();
  }

  function duplicateCurrentPage() {
    const entry = currentPage();
    if (!entry) return;
    beginMutation();
    const copy = deepClone(entry);
    copy.id = uid();
    copy.annotations.forEach((item) => { item.id = uid(); });
    state.pages.splice(state.currentPageIndex + 1, 0, copy);
    state.currentPageIndex += 1;
    state.selectedId = null;
    updateDocumentControls();
    renderCurrentPage();
    renderThumbnails();
    toast("ページを複製しました", "success");
  }

  async function addBlankPage() {
    if (!state.pdf) return;
    const descriptor = await getPageDescriptor(currentPage(), 1);
    beginMutation();
    const entry = { id: uid(), blank: true, width: descriptor.baseWidth, height: descriptor.baseHeight, extraRotation: 0, annotations: [] };
    state.pages.splice(state.currentPageIndex + 1, 0, entry);
    state.currentPageIndex += 1;
    state.selectedId = null;
    updateDocumentControls();
    renderCurrentPage();
    renderThumbnails();
    toast("白紙ページを追加しました", "success");
  }

  function deleteCurrentPage() {
    if (state.pages.length <= 1) return;
    beginMutation();
    state.pages.splice(state.currentPageIndex, 1);
    state.currentPageIndex = Math.min(state.currentPageIndex, state.pages.length - 1);
    state.selectedId = null;
    updateDocumentControls();
    renderCurrentPage();
    renderThumbnails();
    toast("ページを削除しました");
  }

  function movePage(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= state.pages.length) return;
    beginMutation();
    [state.pages[index], state.pages[target]] = [state.pages[target], state.pages[index]];
    if (state.currentPageIndex === index) state.currentPageIndex = target;
    else if (state.currentPageIndex === target) state.currentPageIndex = index;
    updateDocumentControls();
    renderCurrentPage();
    renderThumbnails();
  }

  function safeBaseName(name) {
    return String(name || "編集済み").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "編集済み";
  }

  function canvasToPngBytes(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("PNG conversion failed")); return; }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, "image/png");
    });
  }

  async function exportPdf() {
    if (!state.pdf || state.busy || !window.PDFLib) return;
    state.busy = true;
    updateDocumentControls();
    elements.exportProgress.hidden = false;
    elements.confirmExportButton.disabled = true;
    const quality = Number(elements.exportForm.querySelector('input[name="quality"]:checked')?.value || 2);
    try {
      const output = await window.PDFLib.PDFDocument.create();
      output.setTitle(safeBaseName(state.fileName));
      output.setCreator("ROOOMTECH PDF");
      output.setProducer("ROOOMTECH PDF Web Editor");
      for (let index = 0; index < state.pages.length; index += 1) {
        const entry = state.pages[index];
        const progress = Math.round((index / state.pages.length) * 88);
        elements.exportProgressBar.style.width = `${progress}%`;
        elements.exportProgressText.textContent = `${index + 1} / ${state.pages.length} ページ`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const descriptor = await getPageDescriptor(entry, quality);
        const base = await getPageDescriptor(entry, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(descriptor.viewport.width);
        canvas.height = Math.ceil(descriptor.viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (descriptor.pdfPage) await descriptor.pdfPage.render({ canvasContext: context, viewport: descriptor.viewport }).promise;
        await preloadImages(entry.annotations);
        entry.annotations.forEach((item) => drawAnnotation(context, item, quality));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const pngBytes = await canvasToPngBytes(canvas);
        const png = await output.embedPng(pngBytes);
        const page = output.addPage([base.baseWidth, base.baseHeight]);
        page.drawImage(png, { x: 0, y: 0, width: base.baseWidth, height: base.baseHeight });
      }
      elements.exportProgressBar.style.width = "94%";
      elements.exportProgressText.textContent = "PDFを生成中…";
      const bytes = await output.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const filename = `${safeBaseName(elements.exportFilename.value)}.pdf`;
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      elements.exportProgressBar.style.width = "100%";
      elements.exportProgressText.textContent = "保存しました";
      toast(`${filename} を保存しました`, "success");
      window.setTimeout(() => elements.exportDialog.close(), 450);
    } catch (error) {
      console.error(error);
      toast("PDFの保存に失敗しました。画質を下げて再度お試しください", "error");
      elements.exportProgressText.textContent = "保存できませんでした";
    } finally {
      state.busy = false;
      elements.confirmExportButton.disabled = false;
      updateDocumentControls();
    }
  }

  function openExportDialog() {
    if (!state.pdf) return;
    elements.exportFilename.value = `${safeBaseName(state.fileName)}_編集済み`;
    elements.exportProgress.hidden = true;
    elements.exportProgressBar.style.width = "0";
    elements.exportDialog.showModal();
  }

  function bindEvents() {
    [elements.openButton, elements.emptyOpenButton].forEach((button) => button.addEventListener("click", () => elements.pdfFileInput.click()));
    elements.pdfFileInput.addEventListener("change", () => loadPdf(elements.pdfFileInput.files[0]));
    elements.imageFileInput.addEventListener("change", () => insertImage(elements.imageFileInput.files[0]));
    elements.exportButton.addEventListener("click", openExportDialog);
    elements.undoButton.addEventListener("click", undo);
    elements.redoButton.addEventListener("click", redo);
    elements.prevPageButton.addEventListener("click", () => goToPage(state.currentPageIndex - 1));
    elements.nextPageButton.addEventListener("click", () => goToPage(state.currentPageIndex + 1));
    elements.pageNumberInput.addEventListener("change", () => goToPage(Number(elements.pageNumberInput.value) - 1));
    elements.zoomSelect.addEventListener("change", () => setZoom(elements.zoomSelect.value));
    elements.zoomInButton.addEventListener("click", () => setZoom(state.zoom + .25));
    elements.zoomOutButton.addEventListener("click", () => setZoom(state.zoom - .25));
    elements.fitButton.addEventListener("click", () => fitToScreen());
    elements.rotatePageButton.addEventListener("click", rotateCurrentPage);
    elements.duplicatePageButton.addEventListener("click", duplicateCurrentPage);
    elements.addBlankPageButton.addEventListener("click", addBlankPage);
    elements.deletePageButton.addEventListener("click", deleteCurrentPage);
    document.querySelectorAll(".tool").forEach((button) => button.addEventListener("click", () => {
      setTool(button.dataset.tool);
      if (button.dataset.tool === "image") elements.imageFileInput.click();
    }));
    elements.canvas.addEventListener("pointerdown", onPointerDown);
    elements.canvas.addEventListener("pointermove", onPointerMove);
    elements.canvas.addEventListener("pointerup", onPointerUp);
    elements.canvas.addEventListener("pointercancel", onPointerUp);
    elements.canvas.addEventListener("dblclick", () => {
      const item = selectedAnnotation();
      if (item && ["text", "replaceText"].includes(item.type)) openTextDialog({ mode: item.type, annotation: item });
    });
    elements.editSelectionButton.addEventListener("click", () => {
      const item = selectedAnnotation();
      if (item) openTextDialog({ mode: item.type, annotation: item });
    });
    elements.copySelectionButton.addEventListener("click", () => copySelection(true));
    elements.deleteSelectionButton.addEventListener("click", deleteSelection);
    elements.colorInput.addEventListener("change", () => applyOptionChange("color", elements.colorInput.value));
    elements.strokeInput.addEventListener("input", () => { elements.strokeOutput.textContent = elements.strokeInput.value; });
    elements.strokeInput.addEventListener("change", () => applyOptionChange("strokeWidth", Number(elements.strokeInput.value)));
    elements.opacityInput.addEventListener("input", () => { elements.opacityOutput.textContent = `${elements.opacityInput.value}%`; });
    elements.opacityInput.addEventListener("change", () => applyOptionChange("opacity", Number(elements.opacityInput.value) / 100));
    elements.fontSizeInput.addEventListener("change", () => applyOptionChange("fontSize", clamp(Number(elements.fontSizeInput.value), 8, 96)));
    elements.textForm.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") { state.pendingText = null; return; }
      event.preventDefault();
      if (applyTextDialog()) elements.textDialog.close();
    });
    elements.exportForm.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      exportPdf();
    });
    ["dragenter", "dragover"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
      event.preventDefault(); elements.dropZone.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
      event.preventDefault(); elements.dropZone.classList.remove("drag-over");
    }));
    elements.dropZone.addEventListener("drop", (event) => loadPdf([...event.dataTransfer.files].find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))));
    window.addEventListener("keydown", (event) => {
      if (elements.textDialog.open || elements.exportDialog.open) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (command && event.key.toLowerCase() === "c" && state.selectedId) { event.preventDefault(); copySelection(); return; }
      if (command && event.key.toLowerCase() === "v" && state.clipboard) { event.preventDefault(); pasteSelection(); return; }
      if (command && event.key.toLowerCase() === "d" && state.selectedId) { event.preventDefault(); copySelection(true); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) { event.preventDefault(); deleteSelection(); return; }
      const selected = selectedAnnotation();
      if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        beginMutation();
        const step = event.shiftKey ? 10 : 1;
        translateItem(selected, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
        redrawCanvas(); renderThumbnails();
      }
    });
    window.addEventListener("resize", () => { if (state.pdf && window.innerWidth <= 760) fitToScreen(false); });
  }

  function registerWebMcpTools() {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: "get_pdf_editor_status",
        title: "PDF編集状況を確認",
        description: "PDFエディタで開いている文書、ページ数、現在ページ、選択中ツールを確認します。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async () => ({
          isOpen: Boolean(state.pdf),
          fileName: state.pdf ? state.fileName : null,
          pageCount: state.pages.length,
          currentPage: state.pdf ? state.currentPageIndex + 1 : null,
          selectedTool: state.tool
        })
      }, { signal: lifecycle.signal })).catch((error) => console.warn("WebMCP status tool", error));
      void Promise.resolve(modelContext.registerTool({
        name: "select_pdf_editor_tool",
        title: "PDF編集ツールを選択",
        description: "PDFエディタの編集ツールを選択します。",
        inputSchema: { type: "object", properties: { tool: { type: "string", enum: ["select", "replaceText", "text", "rectangle", "ellipse", "line", "arrow", "draw", "highlight", "whiteout"] } }, required: ["tool"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          const allowed = ["select", "replaceText", "text", "rectangle", "ellipse", "line", "arrow", "draw", "highlight", "whiteout"];
          if (!state.pdf) throw new Error("PDFが開かれていません");
          if (!input || !allowed.includes(input.tool)) throw new Error("未対応の編集ツールです");
          setTool(input.tool);
          return { selectedTool: state.tool };
        }
      }, { signal: lifecycle.signal })).catch((error) => console.warn("WebMCP tool selection", error));
      void Promise.resolve(modelContext.registerTool({
        name: "go_to_pdf_page",
        title: "PDFのページへ移動",
        description: "開いているPDFの指定ページへ移動します。",
        inputSchema: { type: "object", properties: { page: { type: "integer", minimum: 1 } }, required: ["page"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          if (!state.pdf) throw new Error("PDFが開かれていません");
          if (!Number.isInteger(input?.page) || input.page < 1 || input.page > state.pages.length) throw new Error(`ページ番号は1から${state.pages.length}の範囲で指定してください`);
          goToPage(input.page - 1);
          return { currentPage: state.currentPageIndex + 1, pageCount: state.pages.length };
        }
      }, { signal: lifecycle.signal })).catch((error) => console.warn("WebMCP page navigation", error));
    } catch (error) {
      console.warn("WebMCP registration skipped", error);
    }
  }

  function init() {
    bindEvents();
    enableDocumentControls(false);
    setTool("select");
    updateDocumentControls();
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    else window.setTimeout(() => toast("PDF機能の読み込みに失敗しました。再読み込みしてください", "error"), 500);
    registerWebMcpTools();
  }

  init();
})();
