(() => {
  "use strict";

  const PAGE_PATH = "/message/output/popup/notifications.php";
  const TOOLBAR_ID = "ou-yeah-notification-toolbar";
  const ITEM_SELECTOR = '[data-region="notification-content-item-container"]';
  const LIST_SELECTOR = '[data-region="notification-area"] > [data-region="control-area"] > [data-region="content"]';
  const COURSE_RE = /\b([A-Z]{3,6}\d{3,6}-\d{4})\b/i;
  const COURSE_COLORS = [
    ["#3659a2", "rgba(54, 89, 162, 0.11)"],
    ["#7c3aed", "rgba(124, 58, 237, 0.10)"],
    ["#0f766e", "rgba(15, 118, 110, 0.11)"],
    ["#c2410c", "rgba(194, 65, 12, 0.10)"],
    ["#be123c", "rgba(190, 18, 60, 0.10)"],
    ["#0369a1", "rgba(3, 105, 161, 0.10)"]
  ];
  const TYPE_LABELS = {
    assignment: "Bài tập",
    meeting: "Lịch học",
    discussion: "Thảo luận",
    announcement: "Thông báo",
    system: "Hệ thống"
  };
  const UNREAD_ICON_FILE = "envelope-dot.svg";
  const TYPE_ICON_FILES = {
    assignment: "book-alt.svg",
    meeting: "daily-calendar.svg",
    discussion: "bubble-discussion.svg",
    announcement: "bell-notification-social-media.svg",
    system: "bell-notification-social-media.svg"
  };
  const COURSE_NAMES = /** @type {Record<string, string>} */ ({
    COSC04052: "Lập trình hướng đối tượng",
    COSC04032: "Toán rời rạc",
    COSC04042: "Cấu trúc dữ liệu và thuật giải",
    EDUC02062: "Kỹ năng học tập"
  });
  const SPACE_GROTESK_FONTS = [
    ["SpaceGrotesk-Light.ttf", "300"],
    ["SpaceGrotesk-Regular.ttf", "400"],
    ["SpaceGrotesk-Medium.ttf", "500"],
    ["SpaceGrotesk-SemiBold.ttf", "600"],
    ["SpaceGrotesk-Bold.ttf", "700"]
  ];

  const isProductionPage = location.hostname === "elolms.ou.edu.vn"
    && location.pathname.toLowerCase() === PAGE_PATH;
  const isFixturePage = ["127.0.0.1", "localhost"].includes(location.hostname)
    && location.pathname.endsWith("/test/notifications-fixture.html");
  if (!isProductionPage && !isFixturePage) return;

  const pageWindow = /** @type {Window & { __ouYeahNotificationsLoaded?: boolean }} */ (window);
  if (pageWindow.__ouYeahNotificationsLoaded) return;
  pageWindow.__ouYeahNotificationsLoaded = true;

  registerSpaceGroteskFonts();

  let toolbar = null;
  let list = null;
  let listObserver = null;
  let detailObserver = null;
  let pageObserver = null;
  let refreshTimer = 0;
  let searchQuery = "";
  let activeFilter = "all";
  let activeCourse = "all";

  document.body.classList.add("ou-yeah-notifications");
  enhancePage();

  if (!list) {
    pageObserver = new MutationObserver(() => {
      if (enhancePage()) {
        pageObserver?.disconnect();
        pageObserver = null;
      }
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }

  function registerSpaceGroteskFonts() {
    if (!("FontFace" in window) || !("fonts" in document)) return;
    if (document.documentElement.dataset.ouYeahFontsReady === "true") return;
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.getURL) return;

    document.documentElement.dataset.ouYeahFontsReady = "true";
    for (const [file, weight] of SPACE_GROTESK_FONTS) {
      try {
        const url = runtime.getURL(`src/fonts/${file}`);
        const face = new FontFace(
          "Space Grotesk",
          `url("${url}") format("truetype")`,
          { display: "swap", style: "normal", weight }
        );
        document.fonts.add(face);
        face.load().catch(() => {});
      } catch {
        document.documentElement.dataset.ouYeahFontsReady = "false";
      }
    }
  }

  function enhancePage() {
    const nextList = document.querySelector(LIST_SELECTOR);
    const notificationArea = document.querySelector('[data-region="notification-area"]');
    const controlArea = notificationArea?.querySelector(':scope > [data-region="control-area"]');
    const contentArea = notificationArea?.querySelector(':scope > [data-region="content-area"]');
    if (!nextList || !controlArea || !contentArea) return false;

    list = nextList;
    enhanceHeading();
    translateEmptyState(notificationArea);

    if (!toolbar) toolbar = createToolbar();
    if (toolbar.parentElement !== controlArea) controlArea.insertBefore(toolbar, list);

    setupSingleColumnFlow(notificationArea, controlArea, contentArea);
    setupBackToTop(notificationArea, contentArea);
    setupWheelScrolling();
    refreshNotifications();
    observeList();
    return true;
  }

  function setupSingleColumnFlow(notificationArea, controlArea, contentArea) {
    const backButton = ensureBackButton(contentArea);
    updateDetailState(contentArea);

    if (notificationArea.dataset.ouSingleColumnReady !== "true") {
      notificationArea.dataset.ouSingleColumnReady = "true";
      setNotificationView(notificationArea, controlArea, contentArea, "list");

      list.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const item = event.target.closest(ITEM_SELECTOR);
        if (!item || !list?.contains(item)) return;

        window.setTimeout(() => {
          updateDetailState(contentArea);
          setNotificationView(notificationArea, controlArea, contentArea, "detail");
          contentArea.scrollTop = 0;
          backButton.focus({ preventScroll: true });
          notificationArea.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
        }, 0);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !notificationArea.classList.contains("ou-yeah-detail-open")) return;
        closeDetail(notificationArea, controlArea, contentArea);
      });
    }

    if (backButton.dataset.ouBackBound !== "true") {
      backButton.dataset.ouBackBound = "true";
      backButton.addEventListener("click", () => closeDetail(notificationArea, controlArea, contentArea));
    }

    detailObserver?.disconnect();
    detailObserver = new MutationObserver(() => updateDetailState(contentArea));
    detailObserver.observe(contentArea, { childList: true, subtree: true, characterData: true });
  }

  function ensureBackButton(contentArea) {
    const existingButton = contentArea.querySelector(':scope > .ou-yeah-detail-back');
    if (existingButton instanceof HTMLButtonElement) return existingButton;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ou-yeah-detail-back";
    button.setAttribute("aria-label", "Quay lại danh sách thông báo");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      <span>Quay lại danh sách</span>
    `;
    contentArea.prepend(button);
    return button;
  }

  function updateDetailState(contentArea) {
    const header = contentArea.querySelector(':scope > [data-region="header"]');
    const content = contentArea.querySelector(':scope > [data-region="content"]');
    const hasDetail = Boolean(header?.textContent?.trim() || content?.textContent?.trim());
    contentArea.classList.toggle("ou-yeah-has-detail", hasDetail);
  }

  function closeDetail(notificationArea, controlArea, contentArea) {
    const selectedItem = list?.querySelector(`${ITEM_SELECTOR}.selected`);
    setNotificationView(notificationArea, controlArea, contentArea, "list");
    notificationArea.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    selectedItem?.querySelector("[tabindex]")?.focus({ preventScroll: true });
  }

  function setNotificationView(notificationArea, controlArea, contentArea, view) {
    const showDetail = view === "detail";
    notificationArea.classList.toggle("ou-yeah-detail-open", showDetail);
    notificationArea.dataset.ouView = view;
    controlArea.setAttribute("aria-hidden", String(showDetail));
    contentArea.setAttribute("aria-hidden", String(!showDetail));
    updateBackToTopState(notificationArea, contentArea);
  }

  function setupBackToTop(notificationArea, contentArea) {
    const button = document.querySelector("#back-to-top");
    if (!(button instanceof HTMLElement) || button.dataset.ouScrollBound === "true") return;

    button.dataset.ouScrollBound = "true";
    button.addEventListener("click", () => {
      const target = activeScrollTarget(notificationArea, contentArea);
      target?.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
      window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    });

    const update = () => updateBackToTopState(notificationArea, contentArea);
    list?.addEventListener("scroll", update, { passive: true });
    contentArea.addEventListener("scroll", update, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  function activeScrollTarget(notificationArea, contentArea) {
    return notificationArea.classList.contains("ou-yeah-detail-open") ? contentArea : list;
  }

  function updateBackToTopState(notificationArea, contentArea) {
    const button = document.querySelector("#back-to-top");
    if (!(button instanceof HTMLElement)) return;

    const target = activeScrollTarget(notificationArea, contentArea);
    const shouldShow = window.scrollY > 80 || (target?.scrollTop || 0) > 80;
    button.classList.toggle("show", shouldShow);
  }

  function preferredScrollBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  function setupWheelScrolling() {
    if (document.documentElement.dataset.ouWheelBound === "true") return;
    document.documentElement.dataset.ouWheelBound = "true";

    document.addEventListener("wheel", (event) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const delta = normalizeWheelDelta(event);
      if (!delta) return;

      const target = event.target instanceof Element ? event.target : null;
      const courseMenu = target?.closest(".ou-yeah-course-options");
      if (courseMenu instanceof HTMLElement && courseMenu.scrollHeight > courseMenu.clientHeight) {
        const previousTop = courseMenu.scrollTop;
        courseMenu.scrollTop = clampValue(courseMenu.scrollTop + delta, 0, courseMenu.scrollHeight - courseMenu.clientHeight);
        if (courseMenu.scrollTop !== previousTop) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }

      const scrollRoot = document.scrollingElement;
      if (!scrollRoot || scrollRoot.scrollHeight <= scrollRoot.clientHeight) return;

      const previousTop = scrollRoot.scrollTop;
      scrollRoot.scrollTop = clampValue(scrollRoot.scrollTop + delta, 0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      if (scrollRoot.scrollTop === previousTop) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }

  function normalizeWheelDelta(event) {
    if (event.deltaMode === 1) return event.deltaY * 32;
    if (event.deltaMode === 2) return event.deltaY * window.innerHeight * 0.85;
    return event.deltaY;
  }

  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function enhanceHeading() {
    const heading = Array.from(document.querySelectorAll("h1,h2,h3"))
      .find((element) => element.textContent?.trim().startsWith("Các thông báo"));
    if (!heading || heading.querySelector(".ou-yeah-heading-badge")) return;

    heading.classList.add("ou-yeah-notification-heading");
    const badge = document.createElement("span");
    badge.className = "ou-yeah-heading-badge";
    badge.textContent = "OU Yeah!";
    heading.appendChild(badge);
  }

  function translateEmptyState(notificationArea) {
    const emptyState = notificationArea?.querySelector('[data-region="content-area"] > .empty-text');
    if (emptyState && /select from the list/i.test(emptyState.textContent || "")) {
      emptyState.textContent = "Chọn một thông báo bên trái để xem nội dung chi tiết.";
    }
  }

  function createToolbar() {
    const root = document.createElement("section");
    root.id = TOOLBAR_ID;
    root.setAttribute("aria-label", "Bộ lọc thông báo OU Yeah!");
    root.innerHTML = `
      <div class="ou-yeah-notification-overview">
        <div>
          <span class="ou-yeah-eyebrow">Tổng quan</span>
          <strong data-role="summary">Đang đọc thông báo…</strong>
        </div>
      </div>
      <div class="ou-yeah-notification-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
        <input type="search" data-role="search" aria-label="Tìm thông báo" placeholder="Tìm nội dung, môn học…" autocomplete="off">
        <button type="button" data-role="clear-search" title="Xóa tìm kiếm" aria-label="Xóa tìm kiếm" hidden>
          <svg class="ou-yeah-clear-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>
        </button>
      </div>
      <div class="ou-yeah-notification-filters" role="group" aria-label="Lọc theo loại thông báo">
        <button type="button" class="is-active" data-filter="all">Tất cả <span data-count="all">0</span></button>
        <button type="button" data-filter="unread">Chưa đọc <span data-count="unread">0</span></button>
        <button type="button" data-filter="assignment">Bài tập <span data-count="assignment">0</span></button>
        <button type="button" data-filter="discussion">Thảo luận <span data-count="discussion">0</span></button>
        <button type="button" data-filter="meeting">Lịch học <span data-count="meeting">0</span></button>
        <button type="button" data-filter="announcement">Thông báo <span data-count="announcement">0</span></button>
      </div>
      <div class="ou-yeah-course-filter">
        <span>Môn học</span>
        <div class="ou-yeah-course-select">
          <button type="button" data-role="course-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="ou-yeah-course-options">
            <span class="ou-yeah-course-current">
              <span data-role="course-label">Tất cả môn học</span>
              <small data-role="course-code">0 thông báo</small>
            </span>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
          </button>
          <div id="ou-yeah-course-options" class="ou-yeah-course-options" data-role="course-menu" role="listbox" aria-label="Lọc theo môn học" hidden></div>
        </div>
      </div>
      <div class="ou-yeah-filter-empty" data-role="empty" hidden>
        Không có thông báo phù hợp. Thử đổi từ khóa hoặc bộ lọc.
      </div>
    `;

    const search = /** @type {HTMLInputElement} */ (root.querySelector('[data-role="search"]'));
    const clearSearch = /** @type {HTMLButtonElement} */ (root.querySelector('[data-role="clear-search"]'));
    const courseButton = /** @type {HTMLButtonElement} */ (root.querySelector('[data-role="course-button"]'));
    const courseMenu = /** @type {HTMLElement} */ (root.querySelector('[data-role="course-menu"]'));

    search.addEventListener("input", () => {
      searchQuery = normalizeText(search.value);
      clearSearch.hidden = !search.value;
      applyFilters();
    });

    clearSearch.addEventListener("click", () => {
      search.value = "";
      searchQuery = "";
      clearSearch.hidden = true;
      search.focus();
      applyFilters();
    });

    root.querySelector(".ou-yeah-notification-filters").addEventListener("click", (event) => {
      const button = event.target.closest?.("button[data-filter]");
      if (!button) return;
      activeFilter = button.dataset.filter || "all";
      root.querySelectorAll("button[data-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      applyFilters();
    });

    courseButton.addEventListener("click", () => {
      setCourseMenuOpen(courseButton.getAttribute("aria-expanded") !== "true");
    });

    courseButton.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      setCourseMenuOpen(true);
      focusCourseOption(event.key === "ArrowDown" ? 1 : -1);
    });

    courseMenu.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const option = event.target.closest("button[data-course]");
      if (!(option instanceof HTMLButtonElement) || !courseMenu.contains(option)) return;
      activeCourse = option.dataset.course || "all";
      updateCourseSelectionUi();
      setCourseMenuOpen(false);
      courseButton.focus();
      applyFilters();
    });

    courseMenu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCourseMenuOpen(false);
        courseButton.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      focusCourseOption(event.key === "ArrowDown" ? 1 : -1);
    });

    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !root.contains(event.target)) setCourseMenuOpen(false);
    });

    function setCourseMenuOpen(open) {
      courseButton.setAttribute("aria-expanded", String(open));
      courseMenu.hidden = !open;
      root.classList.toggle("ou-yeah-course-menu-open", open);
    }

    function focusCourseOption(direction) {
      window.requestAnimationFrame(() => {
        const options = /** @type {HTMLButtonElement[]} */ (Array.from(courseMenu.querySelectorAll("button[data-course]")));
        if (!options.length) return;
        const currentElement = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
        const currentIndex = currentElement ? options.indexOf(currentElement) : -1;
        const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
        const startIndex = currentIndex >= 0 ? currentIndex : selectedIndex;
        const nextIndex = Math.max(0, Math.min(options.length - 1, startIndex + direction));
        options[nextIndex]?.focus();
      });
    }

    return root;
  }

  function observeList() {
    listObserver?.disconnect();
    listObserver = new MutationObserver(scheduleRefresh);
    listObserver.observe(list, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-label"]
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshNotifications, 60);
  }

  function refreshNotifications() {
    if (!list || !toolbar) return;
    listObserver?.disconnect();

    const items = getItems();
    for (const item of items) annotateItem(item);
    updateCourseOptions(items);
    updateCounts(items);
    applyFilters(items);
    observeList();
  }

  function annotateItem(item) {
    const message = item.querySelector(".notification-message")?.textContent?.replace(/\s+/g, " ").trim() || "Thông báo";
    const timestamp = item.querySelector(".timestamp")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const ariaLabel = item.firstElementChild?.getAttribute("aria-label") || "";
    const course = extractCourse(message);
    const type = classifyNotification(message);
    const isUnread = item.classList.contains("unread") || normalizeText(ariaLabel).includes("chua doc");
    const [courseColor, courseSoft] = colorForCourse(course);

    item.dataset.ouTitle = normalizeText(message);
    item.dataset.ouTimestamp = timestamp;
    item.dataset.ouCourse = course;
    item.dataset.ouType = type;
    item.dataset.ouUnread = String(isUnread);
    item.style.setProperty("--ou-course-color", courseColor);
    item.style.setProperty("--ou-course-soft", courseSoft);
    applyNotificationIcon(item, type, isUnread);

    let meta = item.querySelector(".ou-yeah-notification-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "ou-yeah-notification-meta";
      item.querySelector(".content-item-footer")?.appendChild(meta);
    }

    meta.replaceChildren(
      createBadge(TYPE_LABELS[type], `ou-yeah-type-badge is-${type}`),
      createBadge(course === "general" ? "Toàn hệ thống" : course, "ou-yeah-course-badge")
    );
  }

  function createBadge(text, className) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = text;
    return badge;
  }

  function applyNotificationIcon(item, type, isUnread) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.getURL) {
      item.dataset.ouIconReady = "false";
      return;
    }

    const file = isUnread
      ? UNREAD_ICON_FILE
      : TYPE_ICON_FILES[type] || TYPE_ICON_FILES.system;
    item.dataset.ouIconReady = "true";
    item.dataset.ouIcon = file.replace(/\.svg$/i, "");
    item.style.setProperty("--ou-notification-icon", `url("${runtime.getURL(`src/icons/${file}`)}")`);
  }

  function updateCourseOptions(items) {
    const menu = toolbar?.querySelector('[data-role="course-menu"]');
    if (!menu) return;

    const courseCounts = new Map();
    for (const item of items) {
      const course = item.dataset.ouCourse || "general";
      courseCounts.set(course, (courseCounts.get(course) || 0) + 1);
    }

    const courses = Array.from(courseCounts.entries()).sort(([left], [right]) => {
      if (left === "general") return 1;
      if (right === "general") return -1;
      return left.localeCompare(right);
    });

    const options = [createCourseOption("all", "Tất cả môn học", `${items.length} thông báo`)];
    for (const [course, count] of courses) {
      const label = course === "general" ? "Toàn hệ thống" : courseDisplayName(course);
      const meta = course === "general" ? `${count} thông báo` : `${course} · ${count} thông báo`;
      options.push(createCourseOption(course, label, meta));
    }

    if (activeCourse !== "all" && !courseCounts.has(activeCourse)) activeCourse = "all";
    menu.replaceChildren(...options);
    updateCourseSelectionUi();
  }

  function createCourseOption(value, label, meta) {
    const option = document.createElement("button");
    option.type = "button";
    option.dataset.course = value;
    option.dataset.courseLabel = label;
    option.dataset.courseMeta = meta;
    option.setAttribute("role", "option");
    const title = document.createElement("span");
    title.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = meta;
    option.append(title, detail);
    return option;
  }

  function updateCourseSelectionUi() {
    const button = toolbar?.querySelector('[data-role="course-button"]');
    const label = toolbar?.querySelector('[data-role="course-label"]');
    const code = toolbar?.querySelector('[data-role="course-code"]');
    const options = Array.from(toolbar?.querySelectorAll('[data-role="course-menu"] button[data-course]') || []);
    const selected = options.find((option) => option.dataset.course === activeCourse) || options[0];
    if (!button || !label || !code || !selected) return;

    for (const option of options) {
      const isSelected = option === selected;
      option.setAttribute("aria-selected", String(isSelected));
      option.classList.toggle("is-selected", isSelected);
    }
    label.textContent = selected.dataset.courseLabel || "Tất cả môn học";
    code.textContent = selected.dataset.courseMeta || "";
    button.setAttribute("aria-label", `Lọc theo môn học: ${label.textContent}. ${code.textContent}`);
  }

  function courseDisplayName(course) {
    const baseCode = course.split("-")[0]?.toUpperCase() || course;
    return COURSE_NAMES[baseCode] || course;
  }

  function updateCounts(items) {
    const counts = {
      all: items.length,
      unread: items.filter((item) => item.dataset.ouUnread === "true").length,
      assignment: 0,
      discussion: 0,
      meeting: 0,
      announcement: 0,
      system: 0
    };

    for (const item of items) {
      const type = item.dataset.ouType || "system";
      counts[type] = (counts[type] || 0) + 1;
    }

    toolbar?.querySelectorAll("[data-count]").forEach((element) => {
      element.textContent = String(counts[element.dataset.count] || 0);
    });

    const distinctCourses = new Set(items.map((item) => item.dataset.ouCourse).filter((course) => course && course !== "general"));
    const summary = toolbar?.querySelector('[data-role="summary"]');
    if (summary) {
      summary.textContent = `${items.length} thông báo · ${counts.unread} chưa đọc · ${distinctCourses.size} môn học`;
    }
  }

  function applyFilters(providedItems = null) {
    if (!list || !toolbar) return;
    listObserver?.disconnect();

    const items = providedItems || getItems();
    let visibleCount = 0;
    for (const item of items) {
      const matchesText = !searchQuery
        || `${item.dataset.ouTitle || ""} ${normalizeText(item.dataset.ouCourse || "")}`.includes(searchQuery);
      const matchesCourse = activeCourse === "all" || item.dataset.ouCourse === activeCourse;
      const matchesType = activeFilter === "all"
        || (activeFilter === "unread" && item.dataset.ouUnread === "true")
        || item.dataset.ouType === activeFilter;
      const isVisible = matchesText && matchesCourse && matchesType;

      item.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    }

    rebuildTimeGroups(items);
    const empty = toolbar.querySelector('[data-role="empty"]');
    if (empty) empty.hidden = visibleCount !== 0;
    observeList();
  }

  function rebuildTimeGroups(items) {
    list?.querySelectorAll(".ou-yeah-time-group").forEach((heading) => heading.remove());
    const visibleItems = items.filter((item) => !item.hidden);
    const groupCounts = new Map();

    for (const item of visibleItems) {
      const group = timeGroup(item.dataset.ouTimestamp || "");
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    }

    let previousGroup = "";
    for (const item of visibleItems) {
      const group = timeGroup(item.dataset.ouTimestamp || "");
      if (group === previousGroup) continue;
      previousGroup = group;

      const heading = document.createElement("div");
      heading.className = "ou-yeah-time-group";
      heading.setAttribute("role", "separator");
      const title = document.createElement("span");
      title.textContent = group;
      const count = document.createElement("small");
      count.textContent = String(groupCounts.get(group) || 0);
      heading.append(title, count);
      list?.insertBefore(heading, item);
    }
  }

  function getItems() {
    return Array.from(list?.querySelectorAll(`:scope > ${ITEM_SELECTOR}`) || []);
  }

  function classifyNotification(message) {
    const normalized = normalizeText(message);
    if (/video conference|zoom|google meet|lich hoc|thoi gian to chuc|hop truc tuyen/.test(normalized)) return "meeting";
    if (/tra loi:|thao luan|dien dan|forum|chu de|nhom\s*\d+/.test(normalized)) return "discussion";
    if (/da nop|nop bai|bai tap lon|assignment|quiz|deadline|han nop/.test(normalized)) return "assignment";
    if (/thong bao|announcement|giang vien|thay|co |kiem tra|de lam tot/.test(normalized)) return "announcement";
    return "system";
  }

  function extractCourse(message) {
    return COURSE_RE.exec(message)?.[1]?.toUpperCase() || "general";
  }

  function colorForCourse(course) {
    if (course === "general") return ["#64748b", "rgba(100, 116, 139, 0.10)"];
    let hash = 0;
    for (const character of course) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
  }

  function timeGroup(timestamp) {
    const normalized = normalizeText(timestamp);
    if (/giay|phut|gio|vua xong/.test(normalized)) return "Hôm nay";
    const dayMatch = /(\d+)\s*ngay/.exec(normalized);
    if (dayMatch) {
      const days = Number(dayMatch[1]);
      if (days <= 1) return "Hôm qua";
      if (days <= 7) return "7 ngày qua";
      if (days <= 30) return "30 ngày qua";
    }
    return "Cũ hơn";
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
})();
