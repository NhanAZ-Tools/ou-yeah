(() => {
  "use strict";

  const APP = "ou-yeah";
  const HUD_ID = "ou-yeah-video-hud";
  const BOOK_DOWNLOAD_ID = "ou-yeah-book-pdf-download";
  const STORAGE_KEY = "ouYeahSettings";
  const LEGACY_STORAGE_KEY = "elolmsVideoToolsSettings";
  const LEGACY_HUD_ID = "elolms-video-tools-hud";
  const LEGACY_BOOK_DOWNLOAD_ID = "elolms-book-pdf-download";
  const BRAND = "#5269C7";
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
  const IS_ELOLMS_NOTIFICATIONS = IS_ELOLMS
    && location.pathname.toLowerCase() === "/message/output/popup/notifications.php";
  const IS_ELOLMS_COURSE_VIEW = IS_ELOLMS
    && location.pathname.toLowerCase() === "/course/view.php";
  const NOTIFICATION_POPOVER_STYLE_ID = "ou-yeah-notification-popover-theme";
  const ELOLMS_FONT_STYLE_ID = "ou-yeah-elolms-font-theme";
  const COURSE_MAP_STYLE_ID = "ou-yeah-course-map-theme";
  const COURSE_MAP_TOOLS_ID = "ou-yeah-course-map-tools";
  const NOTIFICATION_UNREAD_ICON_FILE = "envelope-dot.svg";
  const NOTIFICATION_TYPE_ICON_FILES = {
    assignment: "book-alt.svg",
    meeting: "daily-calendar.svg",
    discussion: "bubble-discussion.svg",
    announcement: "bell-notification-social-media.svg",
    system: "bell-notification-social-media.svg"
  };

  if (!IS_ELOLMS && !IS_VIMEO && !IS_THUQUAN_BOOK) return;
  let notificationPopoverTimer = 0;
  let notificationPopoverObserver = null;
  let courseMapTimer = 0;
  let courseMapScrollTimer = 0;
  let courseMapBootstrapTimer = 0;
  let courseMapBootstrapAttempts = 0;
  let courseMapDefaultCollapseApplied = false;
  let courseMapDefaultCollapseInProgress = false;
  let courseMapUserToggledSections = false;
  let courseMapObserver = null;
  if (IS_ELOLMS) initElolmsFontTheme();
  if (IS_ELOLMS && window.top === window.self) initNotificationPopoverPolish();
  if (IS_ELOLMS_COURSE_VIEW && window.top === window.self) initCourseMapPolish();
  if (IS_ELOLMS_NOTIFICATIONS) return;
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

  function initElolmsFontTheme() {
    const applyBodyClass = () => document.body?.classList.add("ou-yeah-elolms-font");
    injectElolmsFontTheme();
    applyBodyClass();

    if (!document.body) {
      document.addEventListener("DOMContentLoaded", applyBodyClass, { once: true });
    }
  }

  function injectElolmsFontTheme() {
    if (document.getElementById(ELOLMS_FONT_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = ELOLMS_FONT_STYLE_ID;
    style.textContent = elolmsFontCss();
    document.documentElement.appendChild(style);
  }

  function elolmsFontCss() {
    return `
      ${spaceGroteskFontFaces()}
      body.ou-yeah-elolms-font {
        --ou-global-font: "Space Grotesk", "Segoe UI", Arial, sans-serif;
        font-family: var(--ou-global-font) !important;
      }

      body.ou-yeah-elolms-font :where(
        h1, h2, h3, h4, h5, h6,
        p, a, span, div, section, article, main, aside, nav, header, footer,
        button, input, textarea, select, option, optgroup, label, legend,
        ul, ol, li, dl, dt, dd,
        table, thead, tbody, tfoot, tr, th, td, caption,
        small, strong, em, b, i, u, mark, blockquote,
        summary, details
      ):not(.fa):not(.fas):not(.far):not(.fab):not(.fa-solid):not(.fa-regular):not(.fa-brands):not(.icon):not(.material-icons):not(.material-symbols-outlined):not([class^="fa-"]):not([class*=" fa-"]):not([class^="icon-"]):not([class*=" icon-"]) {
        font-family: var(--ou-global-font) !important;
      }

      body.ou-yeah-elolms-font :where(button, input, textarea, select, option, optgroup) {
        font-family: var(--ou-global-font) !important;
      }
    `;
  }

  function initNotificationPopoverPolish() {
    injectNotificationPopoverTheme();
    refreshNotificationPopover();

    if (notificationPopoverObserver) return;
    notificationPopoverObserver = new MutationObserver(scheduleNotificationPopoverRefresh);
    notificationPopoverObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initCourseMapPolish() {
    injectCourseMapTheme();
    startCourseMapBootstrap();

    if (!courseMapObserver) {
      courseMapObserver = new MutationObserver(scheduleCourseMapRefresh);
      courseMapObserver.observe(document.documentElement, {
        attributeFilter: ["aria-expanded", "class", "hidden", "style"],
        attributes: true,
        childList: true,
        subtree: true
      });
    }

    window.addEventListener("scroll", scheduleCourseMapScroll, { passive: true });
    window.addEventListener("resize", scheduleCourseMapScroll, { passive: true });
    window.addEventListener("pageshow", startCourseMapBootstrap, { passive: true });
    document.addEventListener("readystatechange", startCourseMapBootstrap);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) startCourseMapBootstrap();
    });
    document.addEventListener("click", handleCourseSectionToggleEvent, true);
    document.addEventListener("transitionend", handleCourseSectionToggleEvent, true);
  }

  function startCourseMapBootstrap() {
    courseMapBootstrapAttempts = 0;
    runCourseMapBootstrap();
  }

  function runCourseMapBootstrap() {
    window.clearTimeout(courseMapBootstrapTimer);
    refreshCourseMap();

    courseMapBootstrapAttempts += 1;
    if (courseMapBootstrapAttempts >= 18) return;

    const delay = courseMapBootstrapAttempts < 8 ? 180 : 650;
    courseMapBootstrapTimer = window.setTimeout(runCourseMapBootstrap, delay);
  }

  function scheduleCourseMapRefresh() {
    window.clearTimeout(courseMapTimer);
    courseMapTimer = window.setTimeout(refreshCourseMap, 120);
  }

  function scheduleCourseMapScroll() {
    window.clearTimeout(courseMapScrollTimer);
    courseMapScrollTimer = window.setTimeout(updateCourseMapCurrentSection, 80);
  }

  function handleCourseSectionToggleEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const sectionToggle = target.closest(".course-content .course-section [data-toggle='collapse'], .course-content .course-section [data-bs-toggle='collapse']");
    const globalToggle = target.closest("#collapsesections, .section-collapsemenu, [data-toggle='toggleall'], [data-bs-toggle='toggleall']");
    if (!sectionToggle && !globalToggle) return;

    if (!courseMapDefaultCollapseInProgress && event.isTrusted) {
      courseMapUserToggledSections = true;
    }

    scheduleCourseMapRefresh();
    window.setTimeout(refreshCourseMap, 80);
    window.setTimeout(refreshCourseMap, 260);
    window.setTimeout(refreshCourseMap, 620);
    window.setTimeout(refreshCourseMap, 1100);
  }

  function refreshCourseMap() {
    if (!document.body) return;

    document.body.classList.add("ou-yeah-course-view");
    applyDefaultCollapsedCourseSections();
    annotateOpenCourseSections();

    const drawer = document.getElementById("theme_boost-drawers-courseindex");
    const courseIndex = document.getElementById("courseindex");
    if (!drawer || !courseIndex) return;

    drawer.classList.add("ou-yeah-course-map-drawer");
    courseIndex.classList.add("ou-yeah-course-map");
    ensureCourseMapTools(drawer, courseIndex);
    annotateCourseMap(courseIndex);
    updateCourseMapStats(drawer, courseIndex);
    updateCourseMapCurrentSection();
  }

  function ensureCourseMapTools(drawer, courseIndex) {
    let tools = drawer.querySelector(`#${COURSE_MAP_TOOLS_ID}`);
    if (tools) return tools;

    tools = document.createElement("section");
    tools.id = COURSE_MAP_TOOLS_ID;
    tools.innerHTML = `
      <div class="ou-course-map-heading">
        <div>
          <span class="ou-course-map-kicker">OU Yeah!</span>
          <h2>Course Map</h2>
        </div>
        <button type="button" data-course-map-action="current">Đang xem</button>
      </div>
      <label class="ou-course-map-search">
        <span>Tìm nhanh trong mục lục</span>
        <input type="search" placeholder="Chương, video, slide, bài tập..." autocomplete="off" spellcheck="false">
      </label>
      <div class="ou-course-map-stats" aria-live="polite">
        <span data-course-map-stat="sections">0 mục</span>
        <span data-course-map-stat="modules">0 tài nguyên</span>
        <span data-course-map-stat="progress">Theo dõi tiến độ</span>
      </div>
    `;

    const input = tools.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.addEventListener("input", () => applyCourseMapFilter(courseIndex, input.value));
    }
    tools.querySelector("[data-course-map-action='current']")?.addEventListener("click", () => {
      const current = courseIndex.querySelector(".ou-yeah-current-section");
      current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center"
      });
    });

    courseIndex.parentElement?.insertBefore(tools, courseIndex);
    return tools;
  }

  function annotateCourseMap(courseIndex) {
    const sections = Array.from(courseIndex.querySelectorAll('[data-for="section"]'));
    sections.forEach((section, index) => {
      const titleItem = section.querySelector(':scope > [data-for="section_item"], :scope > .courseindex-section-title');
      const link = titleItem?.querySelector(".courseindex-link");
      const title = cleanCourseMapTitle(link?.textContent || titleItem?.textContent || section.textContent || "");
      const depth = Math.min(3, courseMapDepth(section, courseIndex));

      section.dataset.ouCourseMapSection = "true";
      section.dataset.ouCourseMapDepth = String(depth);
      section.dataset.ouCourseMapText = normalizeCourseMapText(title);
      titleItem?.setAttribute("data-ou-course-map-title", "");
      titleItem?.setAttribute("data-ou-course-map-number", String(index + 1).padStart(2, "0"));
      if (link) link.setAttribute("title", title);
    });

    courseIndex.querySelectorAll('[data-for="cm"]').forEach((item) => {
      const link = item.querySelector(".courseindex-link");
      const title = cleanCourseMapTitle(link?.textContent || item.textContent || "");
      const kind = classifyCourseMapModule(title, link?.getAttribute("href") || "");
      item.dataset.ouCourseMapKind = kind;
      item.dataset.ouCourseMapKindLabel = courseMapKindLabel(kind);
      item.dataset.ouCourseMapText = normalizeCourseMapText(title);
      if (link) link.setAttribute("title", title);
    });
  }

  function courseMapDepth(section, courseIndex) {
    let depth = 0;
    let current = section.parentElement;
    while (current && current !== courseIndex) {
      if (current.classList.contains("courseindex-item-content")) depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function annotateOpenCourseSections() {
    document.querySelectorAll(".course-content .course-section").forEach((section) => {
      if (!(section instanceof HTMLElement)) return;
      const title = cleanCourseMapTitle(section.querySelector(":scope > .course-section-header .sectionname")?.textContent || "");
      if (!title) {
        section.classList.remove("ou-yeah-section-open");
        return;
      }
      section.classList.toggle("ou-yeah-section-open", isCourseSectionExpanded(section));
    });
  }

  function applyDefaultCollapsedCourseSections() {
    if (courseMapDefaultCollapseApplied || courseMapUserToggledSections) return;

    const toggles = getCourseSectionCollapseToggles();
    if (!toggles.length) return;

    const openToggles = toggles.filter((toggle) => isCourseSectionToggleOpen(toggle));
    const openContents = Array.from(document.querySelectorAll(".course-content .course-section > .content.collapse.show, .course-content .course-section > .course-section-content.collapse.show"))
      .filter((content) => content instanceof HTMLElement && content.closest("#section-0") == null);

    if (!openToggles.length && !openContents.length) {
      courseMapDefaultCollapseApplied = true;
      return;
    }

    courseMapDefaultCollapseApplied = true;
    courseMapDefaultCollapseInProgress = true;

    const globalToggle = document.querySelector("#collapsesections, .section-collapsemenu[data-toggle='toggleall'], .section-collapsemenu[data-bs-toggle='toggleall']");
    if (globalToggle instanceof HTMLElement && isCourseSectionToggleOpen(globalToggle)) {
      globalToggle.click();
    } else {
      openToggles.forEach((toggle) => {
        if (toggle instanceof HTMLElement) toggle.click();
      });
    }

    window.setTimeout(() => {
      courseMapDefaultCollapseInProgress = false;
      annotateOpenCourseSections();
    }, 900);
  }

  function getCourseSectionCollapseToggles() {
    return Array.from(document.querySelectorAll(".course-content .course-section > .course-section-header [data-toggle='collapse'], .course-content .course-section > .course-section-header [data-bs-toggle='collapse']"))
      .filter((toggle) => toggle instanceof HTMLElement && toggle.closest("#section-0") == null);
  }

  function isCourseSectionToggleOpen(toggle) {
    const target = collapseTargetForToggle(toggle);
    if (target) return isCollapseContentOpen(target);
    if (toggle.getAttribute("aria-expanded") === "true") return true;
    if (toggle.classList.contains("collapsed")) return false;
    return false;
  }

  function isCourseSectionExpanded(section) {
    const header = section.querySelector(":scope > .course-section-header");
    const collapse = section.querySelector(":scope > .content.collapse, :scope > .content .collapse, :scope > .course-section-content.collapse");
    if (collapse instanceof HTMLElement) return isCollapseContentOpen(collapse);

    const toggle = Array.from(header?.querySelectorAll("[aria-expanded]") || [])
      .find((element) => !element.classList.contains("section-collapsemenu"));
    if (toggle) return toggle.getAttribute("aria-expanded") === "true";

    const content = section.querySelector(":scope > .content, :scope > .section-content");
    if (!(content instanceof HTMLElement)) return false;
    if (content.hidden || content.style.display === "none") return false;
    return content.offsetParent !== null && Boolean(content.textContent?.trim());
  }

  function collapseTargetForToggle(toggle) {
    const selector = toggle.getAttribute("data-target")
      || toggle.getAttribute("data-bs-target")
      || toggle.getAttribute("href");
    if (!selector || !selector.startsWith("#")) return null;
    return document.getElementById(selector.slice(1));
  }

  function isCollapseContentOpen(collapse) {
    if (collapse.classList.contains("show")) return true;
    if (collapse.classList.contains("collapsing")) return collapse.getBoundingClientRect().height > 1;
    if (collapse.classList.contains("collapse")) return false;
    if (collapse.hidden || collapse.style.display === "none") return false;
    return collapse.getBoundingClientRect().height > 1;
  }

  function updateCourseMapStats(drawer, courseIndex) {
    const tools = drawer.querySelector(`#${COURSE_MAP_TOOLS_ID}`);
    if (!tools) return;

    const sectionCount = courseIndex.querySelectorAll('[data-ou-course-map-section="true"]').length;
    const moduleCount = courseIndex.querySelectorAll('[data-for="cm"]').length;
    const progress = /(?:completed|hoàn thành)\s*(\d+)%|(\d+)%/i.exec(drawer.textContent || "");

    const sectionStat = tools.querySelector('[data-course-map-stat="sections"]');
    const moduleStat = tools.querySelector('[data-course-map-stat="modules"]');
    const progressStat = tools.querySelector('[data-course-map-stat="progress"]');
    if (sectionStat) sectionStat.textContent = `${sectionCount} mục`;
    if (moduleStat) moduleStat.textContent = `${moduleCount} tài nguyên`;
    if (progressStat) progressStat.textContent = progress ? `${progress[1] || progress[2]}% hoàn tất` : "Course Map";
  }

  function applyCourseMapFilter(courseIndex, query) {
    const normalized = normalizeCourseMapText(query);
    courseIndex.classList.toggle("ou-yeah-course-map-filtering", Boolean(normalized));

    courseIndex.querySelectorAll('[data-for="cm"]').forEach((item) => {
      const matches = !normalized || (item.dataset.ouCourseMapText || "").includes(normalized);
      item.dataset.ouCourseMapHidden = String(!matches);
    });

    courseIndex.querySelectorAll('[data-for="section"]').forEach((section) => {
      const sectionMatches = !normalized || (section.dataset.ouCourseMapText || "").includes(normalized);
      const childMatches = Array.from(section.querySelectorAll('[data-for="cm"], [data-for="section"]')).some((item) => {
        return (item.dataset.ouCourseMapText || "").includes(normalized);
      });
      section.dataset.ouCourseMapHidden = String(Boolean(normalized) && !sectionMatches && !childMatches);
      if (sectionMatches && normalized) {
        section.querySelectorAll(':scope [data-for="cm"]').forEach((item) => {
          item.dataset.ouCourseMapHidden = "false";
        });
      }
    });
  }

  function updateCourseMapCurrentSection() {
    const courseIndex = document.getElementById("courseindex");
    if (!courseIndex) return;

    const sections = Array.from(document.querySelectorAll("#region-main [id^='section-']"))
      .filter((section) => section instanceof HTMLElement);
    if (!sections.length) return;

    let current = sections[0];
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= 180 && rect.bottom > 120) current = section;
    }

    courseIndex.querySelectorAll(".ou-yeah-current-section").forEach((item) => {
      item.classList.remove("ou-yeah-current-section");
    });

    if (!current.id) return;
    const selector = `.courseindex-link[href$="#${CSS.escape(current.id)}"], .courseindex-link[href*="#${CSS.escape(current.id)}"]`;
    const link = courseIndex.querySelector(selector);
    link?.closest('[data-for="section"]')?.classList.add("ou-yeah-current-section");
  }

  function classifyCourseMapModule(title, href) {
    const normalized = normalizeCourseMapText(`${title} ${href}`);
    if (/video|xem|conference|page\/view/.test(normalized)) return "video";
    if (/slide|powerpoint|presentation/.test(normalized)) return "slide";
    if (/script|tai lieu|resource\/view|tai ve|download/.test(normalized)) return "file";
    if (/forum|dien dan|thao luan|tra loi/.test(normalized)) return "forum";
    if (/assignment|bai tap|nop bai|quiz|kiem tra/.test(normalized)) return "assignment";
    if (/calendar|lich/.test(normalized)) return "calendar";
    return "page";
  }

  function courseMapKindLabel(kind) {
    return {
      assignment: "BT",
      calendar: "LICH",
      file: "DL",
      forum: "TL",
      page: "DOC",
      slide: "SLD",
      video: "VID"
    }[kind] || "DOC";
  }

  function cleanCourseMapTitle(value) {
    return String(value || "")
      .replace(/\b(Mở rộng|Rút gọn|Đã được nhấn mạnh|Completed|Hoàn thành)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCourseMapText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function injectCourseMapTheme() {
    if (document.getElementById(COURSE_MAP_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = COURSE_MAP_STYLE_ID;
    style.textContent = courseMapCss();
    document.documentElement.appendChild(style);
  }

  function courseMapCss() {
    return `
      ${spaceGroteskFontFaces()}
      body.ou-yeah-course-view {
        --ou-course-brand: ${BRAND};
        --ou-course-ink: #181b22;
        --ou-course-muted: #717783;
        --ou-course-line: #e1e4ea;
        --ou-course-soft: #f7f8fa;
        --ou-course-panel: #fff;
      }

      body.ou-yeah-course-view #region-main,
      body.ou-yeah-course-view #region-main *:not(.fa):not(.icon) {
        font-family: "Space Grotesk", "Segoe UI", sans-serif !important;
        letter-spacing: 0;
      }

      body.ou-yeah-course-view #theme_boost-drawers-courseindex.ou-yeah-course-map-drawer {
        width: min(390px, calc(100vw - 24px)) !important;
        border-right: 1px solid var(--ou-course-line);
        background: #f5f6f8 !important;
        box-shadow: 12px 0 32px rgba(24, 39, 75, 0.08);
      }

      body.ou-yeah-course-view #theme_boost-drawers-courseindex.ou-yeah-course-map-drawer .drawercontent {
        padding: 12px 10px 18px !important;
      }

      #${COURSE_MAP_TOOLS_ID} {
        position: sticky;
        top: 0;
        z-index: 5;
        display: grid;
        gap: 10px;
        margin: 0 0 10px;
        padding: 12px;
        border: 1px solid var(--ou-course-line);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 10px 24px rgba(24, 39, 75, 0.08);
        backdrop-filter: blur(10px);
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-kicker {
        display: block;
        color: var(--ou-course-brand);
        font-size: 10px;
        font-weight: 700;
        line-height: 1.1;
      }

      #${COURSE_MAP_TOOLS_ID} h2 {
        margin: 2px 0 0;
        color: var(--ou-course-ink);
        font-size: 19px;
        font-weight: 700;
        line-height: 1.1;
      }

      #${COURSE_MAP_TOOLS_ID} button {
        min-height: 30px;
        padding: 0 10px;
        border: 1px solid #d9deec;
        border-radius: 7px;
        background: #fff;
        color: #455ba9;
        font-size: 11px;
        font-weight: 650;
        cursor: pointer;
      }

      #${COURSE_MAP_TOOLS_ID} button:hover {
        border-color: #bdc7e4;
        background: #f3f5fc;
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-search {
        display: grid;
        gap: 5px;
        margin: 0;
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-search span {
        color: var(--ou-course-muted);
        font-size: 10px;
        font-weight: 650;
      }

      #${COURSE_MAP_TOOLS_ID} input {
        width: 100%;
        height: 36px;
        padding: 0 11px;
        border: 1px solid #d9dde7;
        border-radius: 7px;
        background: #fff;
        color: var(--ou-course-ink);
        font-size: 12px;
        outline: 0;
      }

      #${COURSE_MAP_TOOLS_ID} input:focus {
        border-color: #9aa8dc;
        box-shadow: 0 0 0 3px rgba(82, 105, 199, 0.12);
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      #${COURSE_MAP_TOOLS_ID} .ou-course-map-stats span {
        min-height: 22px;
        padding: 4px 7px;
        border-radius: 5px;
        background: #eef1f5;
        color: #606875;
        font-size: 10px;
        font-weight: 650;
        line-height: 1.2;
      }

      #courseindex.ou-yeah-course-map {
        padding: 0 !important;
        color: var(--ou-course-ink);
      }

      #courseindex.ou-yeah-course-map .courseindex-section {
        position: relative;
        margin: 0 0 5px !important;
        border-radius: 8px;
      }

      #courseindex.ou-yeah-course-map .courseindex-section[data-ou-course-map-hidden="true"],
      #courseindex.ou-yeah-course-map [data-for="cm"][data-ou-course-map-hidden="true"] {
        display: none !important;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-title] {
        min-height: 34px;
        padding: 4px 7px 4px calc(8px + (var(--ou-depth, 0) * 13px)) !important;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        transition: background 140ms ease, border-color 140ms ease;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-depth="1"] > [data-ou-course-map-title] {
        --ou-depth: 1;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-depth="2"] > [data-ou-course-map-title] {
        --ou-depth: 2;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-depth="3"] > [data-ou-course-map-title] {
        --ou-depth: 3;
      }

      #courseindex.ou-yeah-course-map .courseindex-section:hover > [data-ou-course-map-title],
      #courseindex.ou-yeah-course-map .courseindex-section.ou-yeah-current-section > [data-ou-course-map-title] {
        border-color: #d8deee;
        background: #fff;
      }

      #courseindex.ou-yeah-course-map .courseindex-section.ou-yeah-current-section > [data-ou-course-map-title] {
        box-shadow: inset 3px 0 0 var(--ou-course-brand);
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-title]::before {
        content: attr(data-ou-course-map-number);
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 22px;
        margin-right: 7px;
        border-radius: 5px;
        background: #edf1ff;
        color: #455ba9;
        font-size: 10px;
        font-weight: 750;
        line-height: 1;
      }

      #courseindex.ou-yeah-course-map .courseindex-chevron {
        display: inline-grid !important;
        place-items: center;
        width: 24px;
        height: 24px;
        min-width: 24px;
        margin: 0 4px 0 0 !important;
        border-radius: 6px;
        color: #697386;
        overflow: hidden;
      }

      #courseindex.ou-yeah-course-map .courseindex-link {
        min-width: 0;
        color: #242a34 !important;
        font-size: 12px;
        font-weight: 620;
        line-height: 1.28;
        text-decoration: none !important;
      }

      #courseindex.ou-yeah-course-map .courseindex-section-title .courseindex-link {
        white-space: normal !important;
      }

      #courseindex.ou-yeah-course-map .courseindex-item-content {
        margin-left: 15px;
        padding-left: 10px;
        border-left: 1px solid #e2e6ee;
      }

      #courseindex.ou-yeah-course-map .courseindex-sectioncontent {
        display: grid;
        gap: 2px;
        margin: 3px 0 6px !important;
        padding: 0 !important;
      }

      #courseindex.ou-yeah-course-map [data-for="cm"] {
        position: relative;
        display: grid !important;
        grid-template-columns: 34px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        min-height: 29px;
        padding: 2px 7px !important;
        border-radius: 6px;
      }

      #courseindex.ou-yeah-course-map [data-for="cm"]:hover {
        background: #fff;
      }

      #courseindex.ou-yeah-course-map [data-for="cm"]::before {
        content: attr(data-ou-course-map-kind-label);
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 19px;
        border-radius: 5px;
        background: #eef1f5;
        color: #626b78;
        font-size: 8px;
        font-weight: 750;
        line-height: 1;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-kind="video"]::before {
        background: #eaf0ff;
        color: #455ba9;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-kind="file"]::before,
      #courseindex.ou-yeah-course-map [data-ou-course-map-kind="slide"]::before {
        background: #edf5ef;
        color: #397b5c;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-kind="forum"]::before {
        background: #efedf8;
        color: #6252a3;
      }

      #courseindex.ou-yeah-course-map [data-ou-course-map-kind="assignment"]::before {
        background: #f8ecec;
        color: #a95055;
      }

      #courseindex.ou-yeah-course-map [data-for="cm"] .courseindex-link {
        color: #4b5360 !important;
        font-size: 11px;
        font-weight: 520;
      }

      #courseindex.ou-yeah-course-map .dimmed {
        opacity: 0.52;
      }

      #courseindex.ou-yeah-course-map.ou-yeah-course-map-filtering .courseindex-item-content {
        display: block !important;
        height: auto !important;
      }

      body.ou-yeah-course-view .course-content .course-section {
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }

      body.ou-yeah-course-view .course-content .course-section > .content {
        margin: 0 !important;
        padding: 0 !important;
      }

      body.ou-yeah-course-view .course-content .course-section-header {
        position: relative !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 5px 0 !important;
        border-top: 1px solid var(--ou-course-line);
        border-bottom: 0 !important;
        border-radius: 9px !important;
        transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
      }

      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open {
        position: relative !important;
        margin: 4px 0 8px !important;
        padding: 0 0 7px !important;
        border: 1px solid #d7def2 !important;
        border-radius: 12px !important;
        background: linear-gradient(180deg, rgba(246, 248, 255, 0.95), rgba(255, 255, 255, 0.98)) !important;
        box-shadow: 0 6px 18px rgba(35, 48, 82, 0.06);
      }

      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open > .course-section-header {
        margin: 0 !important;
        padding-left: 12px !important;
        padding-right: 52px !important;
        border-top: 0 !important;
        border-color: #c6d0ee !important;
        border-radius: 11px 11px 8px 8px !important;
        background: linear-gradient(90deg, rgba(82, 105, 199, 0.17), rgba(82, 105, 199, 0.065) 64%, rgba(82, 105, 199, 0.02)) !important;
        box-shadow: inset 4px 0 0 var(--ou-course-brand);
      }

      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open > .course-section-header::after {
        content: "Mở";
        position: absolute;
        top: 50%;
        right: 11px;
        transform: translateY(-50%);
        display: inline-grid;
        place-items: center;
        min-height: 20px;
        padding: 3px 7px;
        border: 1px solid #bfc9eb;
        border-radius: 999px;
        background: #fff;
        color: #455ab3;
        font-size: 10.5px;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
      }

      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open > .content {
        margin: 7px 10px 0 17px !important;
        padding: 0 0 0 14px !important;
        border-left: 3px solid rgba(82, 105, 199, 0.35);
      }

      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open > .content > .summary,
      body.ou-yeah-course-view .course-content .course-section.ou-yeah-section-open > .content > .course-section-summary {
        border-color: #cfd8ef !important;
        background: linear-gradient(180deg, #fff, #fafbff) !important;
      }

      body.ou-yeah-course-view .course-content .course-section-header > .d-flex,
      body.ou-yeah-course-view .course-content .course-section-header .d-flex.align-items-center {
        min-height: 36px !important;
        align-items: center !important;
        gap: 7px !important;
      }

      body.ou-yeah-course-view .course-content .course-section-header .icons-collapse-expand,
      body.ou-yeah-course-view .course-content .course-section-header .btn-icon,
      body.ou-yeah-course-view .course-content .course-section-header [data-toggle="collapse"] {
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        min-height: 30px !important;
        margin: 0 !important;
        padding: 0 !important;
        display: inline-grid !important;
        place-items: center !important;
        flex: 0 0 30px !important;
      }

      body.ou-yeah-course-view .course-content .course-section-header .icon,
      body.ou-yeah-course-view .course-content .course-section-header .fa {
        margin: 0 !important;
        font-size: 13px !important;
      }

      body.ou-yeah-course-view .course-content .sectionname,
      body.ou-yeah-course-view .course-content .sectionname a,
      body.ou-yeah-course-view .course-content .sectionname .aalink,
      body.ou-yeah-course-view .course-content .sectionname .inplaceeditable,
      body.ou-yeah-course-view .course-content .sectionname .quickeditlink {
        color: #2a3039 !important;
        font-size: clamp(13.25px, 0.88vw, 15.5px) !important;
        font-weight: 660 !important;
        line-height: 1.18 !important;
        min-width: 0 !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        text-transform: none !important;
      }

      body.ou-yeah-course-view .course-content .eloflexsections-level-0 > .course-section-header .sectionname,
      body.ou-yeah-course-view .course-content .eloflexsections-level-0 > .course-section-header .sectionname a,
      body.ou-yeah-course-view .course-content .eloflexsections-level-0 > .course-section-header .sectionname .aalink,
      body.ou-yeah-course-view .course-content .eloflexsections-level-0 > .course-section-header .sectionname .inplaceeditable {
        font-size: clamp(14px, 0.98vw, 16.5px) !important;
      }

      body.ou-yeah-course-view .course-content .eloflexsections-level-1 > .course-section-header {
        padding-left: 10px !important;
        border-left: 2px solid #dfe5f4;
      }

      body.ou-yeah-course-view .course-content .eloflexsections-level-2 > .course-section-header {
        padding-left: 18px !important;
        border-left: 2px solid #edf0f6;
      }

      body.ou-yeah-course-view .course-content .section-summary-activities .activity,
      body.ou-yeah-course-view .course-content .activity {
        font-size: 13px !important;
      }

      body.ou-yeah-course-view .course-content .section-summary-activities,
      body.ou-yeah-course-view .course-content .section .activities,
      body.ou-yeah-course-view .course-content .section .content > ul {
        margin: 0 !important;
        padding: 0 !important;
      }

      body.ou-yeah-course-view .course-content .activity {
        margin: 0 0 6px !important;
        padding: 0 !important;
      }

      body.ou-yeah-course-view .course-content .activity-item {
        min-height: 0 !important;
        margin: 5px 0 !important;
        padding: 8px 10px !important;
        border: 1px dashed #dce2ec !important;
        border-radius: 9px !important;
      }

      body.ou-yeah-course-view .course-content .activity-item .activity-basis,
      body.ou-yeah-course-view .course-content .activity-item .activity-instance,
      body.ou-yeah-course-view .course-content .activity-item .activitytitle,
      body.ou-yeah-course-view .course-content .activity-item .media {
        min-height: 0 !important;
        align-items: center !important;
        gap: 10px !important;
      }

      body.ou-yeah-course-view .course-content .activityiconcontainer {
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        min-height: 30px !important;
        margin: 0 9px 0 0 !important;
        border-radius: 7px !important;
      }

      body.ou-yeah-course-view .course-content .activityiconcontainer .activityicon,
      body.ou-yeah-course-view .course-content .activityiconcontainer img,
      body.ou-yeah-course-view .course-content .activityiconcontainer .icon {
        width: 17px !important;
        height: 17px !important;
        max-width: 17px !important;
        max-height: 17px !important;
        margin: 0 !important;
      }

      body.ou-yeah-course-view .course-content .activityname,
      body.ou-yeah-course-view .course-content .activityname a,
      body.ou-yeah-course-view .course-content .activityname .instancename,
      body.ou-yeah-course-view .course-content .activity-item .aalink,
      body.ou-yeah-course-view .course-content .activity-item .stretched-link {
        color: #26303b !important;
        font-size: clamp(13.25px, 0.86vw, 15px) !important;
        font-weight: 590 !important;
        line-height: 1.2 !important;
      }

      body.ou-yeah-course-view .course-content .activity-description,
      body.ou-yeah-course-view .course-content .activity-altcontent,
      body.ou-yeah-course-view .course-content .activity-item .description,
      body.ou-yeah-course-view .course-content .activity-item .availabilityinfo,
      body.ou-yeah-course-view .course-content .activity-dates {
        font-size: 12px !important;
        line-height: 1.3 !important;
      }

      body.ou-yeah-course-view .course-content .activity-item .description,
      body.ou-yeah-course-view .course-content .activity-description {
        margin-top: 8px !important;
      }

      body.ou-yeah-course-view .course-content .activity-item .availabilityinfo,
      body.ou-yeah-course-view .course-content .activity-item .alert {
        margin: 7px 0 0 !important;
        padding: 7px 10px !important;
        border-radius: 9px !important;
      }

      body.ou-yeah-course-view .course-content .activity-dates {
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 6px !important;
        margin-top: 7px !important;
      }

      body.ou-yeah-course-view .course-content .activity-dates .badge,
      body.ou-yeah-course-view .course-content .activity-dates strong,
      body.ou-yeah-course-view .course-content .activity-item .badge {
        min-height: 22px !important;
        padding: 3px 7px !important;
        border-radius: 7px !important;
        font-size: 11px !important;
        line-height: 1.15 !important;
      }

      body.ou-yeah-course-view .course-content .completion-info,
      body.ou-yeah-course-view .course-content [data-region="completion-info"],
      body.ou-yeah-course-view .course-content .automatic-completion-conditions {
        margin-left: auto !important;
        font-size: 12px !important;
      }

      body.ou-yeah-course-view .course-content .completion-info .btn,
      body.ou-yeah-course-view .course-content [data-region="completion-info"] .btn,
      body.ou-yeah-course-view .course-content .completioncheck,
      body.ou-yeah-course-view .course-content .completion-icon {
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        min-height: 30px !important;
        padding: 0 !important;
        border-radius: 999px !important;
        display: inline-grid !important;
        place-items: center !important;
      }

      body.ou-yeah-course-view .course-content .completion-info .icon,
      body.ou-yeah-course-view .course-content [data-region="completion-info"] .icon,
      body.ou-yeah-course-view .course-content .completion-info .fa {
        width: 13px !important;
        height: 13px !important;
        font-size: 13px !important;
        margin: 0 !important;
      }
    `;
  }

  function scheduleNotificationPopoverRefresh() {
    window.clearTimeout(notificationPopoverTimer);
    notificationPopoverTimer = window.setTimeout(refreshNotificationPopover, 80);
  }

  function refreshNotificationPopover() {
    const root = document.getElementById("nav-notification-popover-container");
    if (!root) return;

    root.classList.add("ou-yeah-popover-themed");
    relabelNotificationPopoverLinks(root);
    annotateNotificationPopoverItems(root);
  }

  function relabelNotificationPopoverLinks(root) {
    const seeAll = root.querySelector(".see-all-link");
    if (seeAll) {
      seeAll.textContent = "Xem tất cả";
      seeAll.setAttribute("aria-label", "Xem tất cả thông báo");
    }

    root.querySelectorAll(".view-more").forEach((link) => {
      link.textContent = "Chi tiết";
      link.setAttribute("aria-label", "Xem chi tiết thông báo");
    });
  }

  function annotateNotificationPopoverItems(root) {
    root.querySelectorAll('[data-region="notification-content-item-container"]').forEach((item) => {
      const message = item.querySelector(".notification-message")?.textContent?.replace(/\s+/g, " ").trim() || "";
      const ariaLabel = item.getAttribute("aria-label") || item.firstElementChild?.getAttribute("aria-label") || "";
      const type = classifyNotificationPopoverItem(message);
      const isUnread = item.classList.contains("unread") || normalizeNotificationPopoverText(ariaLabel).includes("chua doc");
      const file = isUnread
        ? NOTIFICATION_UNREAD_ICON_FILE
        : NOTIFICATION_TYPE_ICON_FILES[type] || NOTIFICATION_TYPE_ICON_FILES.system;

      item.dataset.ouPopupType = type;
      item.dataset.ouPopupUnread = String(isUnread);
      item.dataset.ouPopupIcon = file.replace(/\.svg$/i, "");

      const iconUrl = notificationPopoverIconUrl(file);
      if (iconUrl) {
        item.dataset.ouPopupIconReady = "true";
        item.style.setProperty("--ou-popup-icon", `url("${iconUrl}")`);
      } else {
        item.dataset.ouPopupIconReady = "false";
      }
    });
  }

  function classifyNotificationPopoverItem(message) {
    const normalized = normalizeNotificationPopoverText(message);
    if (/video conference|zoom|google meet|lich hoc|thoi gian to chuc|hop truc tuyen/.test(normalized)) return "meeting";
    if (/tra loi:|thao luan|dien dan|forum|chu de|nhom\s*\d+/.test(normalized)) return "discussion";
    if (/da nop|nop bai|bai tap lon|assignment|quiz|deadline|han nop/.test(normalized)) return "assignment";
    if (/thong bao|announcement|giang vien|thay|co |kiem tra|de lam tot/.test(normalized)) return "announcement";
    return "system";
  }

  function notificationPopoverIconUrl(file) {
    if (!isExtensionContextAvailable()) return "";

    try {
      return chrome.runtime.getURL(`src/icons/${file}`);
    } catch {
      return "";
    }
  }

  function normalizeNotificationPopoverText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function injectNotificationPopoverTheme() {
    if (document.getElementById(NOTIFICATION_POPOVER_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = NOTIFICATION_POPOVER_STYLE_ID;
    style.textContent = notificationPopoverCss();
    document.documentElement.appendChild(style);
  }

  function notificationPopoverCss() {
    return `
      ${spaceGroteskFontFaces()}
      #nav-notification-popover-container.ou-yeah-popover-themed {
        --ou-popup-brand: ${BRAND};
        --ou-popup-ink: #181b22;
        --ou-popup-muted: #6f7580;
        --ou-popup-line: #e0e3e8;
        --ou-popup-soft: #f8f9fa;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed *,
      #nav-notification-popover-container.ou-yeah-popover-themed *::before,
      #nav-notification-popover-container.ou-yeah-popover-themed *::after {
        box-sizing: border-box;
        letter-spacing: 0;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed :where(
        h1, h2, h3, h4, h5, h6,
        p, a, span, div, button,
        small, strong, em, b, label
      ):not(.fa):not(.fas):not(.far):not(.fab):not(.fa-solid):not(.fa-regular):not(.fa-brands):not(.icon):not(.material-icons):not(.material-symbols-outlined):not([class^="fa-"]):not([class*=" fa-"]):not([class^="icon-"]):not([class*=" icon-"]) {
        font-family: inherit;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-container {
        width: min(430px, calc(100vw - 24px)) !important;
        border: 1px solid var(--ou-popup-line) !important;
        border-radius: 8px !important;
        background: #fff !important;
        box-shadow: 0 18px 40px rgba(24, 39, 75, 0.13), 0 2px 8px rgba(24, 39, 75, 0.06) !important;
        overflow: hidden !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container {
        border-bottom: 1px solid var(--ou-popup-line);
        background: #fff;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container > .p-2,
      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container .border-dashed {
        padding: 13px 14px !important;
        border: 0 !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="popover-region-header-text"] {
        color: var(--ou-popup-ink) !important;
        font-size: 17px !important;
        font-weight: 650 !important;
        line-height: 1.2 !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container a,
      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container button {
        display: inline-grid !important;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 7px;
        color: #4f5662 !important;
        text-decoration: none !important;
        transition: background 140ms ease, color 140ms ease;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container a:hover,
      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-header-container button:hover {
        background: #f1f3f7;
        color: var(--ou-popup-brand) !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="popover-region-content"],
      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-content {
        padding: 8px !important;
        background: var(--ou-popup-soft);
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="all-notifications"] {
        display: grid;
        gap: 4px;
        max-height: 390px;
        padding-right: 2px;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="all-notifications"]::-webkit-scrollbar {
        width: 9px;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="all-notifications"]::-webkit-scrollbar-thumb {
        border: 2px solid var(--ou-popup-soft);
        border-radius: 999px;
        background: #aab3c2;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="notification-content-item-container"] {
        --ou-popup-type-color: #64748b;
        --ou-popup-type-soft: #eef1f5;
        margin: 0 !important;
        padding: 8px 9px !important;
        border: 1px solid transparent !important;
        border-radius: 7px !important;
        background: #fff !important;
        transition: border-color 140ms ease, background 140ms ease;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-region="notification-content-item-container"]:hover {
        border-color: #c9d0e5 !important;
        background: #fafbfe !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-type="assignment"] {
        --ou-popup-type-color: #397b5c;
        --ou-popup-type-soft: #eaf3ee;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-type="meeting"] {
        --ou-popup-type-color: #9a6635;
        --ou-popup-type-soft: #f7efe6;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-type="discussion"] {
        --ou-popup-type-color: #6252a3;
        --ou-popup-type-soft: #efedf8;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-type="announcement"] {
        --ou-popup-type-color: #a95055;
        --ou-popup-type-soft: #f8ecec;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-icon="envelope-dot"] {
        --ou-popup-type-color: #455ba9;
        --ou-popup-type-soft: #edf1ff;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .content-item-body {
        display: grid !important;
        grid-template-columns: 26px minmax(0, 1fr);
        align-items: start;
        gap: 8px;
        padding: 0 !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .notification-image {
        position: relative;
        display: grid !important;
        place-items: center;
        width: 26px !important;
        min-width: 26px !important;
        height: 26px !important;
        margin: 0 !important;
        border-radius: 6px;
        background: var(--ou-popup-type-soft);
        color: var(--ou-popup-type-color);
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-icon-ready="true"] .notification-image::before {
        content: "";
        display: block;
        width: 14px;
        height: 14px;
        background: currentColor;
        -webkit-mask: var(--ou-popup-icon) center / contain no-repeat;
        mask: var(--ou-popup-icon) center / contain no-repeat;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed [data-ou-popup-icon-ready="true"] .notification-image .icon {
        display: none !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .notification-message {
        min-width: 0;
        padding: 1px 0 0 !important;
        overflow: hidden;
        color: #242a34 !important;
        display: -webkit-box;
        font-size: 12.5px !important;
        font-weight: 540;
        line-height: 1.35 !important;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .content-item-footer {
        display: flex !important;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 3px 0 0 34px !important;
        padding: 0 !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .timestamp {
        min-width: 0;
        overflow: hidden;
        color: var(--ou-popup-muted) !important;
        font-size: 10.5px !important;
        font-weight: 500;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .view-more {
        flex: 0 0 auto;
        color: #455ba9 !important;
        font-size: 11px !important;
        font-weight: 600;
        line-height: 1.2;
        text-decoration: none !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .view-more:hover {
        color: #2f448d !important;
        text-decoration: underline !important;
        text-underline-offset: 2px;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .see-all-link {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 7px;
        width: 100%;
        min-height: 38px;
        padding: 0 14px !important;
        border: 1px solid #d9deec !important;
        border-radius: 7px !important;
        background: #fff !important;
        color: #455ba9 !important;
        font-size: 13px !important;
        font-weight: 650 !important;
        line-height: 1 !important;
        text-decoration: none !important;
        box-shadow: none !important;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .see-all-link::after {
        content: "→";
        font-size: 16px;
        line-height: 1;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .see-all-link:hover {
        border-color: #bdc7e4 !important;
        background: #f3f5fc !important;
        color: #30468f !important;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-container > .p-3,
      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-container .see-all-link {
        margin-top: 0;
      }

      #nav-notification-popover-container.ou-yeah-popover-themed .popover-region-container > .p-3 {
        padding: 10px !important;
        border-top: 1px solid var(--ou-popup-line);
        background: #fff;
      }
    `;
  }

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
      ${spaceGroteskFontFaces()}
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
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        pointer-events: none;
      }
      * { box-sizing: border-box; font-family: inherit; }
      .book-hud {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: calc(100vw - 24px);
        padding: 5px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        background: rgba(22,24,29,0.96);
        color: rgba(255,255,255,0.95);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        transform: translateX(-50%);
        animation: bookHudReveal 320ms cubic-bezier(0.16,1,0.3,1) both;
        pointer-events: auto;
      }
      .book-hud[data-status="complete"] {
        animation: bookHudReveal 240ms ease-out both;
      }
      .book-logo {
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 7px;
        background: ${BRAND};
        color: #fff;
        flex: 0 0 auto;
        box-shadow: none;
        transition: background 160ms ease;
      }
      .book-logo:hover {
        background: #6178D2;
      }
      .book-logo:hover svg {
        animation: bookLogoSpin 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      }
      .book-logo svg { width: 18px; height: 18px; fill: currentColor; transition: transform 200ms ease; }
      .book-divider {
        width: 1px;
        height: 22px;
        flex: 0 0 auto;
        background: rgba(255,255,255,0.1);
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
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 7px;
        background: #22252b;
        color: rgba(255,255,255,0.94);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        transition: background 180ms ease, border-color 180ms ease, color 180ms ease, transform 120ms ease, box-shadow 180ms ease;
      }
      button:hover:not(:disabled) {
        background: #2a2e36;
        border-color: rgba(255,255,255,0.16);
        color: #fff;
        box-shadow: none;
      }
      button:active:not(:disabled) { transform: scale(0.96); }
      button:focus-visible {
        outline: 2px solid #7589DA;
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
        color: rgba(255,255,255,0.5);
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
        height: 3px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        box-shadow: none;
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
        background: ${BRAND};
        box-shadow: none;
        transition: width 420ms cubic-bezier(0.16,1,0.3,1), background 220ms ease, box-shadow 220ms ease;
        will-change: width;
      }
      .book-progress-fill::after {
        display: none;
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
        background: #4EA477;
        box-shadow: none;
      }
      .book-hud[data-status="error"] .book-progress-fill {
        background: #D56868;
        box-shadow: none;
      }
      .book-hud[data-status="preparing"] .book-status,
      .book-hud[data-status="downloading"] .book-status,
      .book-hud[data-status="building"] .book-status { color: #91A0DD; }
      .book-hud[data-status="complete"] .book-status { color: #78BC96; }
      .book-hud[data-status="error"] .book-status { color: #E18A8A; }
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

  function spaceGroteskFontFaces() {
    if (!isExtensionContextAvailable()) return "";

    const fontUrl = (filename) => chrome.runtime.getURL(`src/fonts/${filename}`);
    return `
      @font-face { font-family: "Space Grotesk"; src: url("${fontUrl("SpaceGrotesk-Light.ttf")}") format("truetype"); font-style: normal; font-weight: 300; font-display: swap; }
      @font-face { font-family: "Space Grotesk"; src: url("${fontUrl("SpaceGrotesk-Regular.ttf")}") format("truetype"); font-style: normal; font-weight: 400; font-display: swap; }
      @font-face { font-family: "Space Grotesk"; src: url("${fontUrl("SpaceGrotesk-Medium.ttf")}") format("truetype"); font-style: normal; font-weight: 500; font-display: swap; }
      @font-face { font-family: "Space Grotesk"; src: url("${fontUrl("SpaceGrotesk-SemiBold.ttf")}") format("truetype"); font-style: normal; font-weight: 600; font-display: swap; }
      @font-face { font-family: "Space Grotesk"; src: url("${fontUrl("SpaceGrotesk-Bold.ttf")}") format("truetype"); font-style: normal; font-weight: 700; font-display: swap; }
    `;
  }

  function hudCss() {
    return `
      ${spaceGroteskFontFaces()}
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
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        --brand: ${BRAND};
        --brand-light: #91A0DD;
        --surface: rgba(22,24,29,0.96);
        --surface-hover: #292c33;
        --surface-elevated: rgba(27,29,35,0.98);
        --border: rgba(255,255,255,0.1);
        --border-accent: rgba(145,160,221,0.42);
        --text-primary: rgba(255,255,255,0.94);
        --text-secondary: rgba(255,255,255,0.66);
        --text-muted: rgba(255,255,255,0.45);
        --radius-sm: 7px;
        --radius-md: 9px;
        --radius-lg: 12px;
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
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
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
        border-color: rgba(255,255,255,0.16);
        box-shadow: 0 10px 28px rgba(0,0,0,0.34);
      }
      :host(.is-visible) .hud:focus-within { opacity: 1; }

      /* ─── Logo ─── */
      .hud-logo {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        background: var(--brand);
        color: #fff;
        flex-shrink: 0;
        transition: background 160ms ease;
      }
      .hud-logo:hover {
        background: #6178D2;
      }
      .hud-logo:hover svg {
        animation: logoSpin 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      }
      .hud-logo svg { width: 16px; height: 16px; transition: transform 200ms ease; }

      /* ─── Divider ─── */
      .hud-divider {
        width: 1px;
        height: 20px;
        background: rgba(255,255,255,0.1);
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
        background: #22252b;
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 600;
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
        display: none;
      }
      button:hover {
        background: #2a2e36;
        border-color: rgba(255,255,255,0.16);
        box-shadow: none;
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
        border: 1px solid #667bd0;
        background: var(--brand);
        color: #fff;
        font-weight: 600;
        letter-spacing: 0;
        text-shadow: none;
        box-shadow: none;
      }
      .speed::before {
        display: none;
      }
      .speed .asset-icon-chevron {
        width: 13px;
        height: 13px;
        transition: transform 240ms cubic-bezier(0.34,1.56,0.64,1);
      }
      :host(.menu-open) .speed .asset-icon-chevron { transform: rotate(180deg); }
      .speed:hover {
        background: #6178D2;
        box-shadow: none;
        border-color: #7186D7;
        color: #fff;
      }
      :host(.menu-open) .speed {
        box-shadow: none;
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
        box-shadow: 0 10px 28px rgba(0,0,0,0.34);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
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
        background: rgba(145,160,221,0.12);
        color: #B4C0EF;
        box-shadow: none;
      }
      .hud-menu button.is-selected {
        background: rgba(82,105,199,0.24);
        color: #C6CFF1;
        font-weight: 600;
        box-shadow: none;
      }

      /* ─── Download ─── */
      .icon-only {
        min-width: 32px;
        width: 32px;
        height: 32px;
        padding: 0;
      }
      .icon-only:hover {
        color: #C6CFF1;
        background: rgba(145,160,221,0.1);
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
        color: #AEB9E8;
        font-size: 10px;
        font-weight: 600;
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
        height: 3px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        box-shadow: none;
      }
      .hud-download-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--video-download-progress, 0%);
        overflow: hidden;
        border-radius: inherit;
        background: var(--brand);
        box-shadow: none;
        transition: width 420ms cubic-bezier(0.16,1,0.3,1), background 220ms ease, box-shadow 220ms ease;
        will-change: width;
      }
      .hud-download-fill::after {
        display: none;
      }
      .hud[data-download-status="preparing"] .hud-download-fill::after,
      .hud[data-download-status="downloading"] .hud-download-fill::after,
      .hud[data-download-status="building"] .hud-download-fill::after {
        animation: videoDownloadSweep 1.35s ease-in-out infinite;
      }
      .hud[data-download-status="complete"] .hud-download-status { color: #78BC96; }
      .hud[data-download-status="complete"] .hud-download-fill {
        background: #4EA477;
        box-shadow: none;
      }
      .hud[data-download-status="error"] .hud-download-status { color: #E18A8A; }
      .hud[data-download-status="error"] .hud-download-fill {
        background: #D56868;
        box-shadow: none;
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
        box-shadow: 0 8px 22px rgba(0,0,0,0.32);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-size: 12px;
        font-weight: 600;
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
        border-color: rgba(213,104,104,0.38);
        background: #302326;
        color: #E7A1A1;
        box-shadow: 0 8px 22px rgba(0,0,0,0.32);
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
        background: rgba(18,20,24,0.97);
        box-shadow: 0 10px 30px rgba(0,0,0,0.48);
      }
    `;
  }
})();
