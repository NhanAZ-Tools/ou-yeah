(() => {
  "use strict";

  const APP = "elolms-video-tools";
  const HUD_ID = "elolms-video-tools-hud";
  const STORAGE_KEY = "elolmsVideoToolsSettings";
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

  if (!IS_ELOLMS && !IS_VIMEO) return;
  if (window.__elolmsVideoToolsLoaded) return;
  window.__elolmsVideoToolsLoaded = true;

  let settings = { ...DEFAULT_SETTINGS };
  let videos = [];
  let activeVideo = null;
  let hud = null;
  let scanTimer = 0;
  let saveTimer = 0;
  let hudVisibleTimer = 0;
  let hudPositionFrame = 0;
  let toastTimer = 0;
  let lastPointerInVideoAt = 0;
  let applyingRate = false;
  let activeDownloadJobId = "";
  const registeredVideos = new WeakSet();

  init();

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
      if (message?.type === "elolms-toggle-panel" || message?.type === "elolms-pulse-hud") {
        scanVideos();
        showHudFor(2200);
      }

      if (message?.type === "elolms-download-progress") {
        if (activeDownloadJobId && message.jobId !== activeDownloadJobId) return;
        updateDownloadUi(message);
      }
    });

    document.addEventListener("elolms-video-tools-pulse", () => {
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
        hud.host.hidden = true;
        hud.host.classList.remove("is-visible", "menu-open");
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
      <div class="hud" role="group" aria-label="Điều khiển nhanh video">
        <span class="hud-logo">${toolLogo()}</span>
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
        <button class="icon-only" type="button" data-hud-action="download" title="Tải video" aria-label="Tải video">${icon("download")}</button>
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
      setSpeed(Number(speedOption.dataset.hudSpeed));
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
    if (action === "backward") seekBy(-SKIP_SECONDS);
    if (action === "forward") seekBy(SKIP_SECONDS);
    if (action === "speed-menu") toggleSpeedMenu();
    if (action === "download") downloadVideo();
  }

  function setSpeed(value) {
    settings.speed = clamp(value, 0.25, 4);
    saveSettingsSoon();
    applySpeedToVideos();
    updateSpeedUi();
    showToast(formatSpeed(settings.speed));
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

  function seekBy(delta) {
    const video = chooseVideo();
    if (!video) {
      showToast("Chưa thấy video", true);
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = clamp((video.currentTime || 0) + delta, 0, duration);
    activeVideo = video;
    updateTimeUi();
    showToast(`${delta > 0 ? "+" : ""}${delta}s`);
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
      showHudFor(1800);
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

    const controlsRect = getVisiblePlayerControlsRect(video);
    const controlsTop = controlsRect
      ? clamp(controlsRect.top, visibleTop, visibleBottom)
      : null;
    const desiredBottom = (controlsTop ?? visibleBottom) - HUD_VIDEO_GAP;
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

    hud.host.classList.toggle("is-fullscreen", Boolean(fullscreenElement));
    scheduleHudPosition();
    if (fullscreenElement) showHudFor(2200);
  }

  function syncHudWithPlayerControls() {
    if (!hud?.host || hud.host.hidden || hud.host.classList.contains("menu-open")) return;

    const nativeVisibility = getPlayerControlsVisibility();
    if (nativeVisibility === true) {
      positionHud();
      showHudFor(0);
      return;
    }

    if (nativeVisibility === false || Date.now() - lastPointerInVideoAt > 1800) {
      hideHud();
    }
  }

  function getPlayerControlsVisibility() {
    const controls = getVisiblePlayerControlsRect(chooseVideo());
    return controls ? true : undefined;
  }

  function getVisiblePlayerControlsRect(video) {
    const videoRect = video?.getBoundingClientRect();
    const candidates = PLAYER_CONTROL_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const controls = candidates
      .filter((element) => isLikelyPlayerControls(element, videoRect) && isElementVisible(element))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const aDistance = videoRect ? Math.abs(videoRect.bottom - aRect.bottom) : 0;
        const bDistance = videoRect ? Math.abs(videoRect.bottom - bRect.bottom) : 0;
        return aDistance - bDistance || bRect.width - aRect.width;
      })[0];

    return controls?.getBoundingClientRect() || null;
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
    if (marker.includes("elolms-video-tools")) return false;
    if (/\b(hidden|inactive|fade-out|faded|transparent)\b/.test(marker)) return false;

    return element.querySelector("button, [role='button'], input, progress, [aria-label]") != null;
  }

  function isElementVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const opacity = Number.parseFloat(style.opacity || "1");

    if (element.closest("[aria-hidden='true'], [hidden]")) return false;
    if (style.display === "none" || style.visibility === "hidden" || opacity < 0.05) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;

    return true;
  }

  function showHudFor(duration = 1700) {
    if (!hud?.host || hud.host.hidden) return;

    positionHud();
    hud.host.classList.add("is-visible");
    window.clearTimeout(hudVisibleTimer);

    if (duration > 0 && !hud.host.classList.contains("menu-open")) {
      hudVisibleTimer = window.setTimeout(hideHud, duration);
    }
  }

  function scheduleHudHide(delay = 900) {
    if (!hud?.host || hud.host.classList.contains("menu-open")) return;
    window.clearTimeout(hudVisibleTimer);
    hudVisibleTimer = window.setTimeout(hideHud, delay);
  }

  function hideHud() {
    if (!hud?.host || hud.host.matches(":hover") || hud.host.classList.contains("menu-open")) return;
    hud.host.classList.remove("is-visible");
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

  function showToast(text, isError = false) {
    if (!hud) return;

    showHudFor(1300);
    hud.toast.textContent = text;
    hud.toast.classList.toggle("is-error", Boolean(isError));
    hud.toast.classList.add("is-visible");

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      hud.toast.classList.remove("is-visible");
    }, 900);
  }

  async function downloadVideo() {
    const video = chooseVideo();
    if (!video) {
      showToast("Chưa thấy video", true);
      return;
    }

    showToast("Đang tìm link...");

    try {
      const candidates = await collectCandidates(video);
      const chosen = chooseDownloadCandidate(candidates);

      if (!chosen) {
        const message = candidates.some((candidate) => candidate.isDash)
          ? "Chưa hỗ trợ DASH"
          : "Chưa bắt được link";
        showToast(message, true);
        return;
      }

      const response = await sendRuntimeMessage({
        type: "elolms-download-media",
        url: chosen.url,
        filename: buildFilename(chosen.url, chosen.quality),
        pageTitle: document.title
      });

      if (!response?.ok) {
        showToast(response?.error || "Không tải được", true);
        return;
      }

      if (response.mode === "hls") {
        activeDownloadJobId = response.jobId;
        showToast("Đang gom HLS...");
      } else {
        showToast("Đã gửi tải");
      }
    } catch (error) {
      showToast(readableError(error), true);
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

    const background = await sendRuntimeMessage({ type: "elolms-get-media-candidates" }).catch(() => null);
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
      activeDownloadJobId = "";
      showToast("Đã gửi tải");
      return;
    }

    if (message.status === "error") {
      activeDownloadJobId = "";
      showToast(message.label || "Lỗi tải", true);
      return;
    }

    showToast(message.percent ? `${message.percent}%` : message.label || "Đang tải...");
  }

  function buildFilename(url, quality = "") {
    const title = sanitizeFilePart(document.title || "elolms-video");
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
      .slice(0, 140) || "elolms-video";
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(STORAGE_KEY, (result) => resolve(result?.[STORAGE_KEY] || {}));
      } catch {
        resolve({});
      }
    });
  }

  function saveSettingsSoon() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        chrome.storage.sync.set({ [STORAGE_KEY]: settings });
      } catch {
        // Storage chỉ để nhớ cấu hình giữa các lần học.
      }
    }, 160);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
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

  function toolLogo() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m.527,1.839L1.846.52C2.414-.048,3.293-.164,3.989.238l3.832,2.211c.733.423,1.185,1.205,1.185,2.051v3.086l4.726,4.726c1.115-.525,2.482-.339,3.404.58l5.889,5.872c1.111,1.108,1.325,2.916.329,4.129-1.145,1.395-3.212,1.472-4.458.229l-6.01-5.993c-.926-.923-1.109-2.295-.574-3.409L7.592,9h-3.086c-.846,0-1.629-.452-2.051-1.185L.245,3.982C-.156,3.286-.041,2.407.527,1.839Zm10.479,2.661v2.258l3.315,3.314c1.524-.212,3.104.283,4.227,1.403l2.208,2.202c1.887-1.319,3.164-3.478,3.249-5.881.028-.794-.065-1.569-.279-2.317-.131-.457-1.126-1.18-1.946-.36l-3.316,3.316c-.787.787-2.074.764-2.853-.036-.799-.779-.824-2.067-.037-2.854l3.316-3.316c.82-.82.097-1.815-.36-1.946-.748-.214-1.523-.308-2.317-.279-2.211.079-4.213,1.168-5.547,2.811.22.526.34,1.097.34,1.684Zm-.938,9.804-2.293-2.293L.859,18.906c-1.162,1.163-1.155,3.059-.007,4.231,1.172,1.149,3.068,1.156,4.231-.006l5.615-5.599c-.568-.974-.792-2.113-.63-3.228Z"/></svg>`;
  }

  function icon(name) {
    const icons = {
      chevronDown: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
      rewind: '<svg viewBox="0 0 24 24"><path d="M11 19 2 12l9-7v14Z"/><path d="M22 19l-9-7 9-7v14Z"/></svg>',
      forward: '<svg viewBox="0 0 24 24"><path d="m13 19 9-7-9-7v14Z"/><path d="m2 19 9-7-9-7v14Z"/></svg>',
      download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>'
    };
    return icons[name] || "";
  }

  function hudCss() {
    return `
      :host { all: initial; color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
      * { box-sizing: border-box; font-family: inherit; letter-spacing: 0; }
      .hud { position: fixed; left: var(--hud-left, 50%); top: var(--hud-top, calc(100vh - 68px)); z-index: 2147483647; display: inline-flex; align-items: center; gap: 6px; max-width: min(var(--hud-max-width, calc(100vw - 24px)), calc(100vw - 24px)); padding: 7px; border: 1px solid rgba(27,39,56,0.14); border-radius: 10px; background: rgba(255,255,255,0.92); color: #172033; box-shadow: none; backdrop-filter: blur(16px) saturate(160%); transform: translateX(-50%) translateY(8px); opacity: 0; pointer-events: none; transition: opacity 150ms ease, transform 150ms ease, left 120ms ease, top 120ms ease; }
      :host(.is-visible) .hud,
      :host(.menu-open) .hud { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
      .hud:hover, .hud:focus-within { opacity: 1; }
      .hud-logo { display: inline-grid; place-items: center; width: 28px; height: 28px; color: ${BRAND}; }
      .hud-logo svg { width: 18px; height: 18px; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 34px; min-width: 48px; padding: 0 10px; border: 1px solid rgba(27,39,56,0.1); border-radius: 8px; background: rgba(245,247,251,0.95); color: #172033; font-size: 13px; font-weight: 800; cursor: pointer; user-select: none; transition: background 120ms ease, transform 120ms ease, border-color 120ms ease; }
      button:hover { background: rgba(54,89,162,0.08); border-color: rgba(54,89,162,0.22); }
      button:active { transform: scale(0.96); }
      button:focus-visible { outline: 2px solid rgba(54,89,162,0.35); outline-offset: 2px; }
      .hud-speed-wrap { position: relative; }
      .speed { min-width: 66px; border-color: rgba(54,89,162,0.24); background: ${BRAND}; color: #fff; }
      .speed svg { width: 14px; height: 14px; }
      .speed:hover { background: #2f4d8d; color: #fff; }
      .hud-menu { position: absolute; left: 50%; bottom: calc(100% + 8px); display: grid; grid-template-columns: repeat(2, minmax(58px, 1fr)); gap: 4px; min-width: 132px; padding: 6px; border: 1px solid rgba(27,39,56,0.14); border-radius: 10px; background: rgba(255,255,255,0.96); box-shadow: none; backdrop-filter: blur(14px) saturate(150%); opacity: 0; pointer-events: none; transform: translate(-50%, 6px) scale(0.98); transition: opacity 130ms ease, transform 130ms ease; }
      :host(.menu-open) .hud-menu { opacity: 1; pointer-events: auto; transform: translate(-50%, 0) scale(1); }
      .hud-menu button { min-width: 0; height: 32px; border: 0; border-radius: 7px; background: transparent; color: #172033; font-size: 12px; }
      .hud-menu button:hover,
      .hud-menu button.is-selected { background: rgba(54,89,162,0.1); color: ${BRAND}; }
      .icon-only { min-width: 34px; width: 34px; padding: 0; }
      .hud-time { color: #516071; font-size: 12px; font-weight: 750; white-space: nowrap; padding: 0 5px; }
      .toast { position: absolute; left: 50%; bottom: calc(100% + 8px); padding: 6px 10px; border: 1px solid rgba(27,39,56,0.14); border-radius: 8px; background: rgba(255,255,255,0.96); color: #172033; box-shadow: none; font-size: 12px; font-weight: 800; white-space: nowrap; opacity: 0; transform: translate(-50%, 6px); pointer-events: none; transition: opacity 140ms ease, transform 140ms ease; }
      .toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      .toast.is-error { border-color: rgba(217,48,37,0.24); background: #fff2f0; color: #d93025; }
      svg { display: block; width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
      .hud-logo svg { stroke: none; fill: currentColor; }
    `;
  }
})();
