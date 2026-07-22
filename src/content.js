(() => {
  "use strict";

  const APP = "ou-yeah";
  const HUD_ID = "ou-yeah-video-hud";
  const BOOK_DOWNLOAD_ID = "ou-yeah-book-pdf-download";
  const STORAGE_KEY = "ouYeahSettings";
  const LEGACY_STORAGE_KEY = "elolmsVideoToolsSettings";
  const LEGACY_HUD_ID = "elolms-video-tools-hud";
  const LEGACY_BOOK_DOWNLOAD_ID = "elolms-book-pdf-download";
  const BRAND = "#3659A2";
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const SKIP_SECONDS = 5;
  const DEFAULT_SETTINGS = { speed: 1 };
  const MEDIA_URL_RE = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)(?:[?#]|$)/i;
  const HLS_URL_RE = /\.m3u8(?:[?#]|$)/i;
  const DASH_URL_RE = /\.mpd(?:[?#]|$)/i;
  const HUD_VIEWPORT_MARGIN = 12;
  const HUD_VIDEO_GAP = 12;
  const PLAYER_CONTROL_SELECTORS = [
    ".vjs-control-bar",
    ".vp-controls",
    ".vp-control-bar",
    ".plyr__controls",
    ".mejs-controls",
    ".mejs__controls",
    ".jw-controlbar",
    ".fp-controls",
    "[data-testid='player-controls']",
    "[class*='ControlBar']",
    "[class*='control-bar']"
  ];
  const IS_ELOLMS = location.hostname === "elolms.ou.edu.vn";
  const IS_VIMEO = location.hostname === "player.vimeo.com";
  const IS_THUQUAN_BOOK = location.hostname === "thuquan.ou.edu.vn"
    && location.pathname.toLowerCase().startsWith("/doc-truc-tuyen/sach/");

  if (!IS_ELOLMS && !IS_VIMEO && !IS_THUQUAN_BOOK) return;
  const extensionWindow = /** @type {Window & { __ouYeahLoaded?: boolean }} */ (window);
  if (extensionWindow.__ouYeahLoaded) return;
  extensionWindow.__ouYeahLoaded = true;
  document.getElementById(LEGACY_HUD_ID)?.remove();
  document.getElementById(LEGACY_BOOK_DOWNLOAD_ID)?.remove();

  let settings = { ...DEFAULT_SETTINGS };
  let videos = [];
  let activeVideo = null;
  let hud = null;
  let scanTimer = 0;
  let saveTimer = 0;
  let hudVisibleTimer = 0;
  let hudPositionFrame = 0;
  let toastTimer = 0;
  let videoProgressResetTimer = 0;
  let lastPointerInVideoAt = 0;
  let applyingRate = false;
  let activeDownloadJobId = "";
  let videoDownloadUiPinned = false;
  let downloadToastAnchor = null;
  let nativeControlsHidden = false;
  let activeBookDownloadJobId = "";
  let bookDownloadRoot = null;
  let bookDownloadButton = null;
  let bookDownloadStatus = null;
  let bookTotalPages = 0;
  let bookStatusTimer = 0;
  const registeredVideos = new WeakSet();

  if (IS_THUQUAN_BOOK) {
    try {
      initBookDownloader();
    } catch (error) {
      handleExtensionError(error);
    }
    return;
  }

  init().catch(handleExtensionError);

  function initBookDownloader() {
    if (window.top !== window.self) return;

    bindBookDownloadMessages();
    injectBookDownloadButton();
  }

  function injectBookDownloadButton() {
    if (document.getElementById(BOOK_DOWNLOAD_ID)) return true;

    const host = document.createElement("div");
    host.id = BOOK_DOWNLOAD_ID;
    const root = host.attachShadow({ mode: "open" });
    const book = readBookConfig();
    bookTotalPages = book?.totalPages || 0;

    root.innerHTML = `
      <style>${bookDownloadCss()}</style>
      <div class="book-hud" role="group" aria-label="Công cụ tải sách PDF" data-status="idle">
        <span class="book-logo" aria-hidden="true">${toolLogo()}</span>
        <span class="book-divider" aria-hidden="true"></span>
        <button type="button" data-book-action="download" title="Tải sách PDF" aria-label="Tải sách PDF">
          <span class="book-action-icon" aria-hidden="true">${icon("download")}</span>
          <span class="book-action-label">Tải PDF</span>
        </button>
        <span class="book-divider book-divider-status" aria-hidden="true"></span>
        <span class="book-progress" aria-live="polite">
          <span class="book-status">${bookTotalPages ? `${bookTotalPages} trang` : "PDF"}</span>
          <span class="book-progress-track" aria-hidden="true">
            <span class="book-progress-fill"></span>
          </span>
        </span>
      </div>
    `;

    document.documentElement.appendChild(host);
    bookDownloadRoot = root;
    bookDownloadButton = root.querySelector("[data-book-action='download']");
    bookDownloadStatus = root.querySelector(".book-status");
    bookDownloadButton.addEventListener("click", () => {
      startBookPdfDownload().catch(handleExtensionError);
    });
    return true;
  }

  function bookDownloadCss() {
    return `
      @keyframes bookHudReveal {
        from { opacity: 0; transform: translate(-50%, 10px) scale(0.96); }
        to { opacity: 1; transform: translate(-50%, 0) scale(1); }
      }
      @keyframes bookSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes bookProgressSweep {
        from { transform: translateX(-120%); }
        to { transform: translateX(260%); }
      }
      @keyframes bookSuccess {
        0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05); }
        50% { box-shadow: 0 8px 32px rgba(0,0,0,0.42), 0 0 22px rgba(74, 222, 128, 0.22), inset 0 1px 0 rgba(255,255,255,0.05); }
      }
      @keyframes bookLogoSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      :host {
        all: initial;
        position: fixed;
        left: 50%;
        bottom: 49px;
        z-index: 2147483647;
        display: block;
        color-scheme: dark;
        font-family: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
        pointer-events: none;
      }
      * { box-sizing: border-box; font-family: inherit; }
      .book-hud {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: calc(100vw - 24px);
        padding: 5px;
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 16px;
        background: rgba(15,17,26,0.9);
        color: rgba(255,255,255,0.95);
        box-shadow: 0 8px 32px rgba(0,0,0,0.42), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05);
        backdrop-filter: blur(18px) saturate(165%);
        -webkit-backdrop-filter: blur(18px) saturate(165%);
        transform: translateX(-50%);
        animation: bookHudReveal 320ms cubic-bezier(0.16,1,0.3,1) both;
        pointer-events: auto;
      }
      .book-hud[data-status="complete"] {
        animation: bookSuccess 900ms ease-in-out;
      }
      .book-logo {
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, ${BRAND} 0%, #4a7ae8 100%);
        color: #fff;
        flex: 0 0 auto;
        box-shadow: 0 2px 10px rgba(54,89,162,0.38), inset 0 1px 0 rgba(255,255,255,0.17);
        transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 300ms ease;
      }
      .book-logo:hover {
        transform: scale(1.1);
        box-shadow: 0 0 12px rgba(54,89,162,0.4), inset 0 1px 0 rgba(255,255,255,0.17);
      }
      .book-logo:hover svg {
        animation: bookLogoSpin 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      }
      .book-logo svg { width: 18px; height: 18px; fill: currentColor; transition: transform 200ms ease; }
      .book-divider {
        width: 1px;
        height: 22px;
        flex: 0 0 auto;
        background: linear-gradient(180deg, transparent, rgba(255,255,255,0.09), transparent);
      }
      button {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        height: 36px;
        min-width: 100px;
        padding: 0 13px;
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 9px;
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.94);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        transition: background 180ms ease, border-color 180ms ease, color 180ms ease, transform 120ms ease, box-shadow 180ms ease;
      }
      button:hover:not(:disabled) {
        background: rgba(74,122,232,0.12);
        border-color: rgba(74,122,232,0.3);
        color: #7fa3f5;
        box-shadow: 0 3px 12px rgba(0,0,0,0.24);
      }
      button:active:not(:disabled) { transform: scale(0.96); }
      button:focus-visible {
        outline: 2px solid #4a7ae8;
        outline-offset: 2px;
      }
      button:disabled { cursor: progress; }
      .book-action-icon {
        display: grid;
        place-items: center;
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
      }
      .book-action-icon svg {
        display: block;
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .book-action-icon .asset-icon {
        display: block;
        width: 17px;
        height: 17px;
        background: currentColor;
        -webkit-mask: var(--asset-icon) center / contain no-repeat;
        mask: var(--asset-icon) center / contain no-repeat;
        transform-origin: center;
      }
      button[data-busy="true"] .book-action-icon svg,
      button[data-busy="true"] .book-action-icon .asset-icon {
        animation: bookSpin 980ms linear infinite;
        transform-origin: center;
        will-change: transform;
      }
      .book-action-label { white-space: nowrap; }
      .book-progress {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 74px;
        min-width: 74px;
        height: 36px;
        padding: 0 7px;
      }
      .book-status {
        color: rgba(255,255,255,0.34);
        font-size: 11px;
        font-weight: 650;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.01em;
        text-align: center;
        white-space: nowrap;
        transform: translateY(0);
        transition: color 220ms ease, transform 280ms cubic-bezier(0.16,1,0.3,1);
      }
      .book-progress-track {
        position: absolute;
        right: 7px;
        bottom: 6px;
        left: 7px;
        display: block;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.28);
        opacity: 0;
        transform: translateY(2px) scaleX(0.82);
        transition: opacity 220ms ease, transform 280ms cubic-bezier(0.16,1,0.3,1);
      }
      .book-progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--book-progress, 0%);
        min-width: 0;
        overflow: hidden;
        border-radius: inherit;
        background: linear-gradient(90deg, ${BRAND}, #5b8df2);
        box-shadow: 0 0 8px rgba(74,122,232,0.42);
        transition: width 420ms cubic-bezier(0.16,1,0.3,1), background 220ms ease, box-shadow 220ms ease;
        will-change: width;
      }
      .book-progress-fill::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 38%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.58), transparent);
        transform: translateX(-120%);
      }
      .book-hud[data-status="preparing"] .book-progress-track,
      .book-hud[data-status="downloading"] .book-progress-track,
      .book-hud[data-status="building"] .book-progress-track,
      .book-hud[data-status="complete"] .book-progress-track,
      .book-hud[data-status="error"] .book-progress-track {
        opacity: 1;
        transform: translateY(0) scaleX(1);
      }
      .book-hud[data-status="preparing"] .book-status,
      .book-hud[data-status="downloading"] .book-status,
      .book-hud[data-status="building"] .book-status,
      .book-hud[data-status="complete"] .book-status,
      .book-hud[data-status="error"] .book-status {
        transform: translateY(-5px);
      }
      .book-hud[data-status="preparing"] .book-progress-fill::after,
      .book-hud[data-status="downloading"] .book-progress-fill::after,
      .book-hud[data-status="building"] .book-progress-fill::after {
        animation: bookProgressSweep 1.35s ease-in-out infinite;
      }
      .book-hud[data-status="complete"] .book-progress-fill {
        background: linear-gradient(90deg, #22c55e, #4ade80);
        box-shadow: 0 0 8px rgba(74,222,128,0.38);
      }
      .book-hud[data-status="error"] .book-progress-fill {
        background: linear-gradient(90deg, #ef4444, #f87171);
        box-shadow: 0 0 8px rgba(248,113,113,0.34);
      }
      .book-hud[data-status="preparing"] .book-status,
      .book-hud[data-status="downloading"] .book-status,
      .book-hud[data-status="building"] .book-status { color: #7fa3f5; }
      .book-hud[data-status="complete"] .book-status { color: #4ade80; }
      .book-hud[data-status="error"] .book-status { color: #f87171; }
      @media (max-width: 420px) {
        :host { bottom: 45px; }
        .book-logo, .book-divider-status { display: none; }
        .book-hud { border-radius: 13px; }
        button { min-width: 92px; }
        .book-progress { width: 64px; min-width: 64px; padding: 0 4px; }
        .book-progress-track { right: 4px; left: 4px; }
      }
    `;
  }

  function bindBookDownloadMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "ou-yeah-book-progress") return;
      if (activeBookDownloadJobId && message.jobId !== activeBookDownloadJobId) return;

      activeBookDownloadJobId = message.jobId;
      updateBookDownloadUi(message);
    });
  }

  async function startBookPdfDownload() {
    if (!bookDownloadButton || activeBookDownloadJobId) return;

    const book = readBookConfig();
    if (!book) {
      updateBookDownloadUi({
        status: "error",
        label: "Không đọc được cấu hình sách trên trang."
      });
      return;
    }
    bookTotalPages = book.totalPages;

    updateBookDownloadUi({
      status: "preparing",
      label: `Đang chuẩn bị ${book.totalPages} trang...`,
      percent: 0
    });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ou-yeah-download-book-pdf",
        book,
        filename: `${book.title}.pdf`
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Không thể bắt đầu tạo PDF.");
      }

      activeBookDownloadJobId = response.jobId;
    } catch (error) {
      activeBookDownloadJobId = "";
      updateBookDownloadUi({ status: "error", label: readableError(error) });
    }
  }

  function readBookConfig() {
    const pageImage = /** @type {HTMLImageElement | null} */ (
      document.querySelector("#dvContainer img[src*='page.ashx'], img[src*='/readonline/page.ashx']")
    );
    if (!pageImage) return null;

    let pageUrl;
    try {
      pageUrl = new URL(pageImage.getAttribute("src") || pageImage.src, location.href);
    } catch {
      return null;
    }

    const scriptText = Array.from(document.scripts)
      .map((script) => script.textContent || "")
      .find((text) => text.includes("reader.setView(")) || "";
    const totalMatch = /reader\.setView\(\s*[^,]+,\s*\d+,\s*\d+,\s*(\d+)/.exec(scriptText);

    const documentId = Number(pageUrl.searchParams.get("id"));
    const totalPages = Number(totalMatch?.[1]);
    const zoom = Number(pageUrl.searchParams.get("z"));
    const signature = pageUrl.searchParams.get("sig") || "";
    const title = (document.getElementById("titleSach")?.textContent || document.title)
      .replace(/^Thư Quán OU\s*-\s*Đọc trực tuyến\s*-\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!Number.isInteger(documentId) || documentId <= 0) return null;
    if (!Number.isInteger(totalPages) || totalPages <= 0 || totalPages > 2000) return null;
    if (!Number.isInteger(zoom) || zoom <= 0 || zoom > 20) return null;
    if (!signature || signature.length > 256) return null;

    return {
      documentId,
      totalPages,
      zoom,
      signature,
      title: title || `thu-quan-${documentId}`
    };
  }

  function updateBookDownloadUi(message) {
    if (!bookDownloadButton || !bookDownloadRoot || !bookDownloadStatus) return;

    window.clearTimeout(bookStatusTimer);
    const status = message.status || "downloading";
    const isBusy = ["preparing", "downloading", "building"].includes(status);
    const percent = Number.isFinite(Number(message.percent))
      ? Math.max(0, Math.min(100, Math.round(Number(message.percent))))
      : 0;
    const label = message.label || "Đang tạo PDF...";
    const bookHud = bookDownloadRoot.querySelector(".book-hud");
    const visualPercent = status === "complete" || status === "error"
      ? 100
      : status === "preparing"
        ? Math.max(3, percent)
        : percent;

    bookDownloadButton.disabled = isBusy;
    bookDownloadButton.dataset.busy = String(isBusy);
    bookDownloadButton.dataset.status = status;
    bookDownloadButton.title = label;
    bookDownloadButton.setAttribute("aria-label", label);
    bookHud.dataset.status = status;
    bookHud.style.setProperty("--book-progress", `${visualPercent}%`);
    bookDownloadStatus.textContent = status === "preparing" ? "Chuẩn bị" : `${percent}%`;

    if (status === "complete") {
      activeBookDownloadJobId = "";
      bookDownloadButton.querySelector(".book-action-icon").innerHTML = icon("check");
      bookDownloadButton.querySelector(".book-action-label").textContent = "Đã tải";
      bookStatusTimer = window.setTimeout(resetBookDownloadButton, 3500);
    } else if (status === "error") {
      activeBookDownloadJobId = "";
      bookDownloadButton.querySelector(".book-action-icon").innerHTML = icon("warning");
      bookDownloadButton.querySelector(".book-action-label").textContent = "Thử lại";
      bookDownloadStatus.textContent = "Lỗi";
      bookStatusTimer = window.setTimeout(resetBookDownloadButton, 5000);
    } else {
      bookDownloadButton.querySelector(".book-action-icon").innerHTML = icon("loader");
      bookDownloadButton.querySelector(".book-action-label").textContent = status === "building"
        ? "Tạo PDF"
        : "Đang tải";
    }
  }

  function resetBookDownloadButton() {
    if (!bookDownloadButton || !bookDownloadRoot || !bookDownloadStatus) return;
    bookDownloadButton.disabled = false;
    bookDownloadButton.dataset.busy = "false";
    bookDownloadButton.dataset.status = "idle";
    bookDownloadButton.title = "Tải sách PDF";
    bookDownloadButton.setAttribute("aria-label", "Tải sách PDF");
    bookDownloadButton.querySelector(".book-action-icon").innerHTML = icon("download");
    bookDownloadButton.querySelector(".book-action-label").textContent = "Tải PDF";
    bookDownloadStatus.textContent = bookTotalPages ? `${bookTotalPages} trang` : "PDF";
    const bookHud = bookDownloadRoot.querySelector(".book-hud");
    bookHud.dataset.status = "idle";
    bookHud.style.setProperty("--book-progress", "0%");
  }

  async function init() {
    settings = { ...DEFAULT_SETTINGS, ...await loadSettings() };
    settings.speed = clamp(Number(settings.speed) || 1, 0.25, 4);

    scanVideos();
    observeVideoChanges();
    bindRuntimeMessages();

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("fullscreenchange", placeHudHost);
    document.addEventListener("keydown", handleKeyboard, true);
    document.addEventListener("scroll", scheduleHudPosition, true);
    window.addEventListener("resize", scheduleHudPosition, { passive: true });

    window.setInterval(() => {
      scanVideos();
      updateTimeUi();
    }, 1000);
    window.setInterval(syncHudWithPlayerControls, 180);
  }

  function observeVideoChanges() {
    const observer = new MutationObserver(() => {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scanVideos, 160);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
  }

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "ou-yeah-toggle-panel" || message?.type === "ou-yeah-pulse-hud") {
        scanVideos();
        showHudFor(2200);
      }

      if (message?.type === "ou-yeah-download-progress") {
        if (activeDownloadJobId && message.jobId !== activeDownloadJobId) return;
        updateDownloadUi(message);
      }
    });

    document.addEventListener("ou-yeah-pulse", () => {
      scanVideos();
      showHudFor(2200);
    });
  }

  function scanVideos() {
    videos = Array.from(document.querySelectorAll("video")).filter((video) => video.isConnected);
    videos.forEach(registerVideo);
    activeVideo = chooseVideo();
    applySpeedToVideos();
    renderHud();
  }

  function registerVideo(video) {
    if (registeredVideos.has(video)) return;
    registeredVideos.add(video);

    ["play", "pause", "loadedmetadata", "durationchange", "timeupdate"].forEach((eventName) => {
      video.addEventListener(eventName, () => {
        activeVideo = video;
        scheduleHudPosition();
        updateTimeUi();
      });
    });

    video.addEventListener("ratechange", () => {
      if (applyingRate) return;
      settings.speed = clamp(video.playbackRate || settings.speed, 0.25, 4);
      saveSettingsSoon();
      updateSpeedUi();
    });
  }

  function chooseVideo() {
    if (activeVideo?.isConnected) return activeVideo;

    const playing = videos.find((video) => !video.paused && !video.ended);
    if (playing) return playing;

    return videos
      .map((video) => ({ video, area: visibleArea(video) || video.clientWidth * video.clientHeight }))
      .sort((a, b) => b.area - a.area)[0]?.video || null;
  }

  function renderHud() {
    if (!videos.length) {
      if (hud) {
        if (videoDownloadUiPinned) {
          hud.host.hidden = false;
          hud.host.classList.add("is-visible");
        } else {
          hud.host.hidden = true;
          hud.host.classList.remove("is-visible", "menu-open");
        }
      }
      return;
    }

    if (!hud) createHud();
    hud.host.hidden = false;
    placeHudHost();
    scheduleHudPosition();
    updateSpeedUi();
    updateTimeUi();
  }

  function createHud() {
    const host = document.createElement("div");
    host.id = HUD_ID;

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${hudCss()}</style>
      <div class="hud" role="group" aria-label="Điều khiển nhanh video" data-download-status="idle">
        <span class="hud-logo">${toolLogo()}</span>
        <span class="hud-divider"></span>
        <button type="button" data-hud-action="backward" title="Alt + ←">${icon("rewind")}<span>-${SKIP_SECONDS}s</span></button>
        <div class="hud-speed-wrap">
          <button class="speed" type="button" data-hud-action="speed-menu" title="Chọn tốc độ phát" aria-haspopup="listbox" aria-expanded="false">
            <span data-role="hud-speed">1x</span>
            ${icon("chevronDown")}
          </button>
          <div class="hud-menu" role="listbox" aria-label="Tốc độ phát">
            ${SPEEDS.map((speed) => `
              <button type="button" role="option" data-hud-speed="${speed}">${formatSpeed(speed)}</button>
            `).join("")}
          </div>
        </div>
        <button type="button" data-hud-action="forward" title="Alt + →"><span>+${SKIP_SECONDS}s</span>${icon("forward")}</button>
        <span class="hud-divider"></span>
        <button class="icon-only" type="button" data-hud-action="download" title="Tải video" aria-label="Tải video">
          <span data-role="download-icon">${icon("download")}</span>
        </button>
        <span class="hud-download-progress" data-role="download-progress" role="progressbar" aria-label="Tiến trình tải video" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-hidden="true">
          <span class="hud-download-status" data-role="download-status">0%</span>
          <span class="hud-download-track" aria-hidden="true"><span class="hud-download-fill"></span></span>
        </span>
        <span class="hud-divider"></span>
        <span class="hud-time">--:--</span>
        <span class="toast" data-role="toast"></span>
      </div>
    `;

    document.documentElement.appendChild(host);
    hud = {
      host,
      root,
      bar: root.querySelector(".hud"),
      speed: root.querySelector('[data-role="hud-speed"]'),
      speedButton: root.querySelector('[data-hud-action="speed-menu"]'),
      downloadButton: root.querySelector('[data-hud-action="download"]'),
      downloadIcon: root.querySelector('[data-role="download-icon"]'),
      downloadProgress: root.querySelector('[data-role="download-progress"]'),
      downloadStatus: root.querySelector('[data-role="download-status"]'),
      toast: root.querySelector('[data-role="toast"]')
    };

    root.addEventListener("click", handleHudClick);
    root.addEventListener("pointerenter", () => showHudFor(0));
    root.addEventListener("pointerleave", () => scheduleHudHide(650));

    document.addEventListener("pointerdown", (event) => {
      if (!hud?.host || event.composedPath().includes(hud.host)) return;
      closeSpeedMenu();
    }, true);
  }

  function handleHudClick(event) {
    const speedOption = event.target.closest?.("[data-hud-speed]");
    if (speedOption) {
      event.preventDefault();
      event.stopPropagation();
      setSpeed(Number(speedOption.dataset.hudSpeed), hud.speedButton);
      closeSpeedMenu();
      showHudFor(1600);
      return;
    }

    const button = event.target.closest?.("button[data-hud-action]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.hudAction;
    if (action !== "speed-menu") closeSpeedMenu();
    if (action === "backward") seekBy(-SKIP_SECONDS, button);
    if (action === "forward") seekBy(SKIP_SECONDS, button);
    if (action === "speed-menu") toggleSpeedMenu();
    if (action === "download") downloadVideo(button).catch(handleExtensionError);
  }

  function setSpeed(value, toastAnchor = null) {
    settings.speed = clamp(value, 0.25, 4);
    saveSettingsSoon();
    applySpeedToVideos();
    updateSpeedUi();
    showToast(formatSpeed(settings.speed), false, toastAnchor);
  }

  function cycleSpeed() {
    const video = chooseVideo();
    const current = video?.playbackRate || settings.speed;
    const index = SPEEDS.findIndex((speed) => Math.abs(speed - current) < 0.03);
    setSpeed(SPEEDS[index < 0 ? 0 : (index + 1) % SPEEDS.length]);
  }

  function applySpeedToVideos() {
    applyingRate = true;
    for (const video of videos) {
      try {
        video.defaultPlaybackRate = settings.speed;
        video.playbackRate = settings.speed;
      } catch {
        // Player có thể khóa playbackRate trong vài khoảnh khắc khởi tạo.
      }
    }

    window.setTimeout(() => {
      applyingRate = false;
    }, 0);
  }

  function seekBy(delta, toastAnchor = null) {
    const video = chooseVideo();
    if (!video) {
      showToast("Chưa thấy video", true, toastAnchor);
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = clamp((video.currentTime || 0) + delta, 0, duration);
    activeVideo = video;
    updateTimeUi();
    showToast(`${delta > 0 ? "+" : ""}${delta}s`, false, toastAnchor);
  }

  function handleKeyboard(event) {
    if (isTypingTarget(event.target)) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-SKIP_SECONDS);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(SKIP_SECONDS);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cycleSpeed();
    }
  }

  function isTypingTarget(target) {
    const tag = target?.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
  }

  function updateSpeedUi() {
    if (!hud) return;

    hud.speed.textContent = formatSpeed(settings.speed);
    hud.root.querySelectorAll("[data-hud-speed]").forEach((option) => {
      option.classList.toggle("is-selected", Math.abs(Number(option.dataset.hudSpeed) - settings.speed) < 0.001);
    });
  }

  function updateTimeUi() {
    if (!hud) return;

    const video = chooseVideo();
    hud.root.querySelector(".hud-time").textContent = video
      ? `${formatTime(video.currentTime || 0)} / ${Number.isFinite(video.duration) ? formatTime(video.duration) : "--:--"}`
      : "--:--";
    scheduleHudPosition();
  }

  function handlePointerMove(event) {
    const video = chooseVideo();
    if (!video || !hud) return;

    if (document.fullscreenElement || pointInsideElement(event.clientX, event.clientY, video)) {
      lastPointerInVideoAt = Date.now();
      scheduleHudPosition();

      if (!nativeControlsHidden) {
        showHudFor(1800);
      }
    }
  }

  function pointInsideElement(x, y, element) {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function scheduleHudPosition() {
    if (!hud?.host || hud.host.hidden || hudPositionFrame) return;

    hudPositionFrame = window.requestAnimationFrame(() => {
      hudPositionFrame = 0;
      positionHud();
    });
  }

  function positionHud() {
    if (!hud?.host || hud.host.hidden || !hud.bar) return;

    const video = chooseVideo();
    if (!video) return;

    const videoRect = video.getBoundingClientRect();
    const hudRect = hud.bar.getBoundingClientRect();
    const hudWidth = hudRect.width || 370;
    const hudHeight = hudRect.height || 50;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = HUD_VIEWPORT_MARGIN;
    const maxHudWidth = Math.max(220, Math.min(viewportWidth - margin * 2, videoRect.width - margin * 2));

    hud.host.style.setProperty("--hud-max-width", `${Math.round(maxHudWidth)}px`);

    if (videoRect.width <= 0 || videoRect.height <= 0) {
      placeHudInViewportCenter(hudWidth, hudHeight);
      return;
    }

    const visibleLeft = clamp(videoRect.left, 0, viewportWidth);
    const visibleRight = clamp(videoRect.right, 0, viewportWidth);
    const visibleTop = clamp(videoRect.top, 0, viewportHeight);
    const visibleBottom = clamp(videoRect.bottom, 0, viewportHeight);
    const visibleWidth = visibleRight - visibleLeft;
    const visibleHeight = visibleBottom - visibleTop;

    if (visibleWidth < 80 || visibleHeight < 36) {
      placeHudInViewportCenter(hudWidth, hudHeight);
      return;
    }

    const controlsOffset = 56;
    const desiredBottom = visibleBottom - controlsOffset;
    const minTop = Math.min(visibleTop + HUD_VIDEO_GAP, Math.max(margin, viewportHeight - hudHeight - margin));
    const maxTop = Math.max(margin, viewportHeight - hudHeight - margin);
    const top = clamp(desiredBottom - hudHeight, minTop, maxTop);
    const fittedHudWidth = Math.min(hudWidth, viewportWidth - margin * 2);
    const halfHud = fittedHudWidth / 2;
    const left = clamp(
      (visibleLeft + visibleRight) / 2,
      margin + halfHud,
      Math.max(margin + halfHud, viewportWidth - margin - halfHud)
    );

    hud.host.style.setProperty("--hud-left", `${Math.round(left)}px`);
    hud.host.style.setProperty("--hud-top", `${Math.round(top)}px`);
  }

  function placeHudInViewportCenter(hudWidth, hudHeight) {
    const margin = HUD_VIEWPORT_MARGIN;
    const fittedHudWidth = Math.min(hudWidth, window.innerWidth - margin * 2);
    const halfHud = fittedHudWidth / 2;
    const left = clamp(
      window.innerWidth / 2,
      margin + halfHud,
      Math.max(margin + halfHud, window.innerWidth - margin - halfHud)
    );
    const top = Math.max(margin, window.innerHeight - hudHeight - 18);

    hud.host.style.setProperty("--hud-left", `${Math.round(left)}px`);
    hud.host.style.setProperty("--hud-top", `${Math.round(top)}px`);
  }

  function placeHudHost() {
    if (!hud?.host) return;

    const fullscreenElement = document.fullscreenElement;
    const canNestInFullscreen = fullscreenElement
      && fullscreenElement.nodeType === Node.ELEMENT_NODE
      && fullscreenElement.tagName !== "VIDEO";
    const target = canNestInFullscreen ? fullscreenElement : document.documentElement;

    if (hud.host.parentElement !== target) {
      target.appendChild(hud.host);
    }

    const wasFullscreen = hud.host.classList.contains("is-fullscreen");
    const isFullscreen = Boolean(fullscreenElement);
    hud.host.classList.toggle("is-fullscreen", isFullscreen);
    scheduleHudPosition();
    
    if (isFullscreen && !wasFullscreen && !nativeControlsHidden) {
      showHudFor(2200);
    }
  }

  function syncHudWithPlayerControls() {
    if (!hud?.host || hud.host.hidden || hud.host.classList.contains("menu-open")) return;

    const nativeVisibility = getPlayerControlsVisibility();
    if (nativeVisibility === true) {
      nativeControlsHidden = false;
      positionHud();
      showHudFor(0);
      return;
    }

    if (nativeVisibility === false) {
      nativeControlsHidden = true;
      hideHud();
      return;
    }

    nativeControlsHidden = false;
    if (Date.now() - lastPointerInVideoAt > 1800) {
      hideHud();
    }
  }

  function getPlayerControlsVisibility() {
    const video = chooseVideo();
    const videoRect = video?.getBoundingClientRect();
    const candidates = getPlayerControlCandidates()
      .filter((element) => isPotentialPlayerControls(element, videoRect));

    if (!candidates.length) return undefined;
    if (candidates.some((element) => isLikelyPlayerControls(element, videoRect) && isElementVisible(element))) return true;

    return false;
  }

  function getPlayerControlCandidates() {
    const elements = PLAYER_CONTROL_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)));

    return Array.from(new Set(elements));
  }

  function isPotentialPlayerControls(element, videoRect) {
    if (!element || element === hud?.host || hud?.host?.contains(element)) return false;

    const marker = `${element.className || ""} ${element.id || ""}`.toLowerCase();
    if (marker.includes("ou-yeah") || marker.includes("elolms-video-tools")) return false;
    if (!element.querySelector("button, [role='button'], input, progress, [aria-label]")) return false;
    if (!videoRect) return true;

    const rect = usableControlRect(element);
    if (rect.width <= 0 || rect.height <= 0) return true;

    return rect.right > videoRect.left
      && rect.left < videoRect.right
      && rect.bottom > videoRect.top
      && rect.top < videoRect.bottom + 120;
  }

  function usableControlRect(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;

    const container = element.closest(".video-js, .vjs, .vp-player, .plyr, .mejs-container, .jwplayer, .flowplayer");
    return container?.getBoundingClientRect() || rect;
  }

  function isLikelyPlayerControls(element, videoRect) {
    if (!element || element === hud?.host || hud?.host?.contains(element)) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 18 || rect.height > 120) return false;

    if (videoRect) {
      const overlapsVideo = rect.right > videoRect.left
        && rect.left < videoRect.right
        && rect.bottom > videoRect.top
        && rect.top < videoRect.bottom + 120;
      const nearVideoBottom = rect.bottom >= videoRect.top + Math.min(80, videoRect.height * 0.25);
      if (!overlapsVideo || !nearVideoBottom) return false;
    } else if (rect.bottom < window.innerHeight * 0.58) {
      return false;
    }

    const marker = `${element.className || ""} ${element.id || ""}`.toLowerCase();
    if (marker.includes("ou-yeah") || marker.includes("elolms-video-tools")) return false;
    if (/\b(hidden|inactive|fade-out|faded|transparent)\b/.test(marker)) return false;

    return element.querySelector("button, [role='button'], input, progress, [aria-label]") != null;
  }

  function isElementVisible(element) {
    const rect = element.getBoundingClientRect();

    if (element.closest("[aria-hidden='true'], [hidden]")) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;

    for (let current = element; current?.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      const style = getComputedStyle(current);
      const opacity = Number.parseFloat(style.opacity || "1");

      if (style.display === "none" || style.visibility === "hidden" || opacity < 0.05) return false;
      if (current === element && style.pointerEvents === "none") return false;
    }

    return true;
  }

  function showHudFor(duration = 1700) {
    if (!hud?.host || hud.host.hidden) return;

    positionHud();
    hud.host.classList.add("is-visible");
    window.clearTimeout(hudVisibleTimer);

    if (duration > 0 && !videoDownloadUiPinned && !hud.host.classList.contains("menu-open")) {
      hudVisibleTimer = window.setTimeout(hideHud, duration);
    }
  }

  function scheduleHudHide(delay = 900) {
    if (!hud?.host || videoDownloadUiPinned || hud.host.classList.contains("menu-open")) return;
    window.clearTimeout(hudVisibleTimer);
    hudVisibleTimer = window.setTimeout(hideHud, delay);
  }

  function hideHud() {
    if (!hud?.host || videoDownloadUiPinned || hud.host.classList.contains("menu-open")) return;
    if (hud.host.matches(":hover")) return;
    hud.host.classList.remove("is-visible");
    const focused = hud.root.activeElement;
    if (focused) focused.blur();
  }

  function toggleSpeedMenu() {
    if (!hud?.host) return;

    const willOpen = !hud.host.classList.contains("menu-open");
    hud.host.classList.toggle("menu-open", willOpen);
    hud.speedButton?.setAttribute("aria-expanded", String(willOpen));
    showHudFor(0);
  }

  function closeSpeedMenu() {
    if (!hud?.host) return;

    hud.host.classList.remove("menu-open");
    hud.speedButton?.setAttribute("aria-expanded", "false");
    scheduleHudHide(900);
  }

  function showToast(text, isError = false, anchor = null, persistent = false) {
    if (!hud) return;

    showHudFor(persistent ? 0 : 1300);
    hud.toast.textContent = text;
    hud.toast.classList.toggle("is-error", Boolean(isError));
    positionToast(anchor);
    hud.toast.classList.add("is-visible");

    window.clearTimeout(toastTimer);
    if (!persistent) {
      toastTimer = window.setTimeout(() => {
        hud.toast.classList.remove("is-visible");
      }, 900);
    }
  }

  function pinVideoDownloadUi(anchor = null) {
    videoDownloadUiPinned = true;
    downloadToastAnchor = anchor;
    window.clearTimeout(hudVisibleTimer);
    window.clearTimeout(toastTimer);
    window.clearTimeout(videoProgressResetTimer);
    showHudFor(0);
  }

  function releaseVideoDownloadUi() {
    videoDownloadUiPinned = false;
    activeDownloadJobId = "";
    downloadToastAnchor = null;
    window.clearTimeout(videoProgressResetTimer);
    videoProgressResetTimer = window.setTimeout(resetVideoDownloadProgress, 1600);
    scheduleHudHide(1600);
  }

  function updateVideoDownloadProgress(message) {
    if (!hud?.bar || !hud.downloadButton || !hud.downloadIcon || !hud.downloadProgress || !hud.downloadStatus) return;

    const status = message.status || "downloading";
    const isBusy = ["preparing", "downloading", "building"].includes(status);
    const percent = Number.isFinite(Number(message.percent))
      ? clamp(Math.round(Number(message.percent)), 0, 100)
      : 0;
    const visualPercent = status === "complete" || status === "error"
      ? 100
      : status === "preparing"
        ? Math.max(3, percent)
        : percent;
    const label = message.label || (isBusy ? "Đang tải video..." : "Tải video");

    hud.bar.dataset.downloadStatus = status;
    hud.bar.style.setProperty("--video-download-progress", `${visualPercent}%`);
    hud.downloadProgress.setAttribute("aria-valuenow", String(percent));
    hud.downloadProgress.setAttribute("aria-valuetext", label);
    hud.downloadProgress.setAttribute("aria-hidden", String(status === "idle"));
    hud.downloadStatus.textContent = status === "preparing"
      ? "Chuẩn bị"
      : status === "error"
        ? "Lỗi"
        : `${percent}%`;
    hud.downloadButton.disabled = isBusy;
    hud.downloadButton.dataset.busy = String(isBusy);
    hud.downloadButton.title = label;
    hud.downloadButton.setAttribute("aria-label", label);
    hud.downloadIcon.innerHTML = status === "complete"
      ? icon("check")
      : status === "error"
        ? icon("warning")
        : isBusy
          ? icon("loader")
          : icon("download");
  }

  function resetVideoDownloadProgress() {
    updateVideoDownloadProgress({ status: "idle", percent: 0, label: "Tải video" });
  }

  function hideToast() {
    if (!hud?.toast) return;
    window.clearTimeout(toastTimer);
    hud.toast.classList.remove("is-visible");
  }

  function positionToast(anchor) {
    if (!hud?.bar || !hud.toast) return;

    const barRect = hud.bar.getBoundingClientRect();
    let left = barRect.width / 2;

    if (anchor?.isConnected) {
      const anchorRect = anchor.getBoundingClientRect();
      left = (anchorRect.left + anchorRect.right) / 2 - barRect.left;
    }

    const toastWidth = hud.toast.getBoundingClientRect().width;
    const edge = Math.min(8 + toastWidth / 2, barRect.width / 2);
    left = clamp(left, edge, Math.max(edge, barRect.width - edge));
    hud.toast.style.setProperty("--toast-left", `${Math.round(left)}px`);
  }

  async function downloadVideo(toastAnchor = null) {
    if (videoDownloadUiPinned) {
      showToast("Đang tải video...", false, downloadToastAnchor, true);
      return;
    }

    const video = chooseVideo();
    if (!video) {
      showToast("Chưa thấy video", true, toastAnchor);
      return;
    }

    pinVideoDownloadUi(toastAnchor);
    updateVideoDownloadProgress({ status: "preparing", percent: 0, label: "Đang tìm link video..." });
    showToast("Đang tìm link...", false, toastAnchor, true);

    try {
      const candidates = await collectCandidates(video);
      const chosen = chooseDownloadCandidate(candidates);

      if (!chosen) {
        const message = candidates.some((candidate) => candidate.isDash)
          ? "Chưa hỗ trợ DASH"
          : "Chưa bắt được link";
        updateVideoDownloadProgress({ status: "error", percent: 0, label: message });
        showToast(message, true, toastAnchor);
        releaseVideoDownloadUi();
        return;
      }

      const response = await sendRuntimeMessage({
        type: "ou-yeah-download-media",
        url: chosen.url,
        filename: buildFilename(chosen.url, chosen.quality),
        pageTitle: document.title
      });

      if (!response?.ok) {
        const message = response?.error || "Không tải được";
        updateVideoDownloadProgress({ status: "error", percent: 0, label: message });
        showToast(message, true, toastAnchor);
        releaseVideoDownloadUi();
        return;
      }

      if (response.mode === "hls") {
        activeDownloadJobId = response.jobId;
        hideToast();
      } else {
        updateVideoDownloadProgress({ status: "complete", percent: 100, label: "Đã gửi video sang Downloads." });
        showToast("Đã gửi tải", false, toastAnchor);
        releaseVideoDownloadUi();
      }
    } catch (error) {
      const message = readableError(error);
      updateVideoDownloadProgress({ status: "error", percent: 0, label: message });
      showToast(message, true, toastAnchor);
      releaseVideoDownloadUi();
    }
  }

  async function collectCandidates(video) {
    const candidates = [];
    addCandidate(candidates, video.currentSrc, "video hiện tại", 120, true);
    addCandidate(candidates, video.src, "video.src", 115, true);

    video.querySelectorAll("source[src]").forEach((source) => {
      addCandidate(candidates, source.getAttribute("src"), "source", 110, true);
    });

    document.querySelectorAll("video[src], source[src], a[href]").forEach((element) => {
      addCandidate(candidates, element.getAttribute("src") || element.getAttribute("href"), element.tagName.toLowerCase(), 60, false);
    });

    try {
      performance.getEntriesByType("resource").forEach((entry) => {
        addCandidate(candidates, entry.name, "network", 70, false);
      });
    } catch {
      // Một vài iframe chặn performance entries.
    }

    if (IS_VIMEO) {
      await collectVimeoCandidates(candidates);
    }

    const background = await sendRuntimeMessage({ type: "ou-yeah-get-media-candidates" }).catch(() => null);
    (background?.candidates || []).forEach((candidate, index) => {
      addCandidate(candidates, candidate.url, candidate.source || "network", 90 - index, false);
    });

    return dedupeCandidates(candidates);
  }

  async function collectVimeoCandidates(candidates) {
    const id = /\/video\/(\d+)/.exec(location.pathname)?.[1];
    if (!id) return;

    const response = await fetch(`https://player.vimeo.com/video/${id}/config`, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) return;

    const config = await response.json();
    const progressive = config?.request?.files?.progressive || [];
    progressive.forEach((file) => {
      const quality = Number.parseInt(file.quality, 10) || 0;
      addCandidate(candidates, file.url, `vimeo ${file.quality || ""}`, 180 + quality, true, file.quality);
    });

    const hls = config?.request?.files?.hls;
    const defaultCdn = hls?.default_cdn;
    if (defaultCdn && hls?.cdns?.[defaultCdn]?.url) {
      addCandidate(candidates, hls.cdns[defaultCdn].url, "vimeo hls", 150, true);
    }
    Object.values(hls?.cdns || {}).forEach((cdn) => {
      addCandidate(candidates, cdn?.url, "vimeo hls", 140, true);
    });
  }

  function addCandidate(candidates, rawUrl, source, weight, allowUnknown, quality = "") {
    const url = normalizeMediaUrl(rawUrl);
    if (!url || url.startsWith("blob:")) return;

    const isKnownMedia = MEDIA_URL_RE.test(url);
    if (!allowUnknown && !isKnownMedia) return;

    candidates.push({
      url,
      source,
      weight,
      quality,
      isHls: HLS_URL_RE.test(url),
      isDash: DASH_URL_RE.test(url),
      isKnownMedia
    });
  }

  function chooseDownloadCandidate(candidates) {
    return candidates
      .filter((candidate) => !candidate.isDash)
      .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0] || null;
  }

  function scoreCandidate(candidate) {
    let score = candidate.weight || 0;
    if (/\.(mp4|m4v|webm)(?:[?#]|$)/i.test(candidate.url)) score += 40;
    if (candidate.isHls) score += 12;
    if (/vimeo/i.test(candidate.source)) score += 28;
    if (/pluginfile\.php|draftfile\.php/i.test(candidate.url)) score += 25;
    return score;
  }

  function dedupeCandidates(candidates) {
    const byUrl = new Map();
    for (const candidate of candidates) {
      const current = byUrl.get(candidate.url);
      if (!current || scoreCandidate(candidate) > scoreCandidate(current)) {
        byUrl.set(candidate.url, candidate);
      }
    }
    return Array.from(byUrl.values());
  }

  function normalizeMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    try {
      const parsed = new URL(rawUrl, document.baseURI);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function updateDownloadUi(message) {
    if (message.status === "complete") {
      updateVideoDownloadProgress({ ...message, percent: 100 });
      showToast("Đã gửi tải", false, downloadToastAnchor);
      releaseVideoDownloadUi();
      return;
    }

    if (message.status === "error") {
      updateVideoDownloadProgress(message);
      showToast(message.label || "Lỗi tải", true, downloadToastAnchor);
      releaseVideoDownloadUi();
      return;
    }

    if (!videoDownloadUiPinned) pinVideoDownloadUi(downloadToastAnchor);
    updateVideoDownloadProgress(message);
    hideToast();
  }

  function buildFilename(url, quality = "") {
    const title = sanitizeFilePart(document.title || "ou-yeah-video");
    const qualityPart = quality ? ` ${sanitizeFilePart(quality)}` : "";
    const extension = HLS_URL_RE.test(url) ? ".ts" : extensionFromUrl(url) || ".mp4";
    return `${title}${qualityPart}${extension}`;
  }

  function extensionFromUrl(url) {
    try {
      const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
      if (!match) return "";
      const extension = `.${match[1].toLowerCase()}`;
      return extension === ".m3u8" || extension === ".mpd" ? "" : extension;
    } catch {
      return "";
    }
  }

  function sanitizeFilePart(value) {
    return String(value)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || "ou-yeah-video";
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (!isExtensionContextAvailable()) {
        resolve({});
        return;
      }

      try {
        chrome.storage.sync.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (result) => {
          try {
            if (chrome.runtime.lastError) {
              resolve({});
              return;
            }
          } catch {
            resolve({});
            return;
          }
          const currentSettings = result?.[STORAGE_KEY];
          const legacySettings = result?.[LEGACY_STORAGE_KEY];
          const storedSettings = currentSettings || legacySettings || {};

          if (!currentSettings && legacySettings) {
            try {
              chrome.storage.sync.set({ [STORAGE_KEY]: legacySettings }, () => {
                try {
                  void chrome.runtime.lastError;
                } catch {
                  // Migration is best-effort when an old context is being replaced.
                }
              });
            } catch {
              // The legacy settings remain readable if migration cannot be saved yet.
            }
          }

          resolve(storedSettings);
        });
      } catch {
        resolve({});
      }
    });
  }

  function saveSettingsSoon() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (!isExtensionContextAvailable()) return;

      try {
        chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => {
          try {
            void chrome.runtime.lastError;
          } catch {
            // Context cũ sau khi extension Reload: không còn gì cần lưu.
          }
        });
      } catch {
        // Storage chỉ để nhớ cấu hình giữa các lần học.
      }
    }, 160);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable()) {
        reject(new Error("Extension context invalidated."));
        return;
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function visibleArea(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function formatSpeed(value) {
    return `${Number(Number(value).toFixed(2)).toString()}x`;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    if (hours) return `${hours}:${pad(minutes)}:${pad(secs)}`;
    return `${minutes}:${pad(secs)}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readableError(error) {
    if (error instanceof Error) return error.message;
    return String(error || "Đã có lỗi xảy ra.");
  }

  function isExtensionContextAvailable() {
    try {
      return Boolean(chrome?.runtime?.id && chrome.runtime.getURL(""));
    } catch {
      return false;
    }
  }

  function handleExtensionError(error) {
    if (/extension context invalidated/i.test(readableError(error))) return;
    console.error(`${APP}:`, error);
  }

  function toolLogo() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m.527,1.839L1.846.52C2.414-.048,3.293-.164,3.989.238l3.832,2.211c.733.423,1.185,1.205,1.185,2.051v3.086l4.726,4.726c1.115-.525,2.482-.339,3.404.58l5.889,5.872c1.111,1.108,1.325,2.916.329,4.129-1.145,1.395-3.212,1.472-4.458.229l-6.01-5.993c-.926-.923-1.109-2.295-.574-3.409L7.592,9h-3.086c-.846,0-1.629-.452-2.051-1.185L.245,3.982C-.156,3.286-.041,2.407.527,1.839Zm10.479,2.661v2.258l3.315,3.314c1.524-.212,3.104.283,4.227,1.403l2.208,2.202c1.887-1.319,3.164-3.478,3.249-5.881.028-.794-.065-1.569-.279-2.317-.131-.457-1.126-1.18-1.946-.36l-3.316,3.316c-.787.787-2.074.764-2.853-.036-.799-.779-.824-2.067-.037-2.854l3.316-3.316c.82-.82.097-1.815-.36-1.946-.748-.214-1.523-.308-2.317-.279-2.211.079-4.213,1.168-5.547,2.811.22.526.34,1.097.34,1.684Zm-.938,9.804-2.293-2.293L.859,18.906c-1.162,1.163-1.155,3.059-.007,4.231,1.172,1.149,3.068,1.156,4.231-.006l5.615-5.599c-.568-.974-.792-2.113-.63-3.228Z"/></svg>`;
  }

  function icon(name) {
    const icons = {
      chevronDown: assetIcon("angle-small-down.svg", "asset-icon-chevron"),
      rewind: assetIcon("angle-double-small-left.svg", "asset-icon-backward"),
      forward: assetIcon("angle-double-small-left.svg", "asset-icon-forward"),
      download: assetIcon("inbox-in.svg"),
      loader: assetIcon("loading.svg"),
      check: assetIcon("check-circle.svg"),
      warning: assetIcon("exclamation.svg")
    };
    return icons[name] || "";
  }

  function assetIcon(filename, className = "") {
    if (!isExtensionContextAvailable()) return "";

    let url;
    try {
      url = chrome.runtime.getURL(`src/icons/${filename}`);
    } catch {
      return "";
    }
    return `<span class="asset-icon ${className}" style="--asset-icon: url('${url}')" aria-hidden="true"></span>`;
  }

  function hudCss() {
    return `
      @keyframes hudSlideIn {
        from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.96); }
        to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }
      @keyframes menuItemReveal {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes toastPop {
        0% { opacity: 0; transform: translate(-50%, 8px) scale(0.92); }
        60% { transform: translate(-50%, -2px) scale(1.02); }
        100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
      }
      @keyframes pulseGlow {
        0%, 100% { box-shadow: 0 0 8px rgba(54,89,162,0.15); }
        50% { box-shadow: 0 0 16px rgba(54,89,162,0.35); }
      }
      @keyframes logoSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes videoDownloadSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes videoDownloadSweep {
        from { transform: translateX(-120%); }
        to { transform: translateX(260%); }
      }
      @keyframes shimmer {
        0% { background-position: -200% center; }
        100% { background-position: 200% center; }
      }
      :host {
        all: initial;
        color-scheme: dark;
        font-family: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
        --brand: ${BRAND};
        --brand-light: #4a7ae8;
        --brand-glow: rgba(54,89,162,0.4);
        --surface: rgba(15,17,26,0.82);
        --surface-hover: rgba(25,28,42,0.9);
        --surface-elevated: rgba(22,25,40,0.92);
        --border: rgba(255,255,255,0.06);
        --border-accent: rgba(74,122,232,0.25);
        --text-primary: rgba(255,255,255,0.95);
        --text-secondary: rgba(255,255,255,0.55);
        --text-muted: rgba(255,255,255,0.35);
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
      }
      * { box-sizing: border-box; font-family: inherit; letter-spacing: -0.01em; }

      /* ─── Main HUD Bar ─── */
      .hud {
        position: fixed;
        left: var(--hud-left, 50%);
        top: var(--hud-top, calc(100vh - 68px));
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: min(var(--hud-max-width, calc(100vw - 24px)), calc(100vw - 24px));
        padding: 5px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text-primary);
        box-shadow:
          0 8px 32px rgba(0,0,0,0.4),
          0 2px 8px rgba(0,0,0,0.3),
          inset 0 1px 0 rgba(255,255,255,0.04);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        transform: translateX(-50%) translateY(10px);
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 220ms cubic-bezier(0.16,1,0.3,1),
          transform 220ms cubic-bezier(0.16,1,0.3,1),
          left 150ms cubic-bezier(0.16,1,0.3,1),
          top 150ms cubic-bezier(0.16,1,0.3,1),
          box-shadow 300ms ease;
      }
      :host(.is-visible) .hud,
      :host(.menu-open) .hud {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(-50%) translateY(0);
      }
      .hud:hover {
        opacity: 1;
        border-color: var(--border-accent);
        box-shadow:
          0 8px 32px rgba(0,0,0,0.5),
          0 2px 8px rgba(0,0,0,0.3),
          0 0 20px var(--brand-glow),
          inset 0 1px 0 rgba(255,255,255,0.06);
      }
      :host(.is-visible) .hud:focus-within { opacity: 1; }

      /* ─── Logo ─── */
      .hud-logo {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        background: linear-gradient(135deg, var(--brand) 0%, var(--brand-light) 100%);
        color: #fff;
        flex-shrink: 0;
        transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 300ms ease;
      }
      .hud-logo:hover {
        transform: scale(1.1);
        box-shadow: 0 0 12px var(--brand-glow);
      }
      .hud-logo:hover svg {
        animation: logoSpin 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      }
      .hud-logo svg { width: 16px; height: 16px; transition: transform 200ms ease; }

      /* ─── Divider ─── */
      .hud-divider {
        width: 1px;
        height: 20px;
        background: linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent);
        flex-shrink: 0;
      }

      /* ─── Buttons ─── */
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 32px;
        min-width: 44px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: rgba(255,255,255,0.04);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
        user-select: none;
        position: relative;
        overflow: hidden;
        transition:
          background 180ms ease,
          transform 120ms cubic-bezier(0.34,1.56,0.64,1),
          border-color 180ms ease,
          box-shadow 180ms ease,
          color 180ms ease;
      }
      button::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 60%);
        opacity: 0;
        transition: opacity 180ms ease;
        pointer-events: none;
      }
      button:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.12);
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      button:hover::before { opacity: 1; }
      button:active {
        transform: scale(0.94);
        background: rgba(255,255,255,0.06);
      }
      button:focus-visible {
        outline: 2px solid var(--brand-light);
        outline-offset: 2px;
      }

      /* ─── Speed wrap & menu ─── */
      .hud-speed-wrap { position: relative; }
      .speed {
        min-width: 64px;
        border: 1px solid transparent;
        background: linear-gradient(135deg, var(--brand) 0%, var(--brand-light) 100%);
        color: #fff;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        box-shadow: 0 2px 10px rgba(54,89,162,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
      }
      .speed::before {
        background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%);
        opacity: 1;
      }
      .speed .asset-icon-chevron {
        width: 13px;
        height: 13px;
        transition: transform 240ms cubic-bezier(0.34,1.56,0.64,1);
      }
      :host(.menu-open) .speed .asset-icon-chevron { transform: rotate(180deg); }
      .speed:hover {
        background: linear-gradient(135deg, #2f4d8d 0%, #3b6bd4 100%);
        box-shadow: 0 4px 16px rgba(54,89,162,0.5), inset 0 1px 0 rgba(255,255,255,0.15);
        border-color: transparent;
        color: #fff;
      }
      :host(.menu-open) .speed {
        box-shadow: 0 4px 20px rgba(54,89,162,0.5), inset 0 1px 0 rgba(255,255,255,0.15);
      }

      /* ─── Speed Menu ─── */
      .hud-menu {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 10px);
        display: grid;
        grid-template-columns: repeat(2, minmax(56px, 1fr));
        gap: 3px;
        min-width: 136px;
        padding: 6px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-elevated);
        box-shadow:
          0 12px 40px rgba(0,0,0,0.5),
          0 4px 12px rgba(0,0,0,0.3),
          inset 0 1px 0 rgba(255,255,255,0.04);
        backdrop-filter: blur(20px) saturate(170%);
        -webkit-backdrop-filter: blur(20px) saturate(170%);
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, 8px) scale(0.95);
        transform-origin: bottom center;
        transition:
          opacity 200ms cubic-bezier(0.16,1,0.3,1),
          transform 200ms cubic-bezier(0.16,1,0.3,1);
      }
      :host(.menu-open) .hud-menu {
        opacity: 1;
        pointer-events: auto;
        transform: translate(-50%, 0) scale(1);
      }
      :host(.menu-open) .hud-menu button {
        animation: menuItemReveal 200ms cubic-bezier(0.16,1,0.3,1) backwards;
      }
      :host(.menu-open) .hud-menu button:nth-child(1) { animation-delay: 20ms; }
      :host(.menu-open) .hud-menu button:nth-child(2) { animation-delay: 40ms; }
      :host(.menu-open) .hud-menu button:nth-child(3) { animation-delay: 60ms; }
      :host(.menu-open) .hud-menu button:nth-child(4) { animation-delay: 80ms; }
      :host(.menu-open) .hud-menu button:nth-child(5) { animation-delay: 100ms; }
      :host(.menu-open) .hud-menu button:nth-child(6) { animation-delay: 120ms; }
      :host(.menu-open) .hud-menu button:nth-child(7) { animation-delay: 140ms; }
      :host(.menu-open) .hud-menu button:nth-child(8) { animation-delay: 160ms; }
      :host(.menu-open) .hud-menu button:nth-child(9) { animation-delay: 180ms; }
      :host(.menu-open) .hud-menu button:nth-child(10) { animation-delay: 200ms; }
      .hud-menu button {
        min-width: 0;
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        transition: background 150ms ease, color 150ms ease, transform 120ms ease;
      }
      .hud-menu button::before { display: none; }
      .hud-menu button:hover {
        background: rgba(74,122,232,0.12);
        color: var(--brand-light);
        box-shadow: none;
      }
      .hud-menu button.is-selected {
        background: linear-gradient(135deg, rgba(54,89,162,0.2), rgba(74,122,232,0.15));
        color: var(--brand-light);
        font-weight: 700;
        box-shadow: inset 0 0 0 1px rgba(74,122,232,0.2);
      }

      /* ─── Download ─── */
      .icon-only {
        min-width: 32px;
        width: 32px;
        height: 32px;
        padding: 0;
      }
      .icon-only:hover {
        color: var(--brand-light);
        background: rgba(74,122,232,0.1);
        border-color: var(--border-accent);
      }
      .icon-only > [data-role="download-icon"] {
        display: grid;
        place-items: center;
      }
      .icon-only[data-busy="true"] .asset-icon {
        animation: videoDownloadSpin 980ms linear infinite;
        will-change: transform;
      }
      .icon-only:disabled {
        cursor: progress;
        opacity: 1;
      }
      .hud-download-progress {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 0;
        min-width: 0;
        height: 32px;
        padding: 0;
        overflow: hidden;
        opacity: 0;
        transform: scaleX(0.82);
        transition: width 280ms cubic-bezier(0.16,1,0.3,1), min-width 280ms cubic-bezier(0.16,1,0.3,1), padding 280ms ease, opacity 180ms ease, transform 280ms cubic-bezier(0.16,1,0.3,1);
      }
      .hud:not([data-download-status="idle"]) .hud-download-progress {
        width: 68px;
        min-width: 68px;
        padding: 0 6px;
        opacity: 1;
        transform: scaleX(1);
      }
      .hud-download-status {
        color: var(--brand-light);
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        transform: translateY(-4px);
        transition: color 220ms ease;
      }
      .hud-download-track {
        position: absolute;
        right: 6px;
        bottom: 5px;
        left: 6px;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.28);
      }
      .hud-download-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--video-download-progress, 0%);
        overflow: hidden;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--brand), #5b8df2);
        box-shadow: 0 0 8px rgba(74,122,232,0.42);
        transition: width 420ms cubic-bezier(0.16,1,0.3,1), background 220ms ease, box-shadow 220ms ease;
        will-change: width;
      }
      .hud-download-fill::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 38%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.58), transparent);
        transform: translateX(-120%);
      }
      .hud[data-download-status="preparing"] .hud-download-fill::after,
      .hud[data-download-status="downloading"] .hud-download-fill::after,
      .hud[data-download-status="building"] .hud-download-fill::after {
        animation: videoDownloadSweep 1.35s ease-in-out infinite;
      }
      .hud[data-download-status="complete"] .hud-download-status { color: #4ade80; }
      .hud[data-download-status="complete"] .hud-download-fill {
        background: linear-gradient(90deg, #22c55e, #4ade80);
        box-shadow: 0 0 8px rgba(74,222,128,0.38);
      }
      .hud[data-download-status="error"] .hud-download-status { color: #f87171; }
      .hud[data-download-status="error"] .hud-download-fill {
        background: linear-gradient(90deg, #ef4444, #f87171);
        box-shadow: 0 0 8px rgba(248,113,113,0.34);
      }

      /* ─── Time ─── */
      .hud-time {
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        padding: 0 6px;
        letter-spacing: 0.03em;
      }

      /* ─── Toast ─── */
      .toast {
        position: absolute;
        left: var(--toast-left, 50%);
        bottom: calc(100% + 10px);
        padding: 6px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface-elevated);
        color: var(--text-primary);
        box-shadow:
          0 8px 24px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.04);
        backdrop-filter: blur(16px) saturate(160%);
        -webkit-backdrop-filter: blur(16px) saturate(160%);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
        opacity: 0;
        transform: translate(-50%, 8px) scale(0.92);
        pointer-events: none;
        transition: opacity 200ms ease, transform 200ms cubic-bezier(0.16,1,0.3,1);
      }
      .toast.is-visible {
        opacity: 1;
        transform: translate(-50%, 0) scale(1);
        animation: toastPop 280ms cubic-bezier(0.34,1.56,0.64,1);
      }
      .toast.is-error {
        border-color: rgba(239,68,68,0.3);
        background: rgba(239,68,68,0.12);
        color: #f87171;
        box-shadow:
          0 8px 24px rgba(0,0,0,0.4),
          0 0 12px rgba(239,68,68,0.15),
          inset 0 1px 0 rgba(239,68,68,0.08);
      }

      /* ─── SVG ─── */
      svg {
        display: block;
        width: 15px;
        height: 15px;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        fill: none;
      }
      .asset-icon {
        display: block;
        width: 15px;
        height: 15px;
        flex: 0 0 auto;
        background: currentColor;
        -webkit-mask: var(--asset-icon) center / contain no-repeat;
        mask: var(--asset-icon) center / contain no-repeat;
        transform-origin: center;
      }
      .asset-icon-forward { transform: rotate(180deg); }
      .icon-only .asset-icon { width: 17px; height: 17px; }
      .hud-logo svg { stroke: none; fill: currentColor; }

      /* ─── Fullscreen tweaks ─── */
      :host(.is-fullscreen) .hud {
        background: rgba(10,12,20,0.88);
        box-shadow:
          0 8px 40px rgba(0,0,0,0.6),
          0 0 24px var(--brand-glow),
          inset 0 1px 0 rgba(255,255,255,0.05);
      }
    `;
  }
})();
