(() => {
  "use strict"

  const ELOLMS_HOST = "elolms.ou.edu.vn"
  const CALENDAR_PATH = "/calendar/view.php"
  const DEADLINE_QUERY_KEY = "ouyeah"
  const DEADLINE_QUERY_VALUE = "deadlines"
  const DEADLINE_NAV_ID = "ou-yeah-deadline-nav"
  const DEADLINE_DASHBOARD_ID = "ou-yeah-deadline-dashboard"
  const DEADLINE_LOADING_ID = "ou-yeah-deadline-loading"
  const DEADLINE_STYLE_ID = "ou-yeah-deadline-theme"
  const DEADLINE_CACHE_PREFIX = "ouYeahDeadlineCacheV1"
  const DEADLINE_CACHE_VERSION = 1
  const DEADLINE_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000
  const DEADLINE_METADATA_TTL = 30 * 60 * 1000
  const COURSE_INDEX_TTL = 12 * 60 * 60 * 1000
  const COMPLETED_STATUS_TTL = 7 * 24 * 60 * 60 * 1000
  const PENDING_STATUS_TTL = 30 * 60 * 1000
  const DUE_SOON_STATUS_TTL = 5 * 60 * 1000
  const OVERDUE_FORUM_STATUS_TTL = 15 * 60 * 1000
  const OVERDUE_ACTIVITY_STATUS_TTL = 24 * 60 * 60 * 1000
  const TEMPORARY_MEETING_RETENTION = 7 * 24 * 60 * 60 * 1000
  const REQUEST_CONCURRENCY = 4
  const FORUM_DISCUSSION_CONCURRENCY = 3
  const BRAND = "#5269c7"

  if (location.hostname !== ELOLMS_HOST || window.top !== window.self) return

  let renderTimer = 0
  let currentUserNamePromise = null
  const forumCompletionCache = new Map()
  const activityCompletionCache = new Map()
  const deadlineDashboardStates = new WeakMap()

  injectDeadlineTheme()
  if (isDeadlineView()) showDeadlineLoading()
  scheduleDeadlineEnhancement()

  document.addEventListener("DOMContentLoaded", scheduleDeadlineEnhancement, { once: true })
  window.addEventListener("pageshow", scheduleDeadlineEnhancement, { passive: true })

  function scheduleDeadlineEnhancement() {
    window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(() => {
      ensureDeadlineNavItem()
      if (isDeadlineView()) enhanceDeadlinePage()
    }, 120)
  }

  function isDeadlineView() {
    return location.pathname.toLowerCase() === CALENDAR_PATH
      && new URLSearchParams(location.search).get(DEADLINE_QUERY_KEY) === DEADLINE_QUERY_VALUE
  }

  function ensureDeadlineNavItem() {
    if (document.getElementById(DEADLINE_NAV_ID)) {
      updateDeadlineNavState()
      return
    }

    const navigation = findPrimaryNavigation()
    if (!navigation) return

    const coursesLink = Array.from(navigation.querySelectorAll("a")).find((link) => {
      const text = normalizeText(link.textContent)
      return text.includes("cac khoa hoc cua toi") || text.includes("cac khoa hoc")
    })
    if (!coursesLink) return

    const item = document.createElement("li")
    item.id = DEADLINE_NAV_ID
    item.className = coursesLink.closest("li")?.className || "nav-item"
    item.classList.remove("active")

    const link = document.createElement("a")
    link.className = coursesLink.className || "nav-link"
    link.classList.remove("active")
    link.href = buildDeadlineUrl().toString()
    link.textContent = "Deadline"
    link.title = "Xem deadline sắp tới"
    link.setAttribute("aria-label", "Xem deadline sắp tới")
    item.append(link)

    const coursesItem = coursesLink.closest("li")
    if (coursesItem?.parentElement) coursesItem.insertAdjacentElement("afterend", item)
    else navigation.append(item)

    updateDeadlineNavState()
  }

  function findPrimaryNavigation() {
    const candidates = Array.from(document.querySelectorAll(
      "#nav-main .moremenu > ul, #nav-main .moremenu ul.navbar-nav, nav#navbar .moremenu > ul, .primary-navigation .moremenu > ul, nav, .moremenu, [class*='moremenu'], ul.navbar-nav"
    ))
    return candidates.find((candidate) => Array.from(candidate.querySelectorAll("a")).some((link) => {
      const text = normalizeText(link.textContent)
      return text.includes("cac khoa hoc cua toi") || text.includes("cac khoa hoc")
    })) || null
  }

  function buildDeadlineUrl() {
    const url = new URL(CALENDAR_PATH, location.origin)
    url.searchParams.set("view", "upcoming")
    url.searchParams.set(DEADLINE_QUERY_KEY, DEADLINE_QUERY_VALUE)
    return url
  }

  function updateDeadlineNavState() {
    const item = document.getElementById(DEADLINE_NAV_ID)
    const link = item?.querySelector("a")
    if (!(item instanceof HTMLElement) || !(link instanceof HTMLAnchorElement)) return

    const active = isDeadlineView()
    item.classList.toggle("active", active)
    link.classList.toggle("active", active)
    if (active) link.setAttribute("aria-current", "page")
    else link.removeAttribute("aria-current")
  }

  function enhanceDeadlinePage() {
    if (!(document.body instanceof HTMLElement)) return
    document.body.classList.add("ou-yeah-deadline-page")
    updateDeadlineNavState()

    if (document.getElementById(DEADLINE_DASHBOARD_ID)) {
      const existingRegion = document.querySelector("#region-main")
      if (existingRegion instanceof HTMLElement) hideNativeCalendarControls(existingRegion)
      hideDeadlineLoading()
      return
    }

    const region = document.querySelector("#region-main")
    if (!(region instanceof HTMLElement)) {
      hideDeadlineLoading()
      return
    }

    hideNativeCalendarControls(region)
    const eventItems = findEventItems(region)
    const nativeEvents = eventItems
      .map(extractEvent)
      .filter((event) => event)
      .sort(compareEvents)

    const dashboard = createDeadlineDashboard(nativeEvents)
    const nativeList = findEventList(region, eventItems)
    if (nativeList instanceof HTMLElement) {
      nativeList.hidden = true
      nativeList.insertAdjacentElement("beforebegin", dashboard)
    } else {
      region.append(dashboard)
    }

    hideNativeCalendarControls(region)
    eventItems.forEach((item) => {
      if (item instanceof HTMLElement) item.hidden = true
    })
    hideDeadlineLoading()
    setDeadlineSyncStatus(dashboard, "Đang đọc dữ liệu đã lưu...")
    refreshDeadlineDashboard(dashboard, nativeEvents).catch(() => {
      setDeadlineSyncStatus(dashboard, "Không thể đồng bộ lúc này · đang hiển thị dữ liệu gần nhất")
    })
  }

  function hideNativeCalendarControls(region) {
    const dashboard = document.getElementById(DEADLINE_DASHBOARD_ID)
    const pageHeader = document.querySelector("#page-header")
    if (pageHeader instanceof HTMLElement) forceHideDeadlineElement(pageHeader)

    const viewDropdown = region.querySelector("#calendarviewdropdown")
    const courseFilter = region.querySelector("#calendar-course-filter")
    const newEventButton = Array.from(region.querySelectorAll("a, button")).find((element) => {
      return normalizeText(element.textContent).toLowerCase() === "su kien moi"
    })
    const controlNodes = [viewDropdown, courseFilter, newEventButton]
      .filter((node) => node instanceof HTMLElement)

    if (controlNodes.length) {
      let controlsRoot = controlNodes[0].parentElement
      while (controlsRoot && controlsRoot !== region) {
        const containsAllControls = controlNodes.every((node) => controlsRoot.contains(node))
        const containsDashboard = dashboard instanceof HTMLElement && controlsRoot.contains(dashboard)
        if (containsAllControls && !containsDashboard) break
        controlsRoot = controlsRoot.parentElement
      }

      if (controlsRoot && controlsRoot !== region) forceHideDeadlineElement(controlsRoot)
      else controlNodes.forEach(forceHideDeadlineElement)
    }

    const nativeHeading = Array.from(region.querySelectorAll("h2, h3, h4")).find((heading) => {
      return !heading.closest(`#${DEADLINE_DASHBOARD_ID}`)
        && normalizeText(heading.textContent).toLowerCase() === "su kien sap den"
    })
    if (nativeHeading instanceof HTMLElement) forceHideDeadlineElement(nativeHeading)

    const manageSubscriptions = region.querySelector('a[href*="/calendar/managesubscriptions.php"]')
    if (manageSubscriptions instanceof HTMLElement) forceHideDeadlineElement(manageSubscriptions)
  }

  function forceHideDeadlineElement(element) {
    if (!(element instanceof HTMLElement)) return
    element.hidden = true
    element.setAttribute("aria-hidden", "true")
    element.style.setProperty("display", "none", "important")
  }

  function showDeadlineLoading() {
    const root = document.documentElement
    if (!(root instanceof HTMLElement) || document.getElementById(DEADLINE_LOADING_ID)) return

    root.classList.add("ou-yeah-deadline-loading")
    const loading = document.createElement("div")
    loading.id = DEADLINE_LOADING_ID
    loading.setAttribute("role", "status")
    loading.setAttribute("aria-live", "polite")
    loading.innerHTML = `
      <div class="ou-deadline-loading-card">
        <strong class="ou-deadline-loading-title">Đang chuẩn bị lịch, vui lòng chờ...</strong>
        <span class="ou-deadline-loading-progress" aria-hidden="true"><span></span></span>
      </div>
    `
    root.append(loading)
  }

  function hideDeadlineLoading() {
    document.getElementById(DEADLINE_LOADING_ID)?.remove()
    document.documentElement?.classList.remove("ou-yeah-deadline-loading")
  }

  async function refreshDeadlineDashboard(dashboard, nativeEvents, forceMetadata = false) {
    const state = deadlineDashboardStates.get(dashboard)
    if (!state || state.isSyncing) return
    state.isSyncing = true
    setDeadlineRefreshBusy(dashboard, true)
    try {
      await synchronizeDeadlineDashboard(dashboard, nativeEvents, forceMetadata)
    } finally {
      state.isSyncing = false
      setDeadlineRefreshBusy(dashboard, false)
    }
  }

  async function synchronizeDeadlineDashboard(dashboard, nativeEvents, forceMetadata) {
    const cache = await readDeadlineCache()
    const cachedEvents = cache.events
    let events = applyCachedCompletion(mergeEvents(cachedEvents, nativeEvents), cachedEvents)
    let metadataUpdatedAt = cache.metadataUpdatedAt
    let courseUrls = cache.courseUrls
    let courseUrlsUpdatedAt = cache.courseUrlsUpdatedAt
    let metadataFullyUpdated = true
    let latestSavedAt = cache.savedAt

    if (events.length) {
      updateDeadlineDashboardEvents(dashboard, events)
      if (cache.savedAt) {
        setDeadlineSyncStatus(dashboard, `Đang dùng dữ liệu đã lưu lúc ${formatDeadlineSyncTime(cache.savedAt)} · kiểm tra thay đổi trong nền...`)
      }
    }

    const metadataIsFresh = !forceMetadata
      && metadataUpdatedAt > 0
      && Date.now() - metadataUpdatedAt < DEADLINE_METADATA_TTL

    if (!metadataIsFresh) {
      setDeadlineSyncStatus(dashboard, "Đang cập nhật lịch và deadline mới...")
      const metadata = await fetchDeadlineMetadata(cache, (partialEvents, completedSources, totalSources) => {
        const preview = applyCachedCompletion(
          mergeEvents(partialEvents, mergeEvents(cachedEvents, nativeEvents)),
          cachedEvents
        )
        updateDeadlineDashboardEvents(dashboard, preview)
        setDeadlineSyncStatus(dashboard, `Đang cập nhật dữ liệu ${completedSources}/${totalSources}...`)
      })
      courseUrls = metadata.courseUrls
      courseUrlsUpdatedAt = metadata.courseUrlsUpdatedAt
      metadataFullyUpdated = metadata.courseIndexSucceeded
        && metadata.successfulSources === metadata.totalSources
      if (metadataFullyUpdated) metadataUpdatedAt = Date.now()
      const metadataFallback = metadataFullyUpdated ? nativeEvents : mergeEvents(cachedEvents, nativeEvents)
      const knownMeetings = mergeEvents(cachedEvents, nativeEvents).filter((event) => event.kind === "meeting")
      events = applyCachedCompletion(
        retainMissingMeetingsTemporarily(mergeEvents(metadata.events, metadataFallback), knownMeetings),
        cachedEvents
      )
      updateDeadlineDashboardEvents(dashboard, events)
      latestSavedAt = await writeDeadlineCache({ events, metadataUpdatedAt, courseUrls, courseUrlsUpdatedAt })
    }

    const staleStatusCount = countStaleCompletionChecks(events)
    if (staleStatusCount > 0) {
      setDeadlineSyncStatus(dashboard, `Đang kiểm tra trạng thái hoàn thành 0/${staleStatusCount}...`)
      await refreshActivityCompletion(events, (completedChecks, totalChecks) => {
        updateDeadlineDashboardEvents(dashboard, events)
        setDeadlineSyncStatus(dashboard, `Đang kiểm tra trạng thái hoàn thành ${completedChecks}/${totalChecks}...`)
      })
      latestSavedAt = await writeDeadlineCache({ events, metadataUpdatedAt, courseUrls, courseUrlsUpdatedAt })
    }

    updateDeadlineDashboardEvents(dashboard, events)
    setDeadlineSyncStatus(dashboard, metadataFullyUpdated
      ? `Đã đồng bộ lúc ${formatDeadlineSyncTime(latestSavedAt || Date.now())}`
      : `Đồng bộ chưa hoàn tất lúc ${formatDeadlineSyncTime(latestSavedAt || Date.now())} · đang giữ dữ liệu gần nhất`)
  }

  async function fetchDeadlineMetadata(cache, onProgress) {
    const courseIndex = await discoverCourseUrls(cache.courseUrls, cache.courseUrlsUpdatedAt)
    const courseUrls = courseIndex.urls
    const totalSources = courseUrls.length + 1
    let completedSources = 0
    let successfulSources = 0
    let events = []

    const collect = (result) => {
      events = mergeEvents(events, result.events)
      if (result.succeeded) successfulSources += 1
      completedSources += 1
      onProgress?.(events, completedSources, totalSources)
    }

    await Promise.all([
      mapWithConcurrency(courseUrls, REQUEST_CONCURRENCY, async (courseUrl) => {
        collect(await fetchCourseDeadlineSource(courseUrl))
      }),
      fetchCalendarEventSource(new Date()).then(collect)
    ])

    return {
      events,
      courseUrls,
      courseUrlsUpdatedAt: courseIndex.updatedAt,
      courseIndexSucceeded: courseIndex.succeeded,
      successfulSources,
      totalSources
    }
  }

  function mergeEvents(courseEvents, nativeEvents) {
    const unique = new Map()

    courseEvents.concat(nativeEvents).forEach((event) => {
      if (!(event?.date instanceof Date)) return
      const key = eventIdentityKey(event)
      if (!unique.has(key)) unique.set(key, event)
    })

    return Array.from(unique.values()).sort(compareEvents)
  }

  function eventIdentityKey(event) {
    return `${event.date.getTime()}|${normalizeText(event.title)}|${normalizeText(event.course)}`
  }

  function retainMissingMeetingsTemporarily(events, knownMeetings) {
    const now = Date.now()
    const currentKeys = new Set(events.map(eventIdentityKey))
    const retained = knownMeetings
      .filter((event) => {
        if (event.kind !== "meeting") return false
        const fallbackUntil = event.date.getTime() + TEMPORARY_MEETING_RETENTION
        const temporaryUntil = Number(event.temporaryUntil) || fallbackUntil
        return temporaryUntil > now && !currentKeys.has(eventIdentityKey(event))
      })
      .map((event) => ({
        ...event,
        temporary: true,
        temporaryUntil: Number(event.temporaryUntil) || event.date.getTime() + TEMPORARY_MEETING_RETENTION
      }))

    return mergeEvents(events, retained)
  }

  async function discoverCourseUrls(cachedUrls = [], cachedAt = 0) {
    const urls = new Set(cachedUrls.filter((value) => isSameOriginCourseUrl(value)))
    let updatedAt = cachedAt
    collectCourseUrlsFromDocument(document, urls)

    if (urls.size && cachedAt > 0 && Date.now() - cachedAt < COURSE_INDEX_TTL) {
      return { urls: Array.from(urls), updatedAt: cachedAt, succeeded: true }
    }

    let succeeded = false
    try {
      const response = await fetch(`${location.origin}/my/`, { credentials: "include" })
      if (response.ok) {
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, "text/html")
        collectCourseUrlsFromDocument(doc, urls)
        updatedAt = Date.now()
        succeeded = true
      }
    } catch {
      // The visible calendar events remain a safe fallback when the course index cannot load.
    }

    return { urls: Array.from(urls), updatedAt, succeeded }
  }

  function isSameOriginCourseUrl(value) {
    try {
      const url = new URL(value, location.origin)
      return url.origin === location.origin
        && url.pathname.toLowerCase() === "/course/view.php"
        && Boolean(url.searchParams.get("id"))
    } catch {
      return false
    }
  }

  function emptyDeadlineCache() {
    return {
      events: [],
      metadataUpdatedAt: 0,
      courseUrls: [],
      courseUrlsUpdatedAt: 0,
      savedAt: 0
    }
  }

  async function readDeadlineCache() {
    const cached = await deadlineStorageGet(deadlineCacheStorageKey())
    if (!cached || cached.version !== DEADLINE_CACHE_VERSION) return emptyDeadlineCache()

    const savedAt = Number(cached.savedAt) || 0
    if (!savedAt || Date.now() - savedAt > DEADLINE_CACHE_MAX_AGE) return emptyDeadlineCache()

    return {
      events: deserializeDeadlineEvents(cached.events),
      metadataUpdatedAt: Number(cached.metadataUpdatedAt) || 0,
      courseUrls: Array.isArray(cached.courseUrls)
        ? cached.courseUrls.filter((value) => isSameOriginCourseUrl(value))
        : [],
      courseUrlsUpdatedAt: Number(cached.courseUrlsUpdatedAt) || 0,
      savedAt
    }
  }

  async function writeDeadlineCache({ events, metadataUpdatedAt, courseUrls, courseUrlsUpdatedAt }) {
    const savedAt = Date.now()
    await deadlineStorageSet({
      [deadlineCacheStorageKey()]: {
        version: DEADLINE_CACHE_VERSION,
        savedAt,
        metadataUpdatedAt: Number(metadataUpdatedAt) || 0,
        courseUrlsUpdatedAt: Number(courseUrlsUpdatedAt) || 0,
        courseUrls: Array.from(new Set((courseUrls || []).filter((value) => isSameOriginCourseUrl(value)))),
        events: serializeDeadlineEvents(events)
      }
    })
    return savedAt
  }

  function deadlineCacheStorageKey() {
    const userMenu = document.querySelector(".usermenu, [data-region='user-menu'], .userbutton")
    const profileLink = userMenu?.querySelector('a[href*="/user/profile.php"], a[href*="/user/view.php"]')
    let profileId
    try {
      profileId = profileLink instanceof HTMLAnchorElement
        ? new URL(profileLink.href, location.origin).searchParams.get("id") || ""
        : ""
    } catch {
      profileId = ""
    }
    const avatar = userMenu?.querySelector("img[alt]")
    const visibleIdentity = cleanText(
      userMenu?.querySelector(".usertext, .user-name, [data-region='user-menu-toggle']")?.textContent
      || avatar?.getAttribute("alt")
      || "active-session"
    )
    return `${DEADLINE_CACHE_PREFIX}:${hashText(`${location.origin}|${profileId}|${visibleIdentity}`)}`
  }

  function serializeDeadlineEvents(events) {
    return mergeEvents(events || [], []).map((event) => ({
      title: String(event.title || ""),
      course: String(event.course || ""),
      date: event.date.toISOString(),
      href: String(event.href || ""),
      kind: event.kind === "meeting" ? "meeting" : "deadline",
      completed: event.completed === true,
      completionCheckedAt: Number(event.completionCheckedAt) || 0,
      temporary: event.temporary === true,
      temporaryUntil: Number(event.temporaryUntil) || 0
    }))
  }

  function deserializeDeadlineEvents(values) {
    if (!Array.isArray(values)) return []
    return values.map((value) => {
      const date = new Date(value?.date)
      if (!value || !value.title || Number.isNaN(date.getTime())) return null
      return {
        title: String(value.title),
        course: String(value.course || "Không rõ môn học"),
        date,
        dateLabel: formatDate(date),
        time: formatTime(date),
        href: String(value.href || ""),
        kind: value.kind === "meeting" ? "meeting" : "deadline",
        completed: value.completed === true,
        completionCheckedAt: Number(value.completionCheckedAt) || 0,
        temporary: value.temporary === true,
        temporaryUntil: Number(value.temporaryUntil) || 0,
        source: null
      }
    }).filter(Boolean).sort(compareEvents)
  }

  function applyCachedCompletion(events, cachedEvents) {
    const cachedByUrl = new Map()
    cachedEvents.forEach((event) => {
      if (!needsRemoteCompletionCheck(event.href)) return
      const previous = cachedByUrl.get(event.href)
      cachedByUrl.set(event.href, {
        completed: previous?.completed === true || event.completed === true,
        completionCheckedAt: Math.max(
          Number(previous?.completionCheckedAt) || 0,
          Number(event.completionCheckedAt) || 0
        )
      })
    })

    events.forEach((event) => {
      if (!needsRemoteCompletionCheck(event.href)) return
      const cached = cachedByUrl.get(event.href)
      if (!cached) return
      event.completed = event.completed === true || cached.completed === true
      event.completionCheckedAt = Math.max(
        Number(event.completionCheckedAt) || 0,
        Number(cached.completionCheckedAt) || 0
      )
    })
    return events
  }

  function countStaleCompletionChecks(events) {
    return new Set(events
      .filter((event) => shouldRefreshCompletion(event))
      .map((event) => event.href)
      .filter(Boolean)).size
  }

  function shouldRefreshCompletion(event) {
    if (!needsRemoteCompletionCheck(event.href)) return false
    const checkedAt = Number(event.completionCheckedAt) || 0
    if (!checkedAt) return true
    return Date.now() - checkedAt >= completionRefreshTtl(event)
  }

  function completionRefreshTtl(event) {
    if (event.completed === true) return COMPLETED_STATUS_TTL
    const remaining = event.date.getTime() - Date.now()
    if (remaining < 0) {
      return /\/mod\/forum\//i.test(event.href || "")
        ? OVERDUE_FORUM_STATUS_TTL
        : OVERDUE_ACTIVITY_STATUS_TTL
    }
    return remaining <= 3 * 24 * 60 * 60 * 1000
      ? DUE_SOON_STATUS_TTL
      : PENDING_STATUS_TTL
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length)
    let nextIndex = 0
    const workerCount = Math.min(Math.max(1, limit), items.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index], index)
      }
    })
    await Promise.all(workers)
    return results
  }

  function deadlineStorageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (result) => {
          try {
            if (chrome.runtime.lastError) resolve(null)
            else resolve(result?.[key] || null)
          } catch {
            resolve(null)
          }
        })
      } catch {
        resolve(null)
      }
    })
  }

  function deadlineStorageSet(values) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(values, () => {
          try { void chrome.runtime.lastError } catch { /* Extension reload: cache is best-effort. */ }
          resolve()
        })
      } catch {
        resolve()
      }
    })
  }

  function formatDeadlineSyncTime(timestamp) {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp))
  }

  function collectCourseUrlsFromDocument(doc, urls) {
    doc.querySelectorAll('a[href*="/course/view.php?id="]').forEach((link) => {
      try {
        const url = new URL(link.href, location.origin)
        if (url.origin === location.origin && url.pathname.toLowerCase() === "/course/view.php" && url.searchParams.get("id")) {
          url.hash = ""
          urls.add(url.toString())
        }
      } catch {
        // Ignore malformed navigation items.
      }
    })

    doc.querySelectorAll("#calendar-course-filter option[value], [id^='calendar-course-filter'] option[value]").forEach((option) => {
      const value = option.getAttribute("value") || ""
      if (!/^\d+$/.test(value) || value === "0") return
      const url = new URL("/course/view.php", location.origin)
      url.searchParams.set("id", value)
      urls.add(url.toString())
    })
  }

  async function fetchCourseDeadlineSource(courseUrl) {
    try {
      const response = await fetch(courseUrl, { credentials: "include" })
      if (!response.ok) return { events: [], succeeded: false }
      const html = await response.text()
      const events = parseCourseDeadlines(html, courseUrl)
      return { events, succeeded: true }
    } catch {
      return { events: [], succeeded: false }
    }
  }

  async function getCurrentUserName() {
    if (currentUserNamePromise) return currentUserNamePromise
    currentUserNamePromise = (async () => {
      try {
        const response = await fetch(`${location.origin}/user/profile.php`, { credentials: "include" })
        if (!response.ok) return ""
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, "text/html")
        return cleanText(doc.querySelector(".page-header-headings h1, .userprofile h1, header h1, h1")?.textContent || "")
      } catch {
        return ""
      }
    })()
    return currentUserNamePromise
  }

  async function enrichActivityCompletion(events) {
    await refreshActivityCompletion(events)
  }

  function needsRemoteCompletionCheck(url) {
    return /\/mod\/(assign|quiz|forum)\//i.test(url || "")
  }

  async function refreshActivityCompletion(events, onProgress) {
    const staleUrls = new Set(events
      .filter((event) => shouldRefreshCompletion(event))
      .map((event) => event.href)
      .filter(Boolean))
    const groupedByUrl = new Map()
    events.filter((event) => staleUrls.has(event.href)).forEach((event) => {
      if (!groupedByUrl.has(event.href)) groupedByUrl.set(event.href, [])
      groupedByUrl.get(event.href).push(event)
    })
    const groups = Array.from(groupedByUrl, ([href, matchingEvents]) => ({ href, events: matchingEvents }))
    if (!groups.length) return 0

    let completedChecks = 0

    await mapWithConcurrency(groups, REQUEST_CONCURRENCY, async (group) => {
      const isForum = /\/mod\/forum\//i.test(group.href)
      const userName = isForum ? await getCurrentUserName() : ""
      const completed = isForum
        ? Boolean(userName) && await checkForumParticipation(group.href, userName, true)
        : await checkActivitySubmission(group.href, true)
      const checkedAt = Date.now()
      group.events.forEach((event) => {
        event.completed = event.completed === true || completed
        event.completionCheckedAt = checkedAt
      })
      completedChecks += 1
      onProgress?.(completedChecks, groups.length)
    })

    return groups.length
  }

  function checkActivitySubmission(activityUrl, force = false) {
    if (!activityUrl) return Promise.resolve(false)
    if (force) activityCompletionCache.delete(activityUrl)
    if (activityCompletionCache.has(activityUrl)) return activityCompletionCache.get(activityUrl)

    const check = (async () => {
      try {
        const response = await fetch(activityUrl, { credentials: "include" })
        if (!response.ok) return false
        const doc = new DOMParser().parseFromString(await response.text(), "text/html")
        const normalizedUrl = activityUrl.toLowerCase()
        const text = normalizeText(doc.body?.textContent || "")
        if (normalizedUrl.includes("/mod/assign/")) return assignmentHasSubmission(doc, text)
        if (normalizedUrl.includes("/mod/quiz/")) return quizHasSubmission(doc, text)
        return false
      } catch {
        return false
      }
    })()
    activityCompletionCache.set(activityUrl, check)
    return check
  }

  function assignmentHasSubmission(doc, normalizedText) {
    if (/da nop de cham diem|submitted for grading|trang thai bai nop[^.]{0,80}da nop|submission status[^.]{0,80}submitted/.test(normalizedText)) return true
    const submissionRegion = doc.querySelector('[data-region="submission-status"], .submissionstatus, .submission-status, .submissionstatussubmitted')
    if (!submissionRegion) return false
    const statusText = normalizeText(`${submissionRegion.textContent || ""} ${submissionRegion.getAttribute("aria-label") || ""} ${submissionRegion.getAttribute("title") || ""}`)
    return /da nop|submitted|grading/.test(statusText)
  }

  function quizHasSubmission(doc, normalizedText) {
    if (doc.querySelector('a[href*="/mod/quiz/review.php?attempt="]')) return true

    const attemptRegions = Array.from(doc.querySelectorAll(
      '.quizattemptsummary, .quizreviewsummary, .quizattempt, [id*="quiz_attempt"], [data-region*="attempt"]'
    ))
    const attemptText = normalizeText(attemptRegions.map((node) => node.textContent || "").join(" "))
    if (attemptText) {
      if (/no attempts|chua co lan lam|attempts 0|0 attempts|so lan lam bai 0|lan lam bai 0/.test(attemptText)) return false
      if (/finished|completed|submitted|da hoan thanh|da nop/.test(attemptText)) return true
    }

    return /(?:attempt summary|attempts summary|ket qua lan lam).*(?:finished|completed|submitted|da hoan thanh|da nop)/.test(normalizedText)
      && !/no attempts|chua co lan lam|attempts 0|0 attempts|so lan lam bai 0|lan lam bai 0/.test(normalizedText)
  }

  function checkForumParticipation(forumUrl, userName, force = false) {
    if (!forumUrl) return Promise.resolve(false)
    if (force) forumCompletionCache.delete(forumUrl)
    if (forumCompletionCache.has(forumUrl)) return forumCompletionCache.get(forumUrl)

    const check = (async () => {
      try {
        const forumResponse = await fetch(forumUrl, { credentials: "include" })
        if (!forumResponse.ok) return false
        const forumHtml = await forumResponse.text()
        const forumDoc = new DOMParser().parseFromString(forumHtml, "text/html")
        const discussionUrls = Array.from(new Set(Array.from(forumDoc.querySelectorAll('a[href*="/mod/forum/discuss.php"]'))
          .map((link) => {
            const href = link.getAttribute("href")
            if (!href) return ""
            try {
              const url = new URL(href, location.origin)
              return url.origin === location.origin ? url.toString() : ""
            } catch {
              return ""
            }
          })
          .filter(Boolean)))
        if (!discussionUrls.length) return false

        const normalizedUserName = normalizeText(userName)
        const limitedUrls = discussionUrls.slice(0, 24)
        for (let offset = 0; offset < limitedUrls.length; offset += FORUM_DISCUSSION_CONCURRENCY) {
          const batch = limitedUrls.slice(offset, offset + FORUM_DISCUSSION_CONCURRENCY)
          const matches = await mapWithConcurrency(batch, FORUM_DISCUSSION_CONCURRENCY, async (discussionUrl) => {
            try {
              const response = await fetch(discussionUrl, { credentials: "include" })
              if (!response.ok) return false
              const doc = new DOMParser().parseFromString(await response.text(), "text/html")
              return forumDocumentHasVisiblePost(doc, normalizedUserName)
            } catch {
              return false
            }
          })
          if (matches.some(Boolean)) return true
        }
        return false
      } catch {
        return false
      }
    })()
    forumCompletionCache.set(forumUrl, check)
    return check
  }

  function forumDocumentHasVisiblePost(doc, normalizedUserName) {
    const postSelectors = [
      ".forumpost",
      ".forum-post",
      "[data-region='post']",
      ".post"
    ]
    const posts = Array.from(new Set(postSelectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)))))
    if (posts.length) return posts.some((post) => normalizeText(post.textContent).includes(normalizedUserName))
    return normalizeText(doc.body?.textContent || "").includes(normalizedUserName)
  }

  async function fetchCalendarEventsForMonth(monthDate, includeCompletion = true) {
    const result = await fetchCalendarEventSource(monthDate)
    if (includeCompletion) await enrichActivityCompletion(result.events)
    return result.events
  }

  async function fetchCalendarEventSource(monthDate) {
    try {
      const url = new URL(CALENDAR_PATH, location.origin)
      url.searchParams.set("view", "month")
      url.searchParams.set("time", String(Math.floor(monthDate.getTime() / 1000)))
      const response = await fetch(url, { credentials: "include" })
      if (!response.ok) return { events: [], succeeded: false }
      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, "text/html")
      const events = findEventItems(doc).map(extractEvent).filter((event) => event).sort(compareEvents)
      return { events, succeeded: true }
    } catch {
      return { events: [], succeeded: false }
    }
  }

  function parseCourseDeadlines(html, courseUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html")
    const fallbackCourse = cleanText(doc.querySelector(".page-header-headings h1, header h1, h1")?.textContent || "Không rõ môn học")
    const activityItems = Array.from(doc.querySelectorAll(".activity-item, li.activity, .activity"))
    const uniqueItems = activityItems.filter((item, index) => activityItems.indexOf(item) === index
      && !activityItems.some((parent) => parent !== item && parent.contains(item)))
    const events = []

    uniqueItems.forEach((item) => {
      const text = cleanText(item.textContent)
      if (!/deadline/i.test(text)) return

      const deadlinePattern = /Deadline\s+(?:(?:Thứ|Chủ Nhật)[^,]*,\s*)?(\d{1,2})\s+tháng\s+(\d{1,2})\s+(\d{4}),\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM|SA|CH|A\.M\.|P\.M\.))?/gi
      const titleLink = /** @type {HTMLAnchorElement | null} */ (item.querySelector("a[href*='/mod/'][href*='view.php']"))
      const titleElement = item.querySelector(".instancename, .activityname, h3, h4")
      const title = cleanEventTitle(titleElement?.textContent || titleLink?.textContent || "Deadline")
      const href = titleLink?.href ? new URL(titleLink.href, courseUrl).toString() : courseUrl
      const course = cleanText(doc.querySelector(".page-header-headings h1, header h1")?.textContent || fallbackCourse)
      const completed = needsRemoteCompletionCheck(href) ? false : detectActivityCompletion(item)

      for (const match of text.matchAll(deadlinePattern)) {
        const hour = to24Hour(match[4], match[6])
        if (hour === null) continue
        const date = new Date(
          Number(match[3]),
          Number(match[2]) - 1,
          Number(match[1]),
          hour,
          Number(match[5])
        )
        if (Number.isNaN(date.getTime())) continue
        events.push({
          title,
          course,
          date,
          dateLabel: formatDate(date),
          time: formatTime(date),
          href,
          kind: "deadline",
          completed,
          source: item
        })
      }
    })

    return events
  }

  function detectActivityCompletion(item) {
    const completionNodes = Array.from(item.querySelectorAll(
      '[data-region="completion-info"], .activity-completion, .completion-info, .completioninfo, .submissionstatus, .submissionstatussubmitted'
    ))
    if (!completionNodes.length) return false

    const completionText = normalizeText(completionNodes.map((node) => {
      const altText = Array.from(node.querySelectorAll("[alt]"))
        .map((element) => element.getAttribute("alt") || "")
        .join(" ")
      return `${node.textContent || ""} ${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.getAttribute("alt") || ""} ${altText}`
    }).join(" "))
    if (/chua hoan thanh|not complete|incomplete|not done|chua nop/.test(completionText)) return false
    if (/da hoan thanh|completed|done|submitted|da nop|finished/.test(completionText)) return true

    return completionNodes.some((node) => node.querySelector('[aria-pressed="true"], .fa-check, .icon-check, .completion-icon.completed'))
  }

  function findEventItems(region) {
    const selectors = [
      '[data-region="event-list-item"]',
      ".eventlist .event",
      ".eventlist > .card",
      ".eventlist > li",
      ".calendar_event"
    ]
    const candidates = selectors.flatMap((selector) => Array.from(region.querySelectorAll(selector)))
    const unique = Array.from(new Set(candidates))
    if (unique.length) return unique.filter((item) => !unique.some((parent) => parent !== item && parent.contains(item)))

    const activityLinks = Array.from(region.querySelectorAll('a[href*="/mod/"]'))
    return Array.from(new Set(activityLinks.map((link) => findEventItemForLink(link)).filter(Boolean)))
  }

  function findEventItemForLink(link) {
    return link.closest(
      '[data-region="event-list-item"], .event, .calendar_event, .eventlist > .card, .eventlist > li'
    ) || link.parentElement
  }

  function findEventList(region, eventItems) {
    const nativeList = region.querySelector(".eventlist")
    if (nativeList) return nativeList
    const firstItem = eventItems[0]
    return firstItem?.parentElement
  }

  function extractEvent(item) {
    if (!(item instanceof HTMLElement)) return null

    const titleElement = item.querySelector(
      "h3, h4, .name, .event-name, [data-region='event-name']"
    )
    const title = cleanEventTitle(titleElement?.textContent || "")
    const courseLink = item.querySelector('a[href*="/course/view.php"]')
    const dayLink = item.querySelector('a[href*="/calendar/view.php"][href*="time="]')
    const activityLinks = /** @type {HTMLAnchorElement[]} */ (Array.from(item.querySelectorAll("a[href*='/mod/']")))
    const activityLink = activityLinks
      .find((link) => !link.href.includes("/course/view.php"))
    const date = parseEventDate(dayLink)

    if (!title || !date) return null

    return {
      title,
      course: cleanText(courseLink?.textContent || "Không rõ môn học"),
      date,
      dateLabel: formatDate(date),
      time: formatTime(date),
      href: activityLink?.href || "",
      kind: classifyEventKind(title),
      completed: needsRemoteCompletionCheck(activityLink?.href) ? false : detectActivityCompletion(item),
      source: item
    }
  }

  function parseEventDate(dayLink) {
    if (!(dayLink instanceof HTMLAnchorElement)) return null
    try {
      const time = Number(new URL(dayLink.href).searchParams.get("time"))
      if (!Number.isFinite(time)) return null
      return new Date(time * 1000)
    } catch {
      return null
    }
  }

  function classifyEventKind(title) {
    return /video conference|google meet|zoom|meeting|\bvc\s*\d+\b/i.test(normalizeText(title))
      ? "meeting"
      : "deadline"
  }

  function compareEvents(left, right) {
    return left.date - right.date || left.time.localeCompare(right.time) || left.title.localeCompare(right.title, "vi")
  }

  function createDeadlineDashboard(events) {
    const dashboard = document.createElement("section")
    dashboard.id = DEADLINE_DASHBOARD_ID
    dashboard.setAttribute("aria-labelledby", "ou-yeah-deadline-title")
    const state = {
      events: mergeEvents(events, []),
      nativeEvents: mergeEvents(events, []),
      selectedMonth: getInitialMonth(events),
      selectedCourse: "",
      query: "",
      hideCompleted: false,
      loadedMonths: new Set([monthKey(getInitialMonth(events))]),
      isLoading: false,
      isSyncing: false
    }
    deadlineDashboardStates.set(dashboard, state)

    dashboard.innerHTML = `
      <div class="ou-deadline-hero">
        <div>
          <p class="ou-deadline-eyebrow">OU YEAH · DEADLINE</p>
          <h2 id="ou-yeah-deadline-title">Deadline theo tháng</h2>
          <p class="ou-deadline-subtitle">Xem theo từng tháng, lọc theo môn học. Bao gồm cả deadline nộp bài và các buổi VC/meeting có tính điểm.</p>
        </div>
        <div class="ou-deadline-stats" aria-label="Tổng quan deadline">
          <strong data-ou-deadline-count>0</strong>
          <span>mục cần nhớ</span>
          <small data-ou-deadline-course-count>0 môn</small>
        </div>
      </div>
      <div class="ou-deadline-toolbar">
        <div class="ou-deadline-filters">
          <div class="ou-deadline-course-filter" data-ou-deadline-course-filter>
            <button type="button" class="ou-deadline-course-trigger" aria-haspopup="listbox" aria-expanded="false">
              <span data-ou-deadline-course-value>Tất cả môn học</span>
              <span class="ou-deadline-course-chevron" aria-hidden="true"></span>
            </button>
            <div class="ou-deadline-course-menu" role="listbox" hidden></div>
          </div>
          <label class="ou-deadline-search">
            <span class="sr-only">Tìm deadline</span>
            <input type="search" placeholder="Tìm theo tên bài" data-ou-deadline-search>
          </label>
          <label class="ou-deadline-completed-filter">
            <input type="checkbox" data-ou-deadline-hide-completed>
            <span>Ẩn đã thực hiện</span>
          </label>
        </div>
        <div class="ou-deadline-month-nav" aria-label="Điều hướng theo tháng">
          <button type="button" data-ou-deadline-previous aria-label="Xem tháng trước"><span class="ou-deadline-month-icon ou-deadline-month-icon-previous" aria-hidden="true"></span></button>
          <div class="ou-deadline-month-picker" data-ou-deadline-month-picker>
            <button type="button" class="ou-deadline-month-trigger" aria-haspopup="listbox" aria-expanded="false">
              <span data-ou-deadline-month-label></span>
              <span class="ou-deadline-month-chevron" aria-hidden="true"></span>
            </button>
            <div class="ou-deadline-month-menu" role="listbox" hidden></div>
          </div>
          <button type="button" data-ou-deadline-next aria-label="Xem tháng sau"><span class="ou-deadline-month-icon ou-deadline-month-icon-next" aria-hidden="true"></span></button>
        </div>
      </div>
      <div class="ou-deadline-sync-row">
        <div class="ou-deadline-note" data-ou-deadline-note>Đồng bộ từ lịch và các trang môn học</div>
        <button type="button" class="ou-deadline-refresh" data-ou-deadline-refresh>Đồng bộ lại</button>
      </div>
      <div class="ou-deadline-list" data-ou-deadline-list></div>
      <div class="ou-deadline-footer">
        <button type="button" class="ou-deadline-export" data-ou-deadline-export title="Xuất toàn bộ mục đã đồng bộ thành file .ics">
          Xuất toàn bộ lịch .ics
        </button>
      </div>
    `

    const list = dashboard.querySelector("[data-ou-deadline-list]")
    if (!(list instanceof HTMLElement)) return dashboard

    const courseFilter = /** @type {HTMLElement | null} */ (dashboard.querySelector("[data-ou-deadline-course-filter]"))
    const search = /** @type {HTMLInputElement | null} */ (dashboard.querySelector("input[data-ou-deadline-search]"))
    const hideCompleted = /** @type {HTMLInputElement | null} */ (dashboard.querySelector("input[data-ou-deadline-hide-completed]"))
    const previousButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-previous]"))
    const nextButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-next]"))
    const monthPicker = /** @type {HTMLElement | null} */ (dashboard.querySelector("[data-ou-deadline-month-picker]"))
    const exportButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-export]"))
    const refreshButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-refresh]"))

    syncCourseFilter(courseFilter, state.events)
    syncMonthPicker(monthPicker, state.events, state.selectedMonth)
    setupCourseFilter(courseFilter, (value) => {
      state.selectedCourse = value
      renderDeadlineMonth(dashboard, state)
    })
    setupMonthPicker(monthPicker, (value) => {
      selectDeadlineMonth(dashboard, state, value).catch(() => {})
    })
    renderDeadlineMonth(dashboard, state)

    search?.addEventListener("input", () => {
      state.query = search.value
      renderDeadlineMonth(dashboard, state)
    })
    hideCompleted?.addEventListener("change", () => {
      state.hideCompleted = hideCompleted.checked
      renderDeadlineMonth(dashboard, state)
    })
    previousButton?.addEventListener("click", () => {
      navigateDeadlineMonth(dashboard, state, -1).catch(() => {})
    })
    nextButton?.addEventListener("click", () => {
      navigateDeadlineMonth(dashboard, state, 1).catch(() => {})
    })
    exportButton?.addEventListener("click", () => {
      exportDeadlineCalendar(dashboard, state)
    })
    refreshButton?.addEventListener("click", () => {
      refreshDeadlineDashboard(dashboard, state.nativeEvents, true).catch(() => {
        setDeadlineSyncStatus(dashboard, "Không thể đồng bộ lúc này · đang hiển thị dữ liệu gần nhất")
      })
    })

    return dashboard
  }

  function updateDeadlineDashboardEvents(dashboard, events) {
    const state = deadlineDashboardStates.get(dashboard)
    if (!state) return
    state.events = mergeEvents(events, [])
    if (state.selectedCourse && !state.events.some((event) => event.course === state.selectedCourse)) {
      state.selectedCourse = ""
    }
    syncCourseFilter(dashboard.querySelector("[data-ou-deadline-course-filter]"), state.events)
    renderDeadlineMonth(dashboard, state)
  }

  function setDeadlineSyncStatus(dashboard, message) {
    const note = dashboard.querySelector("[data-ou-deadline-note]")
    if (note instanceof HTMLElement) note.textContent = message
  }

  function setDeadlineRefreshBusy(dashboard, isBusy) {
    const button = dashboard.querySelector("[data-ou-deadline-refresh]")
    if (!(button instanceof HTMLButtonElement)) return
    button.disabled = isBusy
    button.textContent = isBusy ? "Đang đồng bộ..." : "Đồng bộ lại"
  }

  function getInitialMonth(events) {
    const now = new Date()
    const firstUpcoming = events
      .filter((event) => event?.date instanceof Date && event.date >= now)
      .sort(compareEvents)[0]
    return startOfMonth(firstUpcoming?.date || now)
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1)
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  }

  function formatMonthLabel(date) {
    const label = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(date)
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  function syncMonthPicker(container, events, selectedMonth) {
    if (!(container instanceof HTMLElement)) return
    const menu = container.querySelector("[role='listbox']")
    if (!(menu instanceof HTMLElement)) return

    const dates = [new Date(), selectedMonth, ...events.map((event) => event.date)]
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
      .map(startOfMonth)
    const earliest = new Date(Math.min(...dates.map((date) => date.getTime())))
    const latest = new Date(Math.max(...dates.map((date) => date.getTime())))
    const selectedKey = monthKey(selectedMonth)

    menu.innerHTML = ""
    for (let date = earliest; date <= latest; date = new Date(date.getFullYear(), date.getMonth() + 1, 1)) {
      appendMonthOption(menu, monthKey(date), formatMonthLabel(date), selectedKey)
    }

    container.dataset.value = selectedKey
    updateMonthPickerDisplay(container)
  }

  function appendMonthOption(menu, value, label, selectedValue) {
    const option = document.createElement("button")
    option.type = "button"
    option.className = "ou-deadline-month-option"
    option.setAttribute("role", "option")
    option.dataset.monthValue = value
    option.setAttribute("aria-selected", String(value === selectedValue))
    option.textContent = label
    menu.append(option)
  }

  function updateMonthPickerDisplay(container) {
    const value = container.dataset.value || ""
    const valueElement = container.querySelector("[data-ou-deadline-month-label]")
    const selectedOption = Array.from(container.querySelectorAll("[data-month-value]")).find((option) => option.getAttribute("data-month-value") === value)
    if (valueElement) valueElement.textContent = selectedOption?.textContent || value
    container.querySelectorAll("[data-month-value]").forEach((option) => {
      option.setAttribute("aria-selected", String(option.getAttribute("data-month-value") === value))
    })
  }

  function setupMonthPicker(container, onChange) {
    if (!(container instanceof HTMLElement)) return
    const trigger = container.querySelector(".ou-deadline-month-trigger")
    const menu = container.querySelector("[role='listbox']")
    if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return

    const setOpen = (open) => {
      menu.hidden = !open
      trigger.setAttribute("aria-expanded", String(open))
      container.classList.toggle("is-open", open)
    }

    trigger.addEventListener("click", () => setOpen(menu.hidden))
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        setOpen(true)
      }
      if (event.key === "Escape") setOpen(false)
    })
    menu.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-month-value]") : null
      if (!(target instanceof HTMLElement)) return
      container.dataset.value = target.getAttribute("data-month-value") || ""
      updateMonthPickerDisplay(container)
      setOpen(false)
      onChange(container.dataset.value)
    })
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !container.contains(event.target)) setOpen(false)
    })
  }

  function syncCourseFilter(container, events) {
    if (!(container instanceof HTMLElement)) return
    const menu = container.querySelector("[role='listbox']")
    if (!(menu instanceof HTMLElement)) return
    const currentValue = container.dataset.value || ""
    const courses = Array.from(new Set(events.map((event) => event.course).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, "vi"))

    menu.innerHTML = ""
    appendCourseOption(menu, "", "Tất cả môn học", currentValue)
    courses.forEach((course) => {
      appendCourseOption(menu, course, course, currentValue)
    })

    container.dataset.value = courses.includes(currentValue) ? currentValue : ""
    updateCourseFilterDisplay(container)
  }

  function appendCourseOption(menu, value, label, selectedValue) {
    const option = document.createElement("button")
    option.type = "button"
    option.className = "ou-deadline-course-option"
    option.setAttribute("role", "option")
    option.dataset.courseValue = value
    option.setAttribute("aria-selected", String(value === selectedValue))
    option.textContent = label
    menu.append(option)
  }

  function updateCourseFilterDisplay(container) {
    const value = container.dataset.value || ""
    const valueElement = container.querySelector("[data-ou-deadline-course-value]")
    const selectedOption = Array.from(container.querySelectorAll("[data-course-value]")).find((option) => option.getAttribute("data-course-value") === value)
    if (valueElement) valueElement.textContent = selectedOption?.textContent || "Tất cả môn học"
    container.querySelectorAll("[data-course-value]").forEach((option) => {
      option.setAttribute("aria-selected", String(option.getAttribute("data-course-value") === value))
    })
  }

  function setupCourseFilter(container, onChange) {
    if (!(container instanceof HTMLElement)) return
    const trigger = container.querySelector(".ou-deadline-course-trigger")
    const menu = container.querySelector("[role='listbox']")
    if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return

    const setOpen = (open) => {
      menu.hidden = !open
      trigger.setAttribute("aria-expanded", String(open))
      container.classList.toggle("is-open", open)
    }

    trigger.addEventListener("click", () => setOpen(menu.hidden))
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        setOpen(true)
      }
      if (event.key === "Escape") setOpen(false)
    })
    menu.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-course-value]") : null
      if (!(target instanceof HTMLElement)) return
      container.dataset.value = target.getAttribute("data-course-value") || ""
      updateCourseFilterDisplay(container)
      setOpen(false)
      onChange(container.dataset.value)
    })
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !container.contains(event.target)) setOpen(false)
    })
  }

  function renderDeadlineMonth(dashboard, state) {
    const list = dashboard.querySelector("[data-ou-deadline-list]")
    const monthLabel = dashboard.querySelector("[data-ou-deadline-month-label]")
    const count = dashboard.querySelector("[data-ou-deadline-count]")
    const courseCount = dashboard.querySelector("[data-ou-deadline-course-count]")
    const monthPicker = dashboard.querySelector("[data-ou-deadline-month-picker]")
    if (!(list instanceof HTMLElement)) return

    const month = startOfMonth(state.selectedMonth)
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const query = normalizeText(state.query)
    const monthEntries = buildDeadlineEntries(state.events)
      .filter((entry) => entry.events.some((event) => event.date >= month && event.date < nextMonth))
      .filter((entry) => !state.selectedCourse || entry.course === state.selectedCourse)
      .filter((entry) => !query || normalizeText(entry.events.map((event) => `${event.title} ${event.course}`).join(" ")).includes(query))
      .map((entry) => state.hideCompleted ? filterCompletedDeadlineEntry(entry, state.events) : entry)
      .filter(Boolean)

    syncMonthPicker(monthPicker, state.events, month)
    if (monthLabel) monthLabel.textContent = formatMonthLabel(month)
    if (count) count.textContent = String(monthEntries.length)
    if (courseCount) courseCount.textContent = `${new Set(monthEntries.map((entry) => entry.course)).size} môn`
    if (state.isLoading) {
      list.classList.add("ou-deadline-list-loading")
      list.setAttribute("aria-busy", "true")
    } else {
      list.classList.remove("ou-deadline-list-loading")
      list.removeAttribute("aria-busy")
    }

    list.innerHTML = ""
    if (!monthEntries.length) {
      list.innerHTML = `<div class="ou-deadline-empty">${state.isLoading ? "Đang tải dữ liệu tháng này..." : state.hideCompleted ? "Không còn deadline hoặc buổi VC/meeting chưa thực hiện trong tháng này." : "Không có deadline hoặc buổi VC/meeting trong tháng này."}</div>`
      return
    }

    monthEntries.forEach((entry) => {
      const row = entry.type === "group"
        ? createDeadlinePair(entry, state.events)
        : createDeadlineRow(entry.events[0], state.events)
      list.append(row)
    })
  }

  function exportDeadlineCalendar(dashboard, state) {
    const query = normalizeText(state.query)
    const events = state.events
      .filter((event) => !state.selectedCourse || event.course === state.selectedCourse)
      .filter((event) => !query || normalizeText(`${event.title} ${event.course}`).includes(query))
      .filter((event) => !state.hideCompleted || !isDeadlineCompletedForFilter(event, state.events))
      .filter((event) => event?.date instanceof Date && !Number.isNaN(event.date.getTime()))
      .sort(compareEvents)

    const note = dashboard.querySelector("[data-ou-deadline-note]")
    if (!events.length) {
      if (note instanceof HTMLElement) note.textContent = "Không có mục nào phù hợp để xuất lịch."
      return
    }

    const ics = renderDeadlineIcs(events, state.events)
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const dateStamp = new Date().toISOString().slice(0, 10)
    link.href = blobUrl
    link.download = `ou-yeah-deadlines-all-${dateStamp}.ics`
    link.style.display = "none"
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)

    if (note instanceof HTMLElement) {
      note.textContent = `Đã xuất ${events.length} mục · Google Calendar → Cài đặt → Nhập và xuất → chọn file .ics`
    }
  }

  function renderDeadlineIcs(events, allEvents) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OU Yeah!//Deadline Calendar//VI",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:OU Yeah! Deadline",
      "X-WR-TIMEZONE:Asia/Ho_Chi_Minh"
    ]
    const stamp = formatIcsUtcDate(new Date())

    events.forEach((event) => {
      const originalEvent = findOriginalDeadline(event, allEvents)
      const isCompleted = isDeadlineCompleted(event)
      const extensionNotNeeded = Boolean(originalEvent && isDeadlineCompleted(originalEvent))
      const isExtension = isExtensionDeadline(event)
      const isMeeting = event.kind === "meeting"
      const isOverdue = !isCompleted && !extensionNotNeeded && event.date.getTime() < Date.now()
      const type = isMeeting ? "VC / MEETING" : isExtension ? "GIA HẠN" : "DEADLINE"
      const status = extensionNotNeeded
        ? "Không cần làm — đã hoàn thành hạn gốc"
        : isCompleted
          ? "Đã hoàn thành"
          : isOverdue ? "Quá hạn" : "Chưa hoàn thành"
      const start = isMeeting
        ? event.date
        : new Date(event.date.getTime() - 55 * 60 * 1000)
      const end = isMeeting
        ? new Date(event.date.getTime() + 60 * 60 * 1000)
        : event.date
      const description = [
        `Môn học: ${event.course || "Không rõ môn học"}`,
        `Loại: ${type}`,
        `Hạn: ${formatDate(event.date)} ${formatTime(event.date)}`,
        `Trạng thái khi xuất: ${status}`,
        event.href ? `Mở ELOLMS: ${event.href}` : ""
      ].filter(Boolean).join("\n")

      lines.push("BEGIN:VEVENT")
      lines.push(`UID:${deadlineIcsUid(event)}@ou-yeah.local`)
      lines.push(`DTSTAMP:${stamp}`)
      lines.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${formatIcsLocalDate(start)}`)
      lines.push(`DTEND;TZID=Asia/Ho_Chi_Minh:${formatIcsLocalDate(end)}`)
      lines.push(`SUMMARY:${escapeIcs(event.title)}`)
      lines.push(`DESCRIPTION:${escapeIcs(description)}`)
      lines.push(`CATEGORIES:${isMeeting ? "VC/MEETING" : isExtension ? "DEADLINE,EXTENSION" : "DEADLINE"}`)
      lines.push(`X-OU-YEAH-COMPLETED:${isCompleted ? "TRUE" : "FALSE"}`)
      lines.push(`X-OU-YEAH-STATUS:${escapeIcs(status)}`)
      if (event.href) lines.push(`URL:${event.href}`)
      lines.push("STATUS:CONFIRMED")
      lines.push("TRANSP:OPAQUE")
      lines.push("SEQUENCE:0")
      lines.push("END:VEVENT")
    })

    lines.push("END:VCALENDAR")
    return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`
  }

  function deadlineIcsUid(event) {
    return `deadline-${hashText([
      event.course,
      event.title,
      event.kind,
      event.date.toISOString(),
      event.href
    ].join("|"))}`
  }

  function formatIcsLocalDate(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`
  }

  function formatIcsUtcDate(date) {
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`
  }

  function deadlineIcsText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;")
  }

  function escapeIcs(value) {
    return deadlineIcsText(value)
  }

  function foldIcsLine(line) {
    const text = String(line || "")
    const encoder = new TextEncoder()
    const chunks = []
    let current = ""

    for (const character of text) {
      const next = current + character
      if (current && encoder.encode(next).length > 75) {
        chunks.push(current)
        current = ` ${character}`
      } else {
        current = next
      }
    }
    chunks.push(current)
    return chunks
  }

  function hashText(value) {
    let hash = 2166136261
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
  }

  async function selectDeadlineMonth(dashboard, state, value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value)
    if (!match) return

    const selectedMonth = new Date(Number(match[1]), Number(match[2]) - 1, 1)
    if (monthKey(selectedMonth) === monthKey(state.selectedMonth)) return

    state.selectedMonth = selectedMonth
    state.isLoading = true
    renderDeadlineMonth(dashboard, state)

    const previousButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-previous]"))
    const nextButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-next]"))
    const monthTrigger = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector(".ou-deadline-month-trigger"))
    if (previousButton) previousButton.disabled = true
    if (nextButton) nextButton.disabled = true
    if (monthTrigger) monthTrigger.disabled = true

    const key = monthKey(selectedMonth)
    try {
      if (!state.loadedMonths.has(key)) {
        const monthEvents = await fetchCalendarEventsForMonth(selectedMonth)
        state.events = mergeEvents(state.events, monthEvents)
        state.loadedMonths.add(key)
        syncCourseFilter(dashboard.querySelector("[data-ou-deadline-course-filter]"), state.events)
      }
    } finally {
      state.isLoading = false
      if (previousButton) previousButton.disabled = false
      if (nextButton) nextButton.disabled = false
      if (monthTrigger) monthTrigger.disabled = false
      renderDeadlineMonth(dashboard, state)
    }
  }

  async function navigateDeadlineMonth(dashboard, state, offset) {
    if (state.isLoading) return
    state.selectedMonth = new Date(state.selectedMonth.getFullYear(), state.selectedMonth.getMonth() + offset, 1)
    state.isLoading = true
    renderDeadlineMonth(dashboard, state)
    syncCourseFilter(dashboard.querySelector("[data-ou-deadline-course-filter]"), state.events)

    const previousButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-previous]"))
    const nextButton = /** @type {HTMLButtonElement | null} */ (dashboard.querySelector("[data-ou-deadline-next]"))
    if (previousButton) previousButton.disabled = true
    if (nextButton) nextButton.disabled = true

    const key = monthKey(state.selectedMonth)
    try {
      if (!state.loadedMonths.has(key)) {
        const monthEvents = await fetchCalendarEventsForMonth(state.selectedMonth)
        state.events = mergeEvents(state.events, monthEvents)
        state.loadedMonths.add(key)
        syncCourseFilter(dashboard.querySelector("[data-ou-deadline-course-filter]"), state.events)
      }
    } finally {
      state.isLoading = false
      if (previousButton) previousButton.disabled = false
      if (nextButton) nextButton.disabled = false
      renderDeadlineMonth(dashboard, state)
    }
  }

  function deadlineKey(event) {
    return [
      event.date.toISOString(),
      normalizeText(event.title),
      normalizeText(event.course),
      event.href || ""
    ].join("|")
  }

  function normalizedDeadlineFamily(title) {
    return normalizeText(title)
      .replace(/\b(gia han|extension|extended)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  }

  function isExtensionDeadline(event) {
    return /\b(gia han|extension|extended)\b/.test(normalizeText(event.title))
  }

  function findOriginalDeadline(event, events) {
    if (!isExtensionDeadline(event)) return null
    const family = normalizedDeadlineFamily(event.title)
    return events
      .filter((candidate) => candidate !== event
        && !isExtensionDeadline(candidate)
        && candidate.course === event.course
        && candidate.date < event.date
        && normalizedDeadlineFamily(candidate.title) === family)
      .sort((left, right) => right.date - left.date)[0] || null
  }

  function buildDeadlineEntries(events) {
    const sortedEvents = events.slice().sort(compareEvents)
    const usedKeys = new Set()
    const entries = []

    sortedEvents.forEach((event) => {
      const key = deadlineKey(event)
      if (usedKeys.has(key)) return

      if (!isExtensionDeadline(event)) {
        const extensions = sortedEvents.filter((candidate) => {
          return isExtensionDeadline(candidate)
            && candidate.course === event.course
            && candidate.date > event.date
            && normalizedDeadlineFamily(candidate.title) === normalizedDeadlineFamily(event.title)
            && findOriginalDeadline(candidate, sortedEvents) === event
        })

        if (extensions.length) {
          extensions.forEach((extension) => usedKeys.add(deadlineKey(extension)))
          usedKeys.add(key)
          entries.push({
            type: "group",
            base: event,
            extensions,
            events: [event, ...extensions],
            course: event.course,
          })
          return
        }
      }

      if (isExtensionDeadline(event) && findOriginalDeadline(event, sortedEvents)) return

      usedKeys.add(key)
      entries.push({ type: "single", events: [event], course: event.course })
    })

    return entries.sort((left, right) => compareEvents(left.events[0], right.events[0]))
  }

  function isDeadlineCompleted(event) {
    return Boolean(event?.completed)
  }

  function isDeadlineCompletedForFilter(event, allEvents) {
    if (isDeadlineCompleted(event)) return true
    const originalEvent = findOriginalDeadline(event, allEvents)
    return Boolean(originalEvent && isDeadlineCompleted(originalEvent))
  }

  function filterCompletedDeadlineEntry(entry, allEvents) {
    const visibleEvents = entry.events.filter((event) => !isDeadlineCompletedForFilter(event, allEvents))
    if (!visibleEvents.length) return null
    if (entry.type !== "group") return { ...entry, events: visibleEvents }
    return {
      ...entry,
      base: visibleEvents[0],
      extensions: visibleEvents.slice(1),
      events: visibleEvents,
    }
  }

  function createDeadlineRow(event, allEvents) {
    const row = document.createElement("article")
    row.className = "ou-deadline-row"
    row.dataset.ouDeadlineRow = "true"
    const isCompleted = isDeadlineCompleted(event)
    const originalEvent = findOriginalDeadline(event, allEvents)
    const now = Date.now()
    const extensionNotNeeded = Boolean(originalEvent && isDeadlineCompleted(originalEvent))
    const isExtensionActionable = isExtensionDeadline(event)
      && Boolean(originalEvent && !isDeadlineCompleted(originalEvent) && originalEvent.date.getTime() < now)
    const isInactiveExtension = isExtensionDeadline(event)
      && Boolean(originalEvent)
      && !extensionNotNeeded
      && !isExtensionActionable
    const isForum = /\/mod\/forum\//i.test(event.href || "")
    const eventTime = event.date.getTime()
    const isOverdue = !isCompleted && !extensionNotNeeded && eventTime < now
    const isDueSoon = !isCompleted && !extensionNotNeeded && eventTime >= now && eventTime <= now + (3 * 24 * 60 * 60 * 1000)
    const isOverdueLocked = isOverdue && !isForum
    const isMeeting = event.kind === "meeting"
    const isExtension = isExtensionDeadline(event)
    const isBaseDeadline = !isMeeting && !isExtension && !isOverdue && !isDueSoon
    const isTemporarilyRetained = isMeeting
      && event.temporary === true
      && Number(event.temporaryUntil) > Date.now()
    const typeLabel = isMeeting ? "VC / MEETING" : isExtension ? "GIA HẠN" : "DEADLINE"
    const typeClass = isMeeting ? "ou-deadline-type-meeting" : isExtension ? "ou-deadline-type-extension" : ""
    const temporaryTooltip = isTemporarilyRetained ? getTemporaryMeetingTooltip(event) : ""
    const temporaryMarkup = isTemporarilyRetained
      ? `<span class="ou-deadline-status-temporary" tabindex="0" title="${escapeAttribute(temporaryTooltip)}" aria-label="${escapeAttribute(temporaryTooltip)}">TẠM LƯU</span>`
      : ""
    const completionLabel = extensionNotNeeded
      ? "Không cần làm vì đã hoàn thành hạn gốc"
      : isCompleted
        ? isMeeting ? "Đã tham gia" : "Đã hoàn thành"
        : isOverdueLocked
          ? "Quá hạn"
          : isMeeting ? "Chưa xác định đã tham gia" : "Chưa hoàn thành"
    const statusMarkup = extensionNotNeeded
      ? '<span class="ou-deadline-status-not-needed">ĐÃ XONG HẠN GỐC</span>'
      : isExtension && isCompleted
        ? `<span class="ou-deadline-status-submitted ${isExtensionActionable ? "ou-deadline-status-submitted-late" : "ou-deadline-status-submitted-inactive"}">ĐÃ NỘP GIA HẠN</span>`
        : isOverdue
          ? '<span class="ou-deadline-status-overdue">QUÁ HẠN</span>'
          : isDueSoon
            ? '<span class="ou-deadline-status-due-soon"><span class="ou-deadline-due-soon-icon" aria-hidden="true"></span>SẮP ĐẾN HẠN</span>'
        : ""
    row.classList.toggle("ou-deadline-row-completed", isCompleted)
    row.classList.toggle("ou-deadline-row-not-needed", extensionNotNeeded)
    row.classList.toggle("ou-deadline-row-overdue", isOverdueLocked)
    row.classList.toggle("ou-deadline-row-overdue-actionable", isOverdue && isForum)
    row.classList.toggle("ou-deadline-row-due-soon", isDueSoon)
    row.classList.toggle("ou-deadline-row-base", isBaseDeadline)
    row.classList.toggle("ou-deadline-row-extension-actionable", isExtensionActionable)
    row.classList.toggle("ou-deadline-row-extension-inactive", isInactiveExtension)
    row.innerHTML = `
      <label class="ou-deadline-check">
        <input type="checkbox" data-ou-deadline-complete ${isCompleted && !extensionNotNeeded ? "checked" : ""} disabled>
        <span aria-hidden="true"></span>
        <span class="sr-only">Trạng thái tự động — ${completionLabel}: ${escapeHtml(event.title)}</span>
      </label>
      <div class="ou-deadline-date">
        <strong>${formatDay(event.date)}</strong>
        <span>${formatMonth(event.date)}</span>
        <small>${event.time}</small>
      </div>
      <div class="ou-deadline-content">
        <div class="ou-deadline-meta"><span class="ou-deadline-course">${escapeHtml(event.course)}</span><span class="ou-deadline-type ${typeClass}">${typeLabel}</span>${statusMarkup}${temporaryMarkup}</div>
        <h3>${event.href ? `<a href="${escapeAttribute(event.href)}">${escapeHtml(event.title)}</a>` : escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.dateLabel || formatDate(event.date))} · ${event.time}</p>
      </div>
      ${event.href ? `<a class="ou-deadline-open" href="${escapeAttribute(event.href)}">Mở bài<span aria-hidden="true"> ↗</span></a>` : ""}
    `
    return row
  }

  function getTemporaryMeetingTooltip(event) {
    const until = Number(event.temporaryUntil) || 0
    const reason = event.completed === true
      ? "ELOLMS đã ẩn buổi VC khỏi lịch sau khi điểm danh"
      : "ELOLMS không còn trả buổi VC trong lịch hiện tại"
    const retention = until > 0 ? ` OU Yeah! tạm giữ mục này đến ${formatDate(new Date(until))}.` : ""
    return `${reason}.${retention}`
  }

  function createDeadlinePair(entry, allEvents) {
    const pair = document.createElement("div")
    pair.className = "ou-deadline-pair"
    pair.setAttribute("aria-label", `Hạn gốc và gia hạn: ${entry.base.title}`)

    pair.append(
      createDeadlineRow(entry.base, allEvents),
      ...entry.extensions.map((event) => createDeadlineRow(event, allEvents)),
    )
    return pair
  }

  function injectDeadlineTheme() {
    if (document.getElementById(DEADLINE_STYLE_ID)) return
    const style = document.createElement("style")
    style.id = DEADLINE_STYLE_ID
    style.textContent = deadlineCss()
    document.documentElement.append(style)
  }

  function getDeadlineAssetUrl(filename) {
    try {
      return chrome.runtime.getURL(`src/icons/${filename}`)
    } catch {
      return ""
    }
  }

  function getDeadlineFontUrl(filename) {
    try {
      return chrome.runtime.getURL(`src/fonts/${filename}`)
    } catch {
      return ""
    }
  }

  function deadlineCss() {
    const chevronUrl = getDeadlineAssetUrl("angle-small-down.svg")
    const checkUrl = getDeadlineAssetUrl("check.svg")
    const crossUrl = getDeadlineAssetUrl("cross-small.svg")
    const minusUrl = getDeadlineAssetUrl("minus-small.svg")
    const exclamationUrl = getDeadlineAssetUrl("exclamation.svg")
    const regularFontUrl = getDeadlineFontUrl("SpaceGrotesk-Regular.ttf")
    const boldFontUrl = getDeadlineFontUrl("SpaceGrotesk-Bold.ttf")
    return `
      @font-face { font-family: "Space Grotesk"; src: url("${regularFontUrl}") format("truetype"); font-style: normal; font-weight: 400; font-display: swap; }
      @font-face { font-family: "Space Grotesk"; src: url("${boldFontUrl}") format("truetype"); font-style: normal; font-weight: 700; font-display: swap; }
      #${DEADLINE_NAV_ID} .nav-link { position: relative; }
      #${DEADLINE_NAV_ID} .nav-link::after { content: ""; position: absolute; left: 1rem; right: 1rem; bottom: .35rem; height: 2px; border-radius: 99px; background: transparent; transition: background .16s ease; }
      #${DEADLINE_NAV_ID} .nav-link:hover::after, #${DEADLINE_NAV_ID} .nav-link.active::after { background: ${BRAND}; }
      #${DEADLINE_LOADING_ID} { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 14% 18%, rgba(132, 151, 255, .17), transparent 38%), radial-gradient(circle at 86% 82%, rgba(121, 211, 199, .12), transparent 38%), rgba(245, 247, 255, .34); -webkit-backdrop-filter: blur(5px) saturate(1.06); backdrop-filter: blur(5px) saturate(1.06); color: #182033; font-family: "Space Grotesk", "Segoe UI", sans-serif; }
      #${DEADLINE_LOADING_ID} .ou-deadline-loading-card { display: grid; justify-items: stretch; gap: 12px; width: min(380px, calc(100vw - 40px)); padding: 20px 22px 18px; border: 1px solid rgba(255, 255, 255, .82); border-radius: 18px; background: linear-gradient(145deg, rgba(255, 255, 255, .7), rgba(245, 248, 255, .52)); -webkit-backdrop-filter: blur(14px) saturate(1.08); backdrop-filter: blur(14px) saturate(1.08); box-shadow: 0 18px 46px rgba(43, 57, 105, .13), inset 0 1px 0 rgba(255, 255, 255, .86); text-align: center; }
      #${DEADLINE_LOADING_ID} .ou-deadline-loading-title { overflow: hidden; color: #182033; font-size: 17px; font-weight: 800; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
      #${DEADLINE_LOADING_ID} .ou-deadline-loading-progress { width: 100%; height: 4px; overflow: hidden; border-radius: 99px; background: rgba(82, 105, 199, .12); }
      #${DEADLINE_LOADING_ID} .ou-deadline-loading-progress span { display: block; width: 42%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, ${BRAND}, #9eaff8); animation: ou-yeah-deadline-progress 1.35s ease-in-out infinite; }
      @keyframes ou-yeah-deadline-progress { 0% { transform: translateX(-130%); } 50%, 100% { transform: translateX(300%); } }
      body.ou-yeah-deadline-page #region-main { --ou-deadline-brand: ${BRAND}; --ou-deadline-ink: #182033; --ou-deadline-muted: #697386; --ou-deadline-line: #e5e9f2; --ou-deadline-soft: #f7f8fc; }
      #${DEADLINE_DASHBOARD_ID} { max-width: 1080px; margin: 24px auto 48px; color: var(--ou-deadline-ink); }
      #${DEADLINE_DASHBOARD_ID}, #${DEADLINE_DASHBOARD_ID} * { box-sizing: border-box; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--ou-deadline-line); border-radius: 18px; background: linear-gradient(135deg, #fff 0%, #f8f9ff 100%); box-shadow: 0 10px 28px rgba(33, 49, 93, .07); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-eyebrow { margin: 0 0 6px; color: var(--ou-deadline-brand); font-size: 11px; font-weight: 800; letter-spacing: .12em; }
      #${DEADLINE_DASHBOARD_ID} h2 { margin: 0; color: var(--ou-deadline-ink); font-size: clamp(22px, 3vw, 32px); font-weight: 800; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-subtitle { max-width: 680px; margin: 8px 0 0; color: var(--ou-deadline-muted); font-size: 14px; line-height: 1.5; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats { min-width: 112px; padding: 12px 14px; border: 1px solid rgba(82, 105, 199, .18); border-radius: 14px; background: #fff; text-align: right; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats strong { display: block; color: var(--ou-deadline-brand); font-size: 28px; line-height: 1; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats span, #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats small { display: block; color: var(--ou-deadline-muted); font-size: 11px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats small { margin-top: 5px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 16px 0 8px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-filters { display: flex; flex: 1 1 auto; gap: 8px; min-width: 0; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-filter { position: relative; flex: 0 1 230px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-search { flex: 1 1 260px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-completed-filter { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; min-height: 40px; padding: 0 4px; color: var(--ou-deadline-muted); cursor: pointer; font-size: 12px; white-space: nowrap; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-completed-filter input { width: 16px; height: 16px; margin: 0; accent-color: var(--ou-deadline-brand); cursor: pointer; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-completed-filter:hover { color: var(--ou-deadline-brand); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-trigger, #${DEADLINE_DASHBOARD_ID} .ou-deadline-search input { width: 100%; min-height: 40px; padding: 9px 13px; border: 1px solid var(--ou-deadline-line); border-radius: 10px; background: #fff; color: var(--ou-deadline-ink); outline: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; font: inherit; text-align: left; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-trigger:hover, #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-filter.is-open .ou-deadline-course-trigger { border-color: rgba(82, 105, 199, .52); box-shadow: 0 0 0 3px rgba(82, 105, 199, .1); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-chevron, #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-icon { display: block; width: 16px; height: 16px; flex: 0 0 16px; background-color: currentColor; -webkit-mask: url("${chevronUrl}") center / contain no-repeat; mask: url("${chevronUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-chevron { color: var(--ou-deadline-muted); transition: transform .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-filter.is-open .ou-deadline-course-chevron { transform: rotate(180deg); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-menu { position: absolute; z-index: 10; top: calc(100% + 6px); right: 0; left: 0; max-height: 260px; overflow: auto; padding: 6px; border: 1px solid var(--ou-deadline-line); border-radius: 12px; background: rgba(255, 255, 255, .98); box-shadow: 0 12px 28px rgba(33, 49, 93, .14); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-option { display: block; width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--ou-deadline-ink); cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-option:hover, #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-option[aria-selected="true"] { background: #eef2ff; color: var(--ou-deadline-brand); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-search input:focus { border-color: var(--ou-deadline-brand); box-shadow: 0 0 0 3px rgba(82, 105, 199, .12); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-export { min-height: 40px; padding: 9px 13px; border: 1px solid rgba(82, 105, 199, .24); border-radius: 10px; background: #f7f8ff; color: var(--ou-deadline-brand); cursor: pointer; font: inherit; font-size: 12px; font-weight: 750; white-space: nowrap; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-export:hover { border-color: rgba(82, 105, 199, .52); background: #eef2ff; box-shadow: 0 0 0 3px rgba(82, 105, 199, .1); transform: translateY(-1px); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-export:focus-visible { outline: none; border-color: var(--ou-deadline-brand); box-shadow: 0 0 0 3px rgba(82, 105, 199, .16); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-nav { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-picker { position: relative; flex: 0 0 auto; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 176px; min-height: 34px; padding: 8px 11px; border: 1px solid var(--ou-deadline-line); border-radius: 9px; background: #fff; color: var(--ou-deadline-ink); cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-trigger:hover, #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-picker.is-open .ou-deadline-month-trigger { border-color: rgba(82, 105, 199, .52); box-shadow: 0 0 0 3px rgba(82, 105, 199, .1); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-trigger:disabled { cursor: wait; opacity: .55; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-trigger > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-chevron { display: block; width: 14px; height: 14px; flex: 0 0 14px; background-color: var(--ou-deadline-muted); transition: transform .16s ease; -webkit-mask: url("${chevronUrl}") center / contain no-repeat; mask: url("${chevronUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-picker.is-open .ou-deadline-month-chevron { transform: rotate(180deg); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-menu { position: absolute; z-index: 11; top: calc(100% + 6px); right: 0; left: 0; max-height: 260px; overflow: auto; padding: 6px; border: 1px solid var(--ou-deadline-line); border-radius: 12px; background: rgba(255, 255, 255, .98); box-shadow: 0 12px 28px rgba(33, 49, 93, .14); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-option { display: block; width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--ou-deadline-ink); cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-option:hover, #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-option[aria-selected="true"] { background: #eef2ff; color: var(--ou-deadline-brand); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-nav > button { display: inline-grid; width: 34px; height: 34px; place-items: center; padding: 0; border: 1px solid var(--ou-deadline-line); border-radius: 9px; background: #fff; color: var(--ou-deadline-brand); cursor: pointer; transition: border-color .16s ease, background .16s ease, opacity .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-icon-previous { transform: rotate(90deg); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-icon-next { transform: rotate(-90deg); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-nav > button:hover:not(:disabled) { border-color: rgba(82, 105, 199, .42); background: #f7f8ff; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-nav > button:disabled { cursor: wait; opacity: .45; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-sync-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-note { min-width: 0; color: var(--ou-deadline-muted); font-size: 12px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-refresh { flex: 0 0 auto; padding: 3px 5px; border: 0; background: transparent; color: var(--ou-deadline-brand); cursor: pointer; font: inherit; font-size: 11px; font-weight: 750; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-refresh:hover:not(:disabled) { text-decoration: underline; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-refresh:focus-visible { outline: 2px solid rgba(82, 105, 199, .35); outline-offset: 2px; border-radius: 4px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-refresh:disabled { cursor: wait; opacity: .55; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-list { display: grid; gap: 8px; transition: opacity .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-list-loading { opacity: .58; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-footer { display: flex; justify-content: flex-end; margin-top: 16px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row { display: grid; grid-template-columns: 24px 84px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid var(--ou-deadline-line); border-radius: 14px; background: #fff; box-shadow: 0 4px 14px rgba(33, 49, 93, .045); transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row:hover { border-color: rgba(82, 105, 199, .34); box-shadow: 0 8px 20px rgba(33, 49, 93, .08); transform: translateY(-1px); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair { display: grid; gap: 0; overflow: hidden; border: 1px solid var(--ou-deadline-line); border-radius: 14px; background: #fff; box-shadow: 0 4px 14px rgba(33, 49, 93, .045); transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair:hover { border-color: rgba(82, 105, 199, .34); box-shadow: 0 8px 20px rgba(33, 49, 93, .08); transform: translateY(-1px); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row { border: 0; border-radius: 0; box-shadow: none; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row + .ou-deadline-row { border-top: 1px solid var(--ou-deadline-line); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row:hover { border-color: transparent; background: #fbfcff; box-shadow: none; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-not-needed:hover { border-color: transparent; background: #eef0f2; box-shadow: none; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-overdue:hover { border-color: #e9a9a9; background: #fff5f5; box-shadow: none; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-overdue-actionable:hover { border-color: #e9a9a9; background: #fff5f5; box-shadow: none; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-base:hover { border-color: transparent; background: #eef4ff; box-shadow: inset 3px 0 0 #5269c7; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-extension-actionable:hover { border-color: transparent; background: #fff1f1; box-shadow: inset 3px 0 0 #d96b6b; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-extension-inactive:hover { border-color: transparent; background: #eef0f2; box-shadow: inset 3px 0 0 #c9ced8; transform: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-completed { opacity: .82; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-base { border-color: #d7e3fb; background: linear-gradient(110deg, #f6f9ff, #fff); box-shadow: inset 3px 0 0 #5269c7, 0 5px 16px rgba(82, 105, 199, .06); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-base:hover { border-color: #a9bdf0; background: #eef4ff; box-shadow: inset 3px 0 0 #5269c7, 0 8px 20px rgba(82, 105, 199, .1); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed { opacity: .78; background: #f4f5f7; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-not-needed { background: #f4f5f7; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-date strong { color: #858d9d; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-course { color: #858d9d; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-content h3 a { color: #737b89; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-content p { color: #8d95a4; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue { border-color: #f0c7c7; background: linear-gradient(110deg, #fff8f8, #fff); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-overdue { background: linear-gradient(110deg, #fff8f8, #fff); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue:hover { border-color: #e9a9a9; background: #fff5f5; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue { opacity: .64; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue .ou-deadline-date strong { color: #c24141; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue-actionable { border-color: #f0c7c7; background: linear-gradient(110deg, #fff8f8, #fff); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-overdue-actionable { background: linear-gradient(110deg, #fff8f8, #fff); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue-actionable:hover { border-color: #e9a9a9; background: #fff5f5; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue-actionable .ou-deadline-date strong { color: #c24141; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-due-soon { border-color: #efd08b; background: linear-gradient(110deg, #fffaf0, #fff); box-shadow: inset 3px 0 0 #e4a62a, 0 5px 16px rgba(184, 126, 15, .08); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-due-soon { background: linear-gradient(110deg, #fffaf0, #fff); box-shadow: inset 3px 0 0 #e4a62a; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-due-soon:hover { border-color: #e5b64e; background: #fff8e8; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row.ou-deadline-row-due-soon:hover { border-color: transparent; background: #fff8e8; box-shadow: inset 3px 0 0 #e4a62a; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-due-soon .ou-deadline-date strong { color: #b77700; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-completed .ou-deadline-content h3 { text-decoration: line-through; text-decoration-color: rgba(82, 105, 199, .6); text-decoration-thickness: 1px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-actionable { background: linear-gradient(110deg, #fff7f7, #fff); box-shadow: inset 3px 0 0 #d96b6b; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-extension-actionable { background: linear-gradient(110deg, #fff7f7, #fff); box-shadow: inset 3px 0 0 #d96b6b; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-actionable:hover { border-color: transparent; background: #fff1f1; box-shadow: inset 3px 0 0 #d96b6b; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-actionable .ou-deadline-date strong { color: #c24141; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive { background: linear-gradient(110deg, #f4f5f7, #fff); box-shadow: inset 3px 0 0 #c9ced8; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-pair .ou-deadline-row-extension-inactive { background: linear-gradient(110deg, #f4f5f7, #fff); box-shadow: inset 3px 0 0 #c9ced8; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive:hover { border-color: transparent; background: #eef0f2; box-shadow: inset 3px 0 0 #c9ced8; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive .ou-deadline-date strong { color: #858d9d; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive .ou-deadline-course { color: #858d9d; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive .ou-deadline-content h3 a { color: #737b89; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive .ou-deadline-content p { color: #8d95a4; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-extension-inactive .ou-deadline-type-extension { background: #eef0f4; color: #70798a; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check { display: inline-grid; width: 22px; height: 22px; place-items: center; cursor: default; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input { position: absolute; width: 1px; height: 1px; opacity: 0; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input + span { position: relative; display: block; width: 18px; height: 18px; border: 1.5px solid #c8d0e2; border-radius: 6px; background: #fff; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check:hover input + span { border-color: var(--ou-deadline-brand); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input:focus-visible + span { box-shadow: 0 0 0 3px rgba(82, 105, 199, .16); }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input:checked + span { border-color: #5269c7; background: #5269c7; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input:disabled:not(:checked) + span { border-color: #aeb9d0; background: #f1f4fb; cursor: not-allowed; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue:not(.ou-deadline-row-overdue-actionable) .ou-deadline-check { cursor: not-allowed; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue:not(.ou-deadline-row-overdue-actionable) .ou-deadline-check input:disabled + span { border-color: #e3aaaa; background: #fff0f0; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-check input:not(:checked) + span::after { content: ""; position: absolute; inset: 4px; background: #9aa8d8; -webkit-mask: url("${minusUrl}") center / contain no-repeat; mask: url("${minusUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-not-needed .ou-deadline-check input:disabled:not(:checked) + span::after { background: #6074b8; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-check input:checked + span::after { content: ""; position: absolute; inset: 3px; background: #fff; -webkit-mask: url("${checkUrl}") center / contain no-repeat; mask: url("${checkUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-row-overdue:not(.ou-deadline-row-overdue-actionable) .ou-deadline-check input:disabled + span::after { content: ""; position: absolute; inset: 3px; background: #c24141; -webkit-mask: url("${crossUrl}") center / contain no-repeat; mask: url("${crossUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-date { padding-right: 14px; border-right: 1px solid var(--ou-deadline-line); text-align: center; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-date strong { display: block; color: var(--ou-deadline-brand); font-size: 25px; line-height: 1; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-date span { display: block; margin-top: 3px; color: var(--ou-deadline-ink); font-size: 11px; font-weight: 750; text-transform: uppercase; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-date small { display: block; margin-top: 6px; color: var(--ou-deadline-muted); font-size: 11px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-course { color: var(--ou-deadline-brand); font-size: 12px; font-weight: 750; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-type { padding: 3px 6px; border-radius: 999px; background: #e8f1ff; color: #3156a6; font-size: 9px; font-weight: 800; letter-spacing: .08em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-type-meeting { background: #e8f1ff; color: #3156a6; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-type-extension { background: #f2ebff; color: #7650ad; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-not-needed { padding: 3px 6px; border: 1px solid #d9dde5; border-radius: 999px; background: #eef0f4; color: #70798a; font-size: 9px; font-weight: 800; letter-spacing: .05em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-submitted, #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-extension { padding: 3px 6px; border-radius: 999px; background: #e8f6ed; color: #287747; font-size: 9px; font-weight: 800; letter-spacing: .05em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-submitted-late { border: 1px solid #f1caca; background: #fff0f0; color: #c24141; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-submitted-inactive { border: 1px solid #d9dde5; background: #eef0f4; color: #70798a; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-extension { background: #fff6df; color: #9a6a00; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-overdue { padding: 3px 6px; border-radius: 999px; background: #fff0f0; color: #c24141; font-size: 9px; font-weight: 800; letter-spacing: .05em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-due-soon { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 999px; background: #fff3d5; color: #a46600; font-size: 9px; font-weight: 800; letter-spacing: .05em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-temporary { padding: 3px 6px; border: 1px solid #d8dff7; border-radius: 999px; background: #f0f3ff; color: #5269c7; cursor: help; font-size: 9px; font-weight: 800; letter-spacing: .05em; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-status-temporary:focus-visible { outline: 2px solid rgba(82, 105, 199, .35); outline-offset: 2px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-due-soon-icon { display: inline-block; width: 11px; height: 11px; flex: 0 0 11px; background: currentColor; -webkit-mask: url("${exclamationUrl}") center / contain no-repeat; mask: url("${exclamationUrl}") center / contain no-repeat; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-content h3 { margin: 5px 0 0; font-size: 16px; font-weight: 750; line-height: 1.3; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-content h3 a { color: var(--ou-deadline-ink); text-decoration: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-content h3 a:hover { color: var(--ou-deadline-brand); text-decoration: underline; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-content p { margin: 4px 0 0; color: var(--ou-deadline-muted); font-size: 12px; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-open { white-space: nowrap; color: var(--ou-deadline-brand); font-size: 12px; font-weight: 750; text-decoration: none; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-open:hover { text-decoration: underline; }
      #${DEADLINE_DASHBOARD_ID} .ou-deadline-empty { padding: 32px; border: 1px dashed var(--ou-deadline-line); border-radius: 14px; background: var(--ou-deadline-soft); color: var(--ou-deadline-muted); text-align: center; }
      #${DEADLINE_DASHBOARD_ID} .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      @media (max-width: 720px) {
        #${DEADLINE_DASHBOARD_ID} { margin-top: 14px; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-hero, #${DEADLINE_DASHBOARD_ID} .ou-deadline-toolbar, #${DEADLINE_DASHBOARD_ID} .ou-deadline-filters { align-items: stretch; flex-direction: column; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-course-filter, #${DEADLINE_DASHBOARD_ID} .ou-deadline-search { flex-basis: auto; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-month-nav { align-self: flex-start; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-footer { justify-content: flex-start; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-sync-row { align-items: flex-start; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-stats { align-self: flex-start; text-align: left; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-row { grid-template-columns: 22px 66px minmax(0, 1fr); gap: 10px; }
        #${DEADLINE_DASHBOARD_ID} .ou-deadline-open { grid-column: 3; }
      }
    `
  }

  function cleanEventTitle(value) {
    return cleanText(value).replace(/\s+should be completed\s*$/i, "").trim()
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
  }

  function normalizeText(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
  }

  function formatDay(date) {
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit" }).format(date)
  }

  function formatMonth(date) {
    return new Intl.DateTimeFormat("vi-VN", { month: "short" }).format(date).replace(".", "")
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
  }

  function formatTime(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  }

  function to24Hour(hourText, meridiem) {
    const hour = Number(hourText)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null

    const period = normalizeText(meridiem).replace(/\./g, "")
    if (!period || hour > 12) return hour
    if (["pm", "ch"].includes(period)) return hour === 12 ? 12 : hour + 12
    if (["am", "sa"].includes(period)) return hour === 12 ? 0 : hour
    return hour
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  function escapeAttribute(value) {
    return escapeHtml(value)
  }
})()
