(() => {
  "use strict"

  const IS_TOP_COURSE_VIEW = window.top === window.self
    && location.hostname === "elolms.ou.edu.vn"
    && location.pathname.toLowerCase() === "/course/view.php"
  if (!IS_TOP_COURSE_VIEW) return

  const ROOT_ID = "ou-yeah-course-download-root"
  const STYLE_ID = "ou-yeah-course-download-style"
  const TOOLBAR_ID = "ou-yeah-course-download-toolbar"
  const WORKER_FRAME_ID = "ou-yeah-course-download-worker"
  const STORAGE_KEY = `ouYeahCourseDownloadSession:${new URL(location.href).searchParams.get("id") || "course"}`
  const BUTTON_CLASS = "ou-yeah-course-download-button"
  const TERMINAL_JOB_STATES = new Set(["complete", "error", "canceled"])
  const MEDIA_RE = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)(?:[?#]|$)/i
  const HLS_RE = /\.m3u8(?:[?#]|$)/i
  const DASH_RE = /\.mpd(?:[?#]|$)/i
  const COURSE_ROOT_FOLDER = "OU Yeah!"
  const recentJobMessages = new Map()
  const jobWaiters = new Map()

  let refreshTimer = 0
  let courseObserver = null
  let activeSession = null
  let queueRunning = false
  let pauseRequested = false
  let cancelRequested = false
  let panelMinimized = false
  let activeJobId = null
  let activeCancelController = null
  let courseDataPanel = null
  let extensionContextInvalidated = false

  const extensionWindow = /** @type {any} */ (window)
  extensionWindow.OUYeahCourseDownloadApi = Object.freeze({
    isBusy() {
      return queueRunning || Boolean(activeSession && ["running", "paused"].includes(activeSession.status))
    },
    async downloadAllMaterials(options = {}) {
      const hideOnFinish = options.hideOnFinish === true
      if (extensionWindow.OUYeahCourseDownloadApi.isBusy()) {
        throw new Error("Một tiến trình tải học liệu khác đang hoạt động.")
      }

      const scope = document.querySelector(".course-content")
      if (!(scope instanceof HTMLElement)) throw new Error("Không tìm thấy nội dung khóa học.")
      const course = courseMetadata()
      const allowedTypes = new Set(["video", "slide", "script"])
      const requestedTypes = new Set(Array.isArray(options.types)
        ? options.types.filter((type) => allowedTypes.has(type))
        : allowedTypes)
      const resources = scanResources(scope, course)
        .filter((resource) => requestedTypes.has(resource.type))
      if (!resources.length) {
        if (hideOnFinish) closeRoot()
        return { status: "complete", downloaded: 0, failed: 0, locked: 0, resources: [] }
      }

      assignLocalPaths(resources, course)
      try {
        await startSession(course, options.scopeTitle || "Toàn bộ học liệu", resources, {
          manifestFilename: options.manifestFilename || ""
        })
        if (options.waitForResume === true && activeSession?.status === "paused") {
          await waitForMaterialSessionToFinish()
        }
        const result = activeSession
        return {
          status: result?.status || "error",
          downloaded: result?.resources.filter((resource) => resource.downloadStatus === "downloaded").length || 0,
          failed: result?.resources.filter((resource) => resource.downloadStatus === "failed").length || 0,
          locked: result?.resources.filter((resource) => resource.downloadStatus === "locked").length || 0,
          resources: (result?.resources || []).map((resource) => ({
            id: resource.id,
            activityId: resource.activityId,
            type: resource.type,
            title: resource.title,
            sourceUrl: resource.sourceUrl,
            availability: resource.availability,
            completion: resource.completion,
            localPath: resource.localPath,
            downloadStatus: resource.downloadStatus,
            error: resource.error || ""
          }))
        }
      } finally {
        if (hideOnFinish) closeRoot()
      }
    },
    setCourseDataSummary(summary = null) {
      if (!activeSession && courseDataPanel) {
        courseDataPanel = { ...courseDataPanel, ...normalizeCourseDataPanel(summary || {}) }
        renderSessionPanel()
        return true
      }
      if (!activeSession) return false
      activeSession.courseDataSummary = summary && typeof summary === "object"
        ? {
          status: summary.status === "complete" ? "complete" : "building",
          message: String(summary.message || ""),
          completedTasks: Number(summary.completedTasks) || 0,
          totalTasks: Number(summary.totalTasks) || 0,
          entitiesCount: Number(summary.entitiesCount) || 0,
          filesCount: Number(summary.filesCount) || 0,
          startedAt: String(summary.startedAt || activeSession.startedAt || ""),
          etaText: estimateRemainingText(
            Number(summary.completedTasks) || 0,
            Number(summary.totalTasks) || 0,
            summary.startedAt || activeSession.startedAt,
            summary.status === "complete" ? "complete" : "building"
          ),
          errors: Array.isArray(summary.errors) ? summary.errors.map((error) => String(error)) : []
        }
        : null
      activeSession.panelHidden = false
      panelMinimized = false
      persistSession().then(renderSessionPanel).catch(handleError)
      return true
    },
    setCourseDataPanel(summary = null, actions = {}) {
      if (!summary || typeof summary !== "object") return false
      courseDataPanel = {
        ...normalizeCourseDataPanel(summary),
        actions: actions && typeof actions === "object" ? actions : {}
      }
      renderSessionPanel()
      return true
    },
    clearCourseDataPanel() {
      courseDataPanel = null
      if (!activeSession) document.getElementById(ROOT_ID)?.remove()
      return true
    },
    waitForDownloadJob(jobId, timeoutMs = 20 * 60_000) {
      return waitForJob(jobId, timeoutMs)
    },
    dismissPanel() {
      courseDataPanel = null
      if (queueRunning) return false
      if (activeSession && ["complete", "canceled"].includes(activeSession.status)) {
        activeSession.panelHidden = true
        persistSession().catch(() => {})
      }
      panelMinimized = false
      closeRoot()
      return true
    }
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "ou-yeah-download-progress" || !message.jobId) return false
    recentJobMessages.set(message.jobId, message)
    updateActiveProgress(message)

    if (TERMINAL_JOB_STATES.has(message.status)) {
      const waiter = jobWaiters.get(message.jobId)
      if (waiter) {
        jobWaiters.delete(message.jobId)
        waiter(message)
      }
    }
    return false
  })

  init().catch(handleError)

  async function init() {
    injectStyles()
    refreshControls()
    restoreSession(await storageGet(STORAGE_KEY))

    courseObserver = new MutationObserver(scheduleRefresh)
    courseObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(refreshControls, 160)
  }

  function refreshControls() {
    const courseContent = document.querySelector(".course-content")
    if (!(courseContent instanceof HTMLElement)) return

    ensureCourseToolbar(courseContent)
    courseContent.querySelectorAll(".course-section").forEach((section) => {
      if (section instanceof HTMLElement) ensureSectionButton(section)
    })
  }

  function ensureCourseToolbar(courseContent) {
    let toolbar = document.getElementById(TOOLBAR_ID)
    if (!(toolbar instanceof HTMLElement)) {
      toolbar = document.createElement("div")
      toolbar.id = TOOLBAR_ID
      toolbar.innerHTML = `
        <button type="button" class="${BUTTON_CLASS} is-course" data-ou-course-download-scope="course" title="Tải toàn bộ học liệu của khóa học" aria-label="Tải toàn bộ học liệu của khóa học">
          <span class="ou-yeah-course-download-icon" aria-hidden="true"></span>
          <span>Tải toàn bộ</span>
        </button>
      `
      toolbar.querySelector("button")?.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        openPreview(courseContent, "Toàn bộ khóa học").catch(handleError)
      })
    }

    const collapseAll = document.getElementById("collapsesections")
    const nativeActions = collapseAll?.parentElement
    if (nativeActions instanceof HTMLElement) {
      toolbar.classList.add("is-inline")
      toolbar.classList.remove("is-fallback")
      if (toolbar.parentElement !== nativeActions || toolbar.nextElementSibling !== collapseAll) {
        nativeActions.insertBefore(toolbar, collapseAll)
      }
      return
    }

    toolbar.classList.add("is-fallback")
    toolbar.classList.remove("is-inline")
    if (courseContent.parentElement && toolbar.nextElementSibling !== courseContent) {
      courseContent.parentElement.insertBefore(toolbar, courseContent)
    }
  }

  function ensureSectionButton(section) {
    const header = section.querySelector(":scope > .course-section-header")
    if (!(header instanceof HTMLElement)) return
    if (!hasTargetActivities(section)) return

    header.classList.add("ou-yeah-course-download-header")
    if (header.firstElementChild instanceof HTMLElement) {
      header.firstElementChild.classList.add("ou-yeah-course-download-header-main")
    }
    if (header.querySelector(`:scope > .${BUTTON_CLASS}`)) return

    const title = sectionTitle(section) || "Mục học tập"
    const button = document.createElement("button")
    button.type = "button"
    button.className = BUTTON_CLASS
    button.title = `Tải học liệu: ${title}`
    button.setAttribute("aria-label", `Tải học liệu: ${title}`)
    button.innerHTML = '<span class="ou-yeah-course-download-icon" aria-hidden="true"></span><span class="ou-yeah-course-download-sr-only">Tải học liệu</span>'
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      openPreview(section, title).catch(handleError)
    })
    header.appendChild(button)
  }

  function hasTargetActivities(scope) {
    return Array.from(scope.querySelectorAll(".activity")).some((activity) => Boolean(classifyActivity(activity)))
  }

  async function openPreview(scope, scopeTitle) {
    if (document.documentElement.dataset.ouYeahCourseDataBusy === "true") return
    if (document.getElementById("ou-yeah-course-data-export-root")?.dataset.mode === "preview") return
    if (queueRunning || (activeSession && ["running", "paused"].includes(activeSession.status))) {
      panelMinimized = false
      renderSessionPanel()
      return
    }

    const course = courseMetadata()
    const resources = scanResources(scope, course)
    if (!resources.length) {
      showNotice("Không tìm thấy Video, Slide hoặc Script trong mục này.", true)
      return
    }

    assignLocalPaths(resources, course)
    const ready = resources.filter((resource) => resource.availability === "available")
    const locked = resources.filter((resource) => resource.availability === "locked")
    const completion = courseProgress()
    const root = ensureRoot()
    root.dataset.mode = "preview"
    root.innerHTML = `
      <div class="ou-yeah-course-download-backdrop" data-ou-download-close></div>
      <section class="ou-yeah-course-download-dialog" role="dialog" aria-modal="true" aria-labelledby="ou-yeah-course-download-title">
        <header>
          <div>
            <span class="ou-yeah-course-download-eyebrow">OU YEAH! · TẢI HỌC LIỆU</span>
            <h2 id="ou-yeah-course-download-title">${escapeHtml(scopeTitle)}</h2>
            <p>${completion == null ? "Kiểm tra theo trạng thái ELOLMS hiện tại." : `${completion}% hoàn thành · chỉ tải các mục ELOLMS đang cho phép truy cập.`}</p>
          </div>
          <button type="button" class="ou-yeah-course-download-close" data-ou-download-close aria-label="Đóng">×</button>
        </header>
        <div class="ou-yeah-course-download-summary">
          <span><strong data-ou-ready-count>${ready.length}</strong> sẵn sàng</span>
          <span><strong>${locked.length}</strong> bị khóa</span>
          <span><strong>${resources.length}</strong> tổng cộng</span>
        </div>
        <fieldset class="ou-yeah-course-download-types">
          <legend>Loại học liệu</legend>
          ${typeCheckbox("video", "Video", ready)}
          ${typeCheckbox("slide", "Slide", ready)}
          ${typeCheckbox("script", "Script", ready)}
        </fieldset>
        ${locked.length ? lockedPreview(locked) : ""}
        <div class="ou-yeah-course-download-warning">
          <strong>Trước khi bắt đầu</strong>
          <span>Giữ tab khóa học này mở trong lúc tải. Bạn vẫn có thể sử dụng tab khác; OU Yeah! không tự mở khóa hay đánh dấu hoàn thành bài học.</span>
        </div>
        <footer>
          <button type="button" class="ou-yeah-course-download-secondary" data-ou-download-close>Để sau</button>
          <button type="button" class="ou-yeah-course-download-primary" data-ou-download-start ${ready.length ? "" : "disabled"}>
            Tải ${ready.length} mục khả dụng
          </button>
        </footer>
      </section>
    `

    root.querySelectorAll("[data-ou-download-close]").forEach((element) => {
      element.addEventListener("click", closeRoot)
    })
    root.querySelectorAll("[data-ou-download-type]").forEach((element) => {
      element.addEventListener("change", () => updatePreviewSelection(root, ready))
    })
    root.querySelector("[data-ou-download-start]")?.addEventListener("click", () => {
      const types = selectedTypes(root)
      const selected = resources.filter((resource) => resource.availability === "locked" || types.has(resource.type))
      startSession(course, scopeTitle, selected).catch(handleError)
    })
  }

  function typeCheckbox(type, label, resources) {
    const count = resources.filter((resource) => resource.type === type).length
    return `
      <label class="${count ? "" : "is-disabled"}">
        <input type="checkbox" data-ou-download-type="${type}" ${count ? "checked" : "disabled"}>
        <span>${label}</span><small>${count}</small>
      </label>
    `
  }

  function lockedPreview(resources) {
    const rows = resources.slice(0, 8).map((resource) => `
      <li>
        <span>${escapeHtml(resource.title)}</span>
        <small>${escapeHtml(resource.restriction || "ELOLMS chưa cung cấp link truy cập.")}</small>
      </li>
    `).join("")
    const more = resources.length > 8 ? `<p>Và ${resources.length - 8} mục bị khóa khác. Tất cả sẽ được ghi vào manifest.</p>` : ""
    return `
      <details class="ou-yeah-course-download-locked">
        <summary>${resources.length} mục chưa thể tải</summary>
        <ul>${rows}</ul>${more}
      </details>
    `
  }

  function selectedTypes(root) {
    return new Set(Array.from(root.querySelectorAll("[data-ou-download-type]:checked"))
      .map((element) => element.getAttribute("data-ou-download-type"))
      .filter(Boolean))
  }

  function updatePreviewSelection(root, readyResources) {
    const types = selectedTypes(root)
    const count = readyResources.filter((resource) => types.has(resource.type)).length
    const countElement = root.querySelector("[data-ou-ready-count]")
    const startButton = root.querySelector("[data-ou-download-start]")
    if (countElement) countElement.textContent = String(count)
    if (startButton instanceof HTMLButtonElement) {
      startButton.disabled = count === 0
      startButton.textContent = `Tải ${count} mục khả dụng`
    }
  }

  async function startSession(course, scopeTitle, resources, options = {}) {
    closeRoot()
    courseDataPanel = null
    panelMinimized = false
    pauseRequested = false
    cancelRequested = false
    activeCancelController = new AbortController()
    activeSession = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      course,
      scopeTitle,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      manifestFilename: String(options.manifestFilename || ""),
      panelHidden: false,
      courseDataSummary: null,
      currentIndex: 0,
      resources: resources.map((resource) => ({
        ...resource,
        downloadStatus: resource.availability === "locked" ? "locked" : "pending",
        error: ""
      }))
    }
    await persistSession()
    renderSessionPanel()
    await runQueue()
  }

  function waitForMaterialSessionToFinish() {
    return new Promise((resolve) => {
      const onFinished = (event) => {
        const status = event.detail?.status
        if (!["complete", "canceled"].includes(status)) return
        document.removeEventListener("ou-yeah-course-material-session-finished", onFinished)
        resolve()
      }
      document.addEventListener("ou-yeah-course-material-session-finished", onFinished)
    })
  }

  async function runQueue() {
    if (!activeSession || queueRunning) return
    queueRunning = true
    activeSession.status = "running"
    renderSessionPanel()

    try {
      for (let index = activeSession.currentIndex; index < activeSession.resources.length; index += 1) {
        activeSession.currentIndex = index
        const resource = activeSession.resources[index]
        if (resource.downloadStatus === "locked" || resource.downloadStatus === "downloaded") {
          activeSession.currentIndex = index + 1
          continue
        }

        if (cancelRequested) break
        if (pauseRequested) {
          activeSession.status = "paused"
          break
        }

        resource.downloadStatus = "downloading"
        resource.error = ""
        await persistSession()
        renderSessionPanel()

        try {
          if (resource.type === "video") {
            await downloadVideoResource(resource)
          } else {
            await downloadFileResource(resource)
          }
          resource.downloadStatus = "downloaded"
        } catch (error) {
          if (cancelRequested || error?.code === "OU_YEAH_DOWNLOAD_CANCELED") {
            resource.downloadStatus = "pending"
            resource.error = ""
            activeSession.currentIndex = index
          } else {
            resource.downloadStatus = "failed"
            resource.error = readableError(error)
            activeSession.currentIndex = index + 1
          }
        }

        if (!cancelRequested && activeSession.currentIndex === index) activeSession.currentIndex = index + 1
        await persistSession()
        renderSessionPanel()
      }

      if (cancelRequested) {
        activeSession.status = "canceled"
      } else if (pauseRequested) {
        activeSession.status = "paused"
      } else if (activeSession.currentIndex >= activeSession.resources.length) {
        activeSession.status = "complete"
      }

      if (activeSession.status === "complete") {
        await downloadManifest(activeSession)
      }
    } finally {
      const finishedStatus = activeSession?.status
      queueRunning = false
      pauseRequested = false
      cancelRequested = false
      removeWorkerFrame()
      activeCancelController = null
      await persistSession()
      renderSessionPanel()
      if (["complete", "canceled"].includes(finishedStatus)) {
        document.dispatchEvent(new CustomEvent("ou-yeah-course-material-session-finished", {
          detail: { status: finishedStatus }
        }))
      }
    }
  }

  async function downloadFileResource(resource) {
    throwIfCancellationRequested()
    const extension = await resolveResourceExtension(resource, activeCancelController?.signal)
    fitResourceDownloadPath(resource, extension)

    throwIfCancellationRequested()
    const response = await sendRuntimeMessage({
      type: "ou-yeah-download-course-resource",
      url: resource.sourceUrl,
      filename: resource.downloadPath
    })
    if (!response?.ok || !response.jobId) throw new Error(response?.error || "Không thể bắt đầu tải tệp.")
    activeJobId = response.jobId
    if (cancelRequested) {
      sendRuntimeMessage({ type: "ou-yeah-cancel-download-job", jobId: response.jobId }).catch(() => {})
    }
    try {
      const result = await waitForJob(response.jobId)
      if (result.status === "canceled") throw cancellationError()
      if (result.status === "error") throw new Error(result.label || "Tải tệp thất bại.")
    } finally {
      if (activeJobId === response.jobId) activeJobId = null
    }
  }

  async function downloadVideoResource(resource) {
    throwIfCancellationRequested()
    await sendRuntimeMessage({ type: "ou-yeah-clear-media-candidates" }).catch(() => null)
    const candidates = await discoverVideoCandidates(resource.sourceUrl)
    throwIfCancellationRequested()
    const candidate = chooseMediaCandidate(candidates)
    if (!candidate) {
      if (candidates.some((item) => DASH_RE.test(item.url))) {
        throw new Error("Video dùng DASH, phiên bản hiện tại chưa hỗ trợ tải an toàn.")
      }
      throw new Error("Không tìm thấy luồng video sau khi tải trang bài học.")
    }

    const extension = HLS_RE.test(candidate.url) ? ".ts" : extensionFromValue(candidate.url) || ".mp4"
    fitResourceDownloadPath(resource, extension)
    const filename = resource.downloadPath

    throwIfCancellationRequested()
    const response = await sendRuntimeMessage({
      type: "ou-yeah-download-media",
      url: candidate.url,
      filename,
      pageTitle: resource.title,
      courseBatch: true
    })
    if (!response?.ok) throw new Error(response?.error || "Không thể bắt đầu tải video.")
    if (!response.jobId) return

    activeJobId = response.jobId
    if (cancelRequested) {
      sendRuntimeMessage({ type: "ou-yeah-cancel-download-job", jobId: response.jobId }).catch(() => {})
    }
    try {
      const result = await waitForJob(response.jobId, 45 * 60_000)
      if (result.status === "canceled") throw cancellationError()
      if (result.status === "error") throw new Error(result.label || "Tải video thất bại.")
    } finally {
      if (activeJobId === response.jobId) activeJobId = null
    }
  }

  async function discoverVideoCandidates(url) {
    const signal = activeCancelController?.signal
    const staticCandidates = await discoverStaticVideoCandidates(url, signal)
    throwIfCancellationRequested()
    if (staticCandidates.some((candidate) => MEDIA_RE.test(candidate.url) && !DASH_RE.test(candidate.url))) {
      return dedupeMediaCandidates(staticCandidates)
    }

    const frame = ensureWorkerFrame()
    const loaded = new Promise((resolve, reject) => {
      let timeout
      const cleanup = () => {
        window.clearTimeout(timeout)
        frame.removeEventListener("load", onLoad)
        signal?.removeEventListener("abort", onAbort)
      }
      const onLoad = () => {
        cleanup()
        resolve()
      }
      const onAbort = () => {
        cleanup()
        reject(cancellationError())
      }
      timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error("Trang video tải quá lâu."))
      }, 25_000)
      frame.addEventListener("load", onLoad, { once: true })
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    throwIfCancellationRequested()
    frame.src = url
    await loaded

    const candidates = [...staticCandidates]
    for (let attempt = 0; attempt < 6; attempt += 1) {
      throwIfCancellationRequested()
      await delay(attempt === 0 ? 2600 : 1400, signal)
      collectFrameCandidates(frame).forEach((candidate) => addMediaCandidate(candidates, candidate.url, candidate.source))
      const background = await sendRuntimeMessage({ type: "ou-yeah-get-media-candidates" }).catch(() => null)
      background?.candidates?.forEach((candidate) => addMediaCandidate(candidates, candidate.url, candidate.source))
      if (candidates.some((candidate) => MEDIA_RE.test(candidate.url) && !DASH_RE.test(candidate.url))) break
    }
    return dedupeMediaCandidates(candidates)
  }

  async function discoverStaticVideoCandidates(url, signal) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
        signal
      })
      if (!response.ok) return []

      const documentUrl = response.url || url
      const page = new DOMParser().parseFromString(await response.text(), "text/html")
      const candidates = collectDocumentMediaCandidates(page, documentUrl)
      return dedupeMediaCandidates(candidates)
    } catch {
      return []
    }
  }

  function collectDocumentMediaCandidates(page, baseUrl) {
    const candidates = []
    page.querySelectorAll("video[src], source[src], a[href]").forEach((element) => {
      const rawUrl = element.getAttribute("src") || element.getAttribute("href") || ""
      try {
        addMediaCandidate(candidates, new URL(rawUrl, baseUrl).href, "page-html")
      } catch {
        // Ignore malformed URLs from the learning page.
      }
    })
    return candidates
  }

  function collectFrameCandidates(frame) {
    const candidates = []
    try {
      const frameDocument = frame.contentDocument
      frameDocument?.querySelectorAll("video[src], source[src], a[href]").forEach((element) => {
        const url = element.getAttribute("src") || element.getAttribute("href") || ""
        if (MEDIA_RE.test(url)) candidates.push({ url: new URL(url, frame.src).href, source: "worker-dom" })
      })
      frame.contentWindow?.performance.getEntriesByType("resource").forEach((entry) => {
        if (MEDIA_RE.test(entry.name)) candidates.push({ url: entry.name, source: "worker-network" })
      })
    } catch {
      // Cross-origin players are captured by background webRequest instead.
    }
    return candidates
  }

  function addMediaCandidate(candidates, rawUrl, source) {
    try {
      const url = new URL(rawUrl, location.href).href
      if (!MEDIA_RE.test(url) || /\.(?:ts|m4s)(?:[?#]|$)/i.test(url)) return
      candidates.push({ url, source: String(source || "network") })
    } catch {
      // Ignore malformed network entries.
    }
  }

  function chooseMediaCandidate(candidates) {
    return dedupeMediaCandidates(candidates)
      .filter((candidate) => !DASH_RE.test(candidate.url))
      .sort((a, b) => mediaScore(b) - mediaScore(a))[0] || null
  }

  function mediaScore(candidate) {
    let score = 0
    if (/\.mp4(?:[?#]|$)/i.test(candidate.url)) score += 120
    if (HLS_RE.test(candidate.url)) score += 90
    if (/vimeo/i.test(candidate.url) || /vimeo/i.test(candidate.source)) score += 25
    if (/headers|config|master/i.test(candidate.source + candidate.url)) score += 12
    return score
  }

  function dedupeMediaCandidates(candidates) {
    return Array.from(new Map(candidates.map((candidate) => [candidate.url, candidate])).values())
  }

  /** @returns {HTMLIFrameElement} */
  function ensureWorkerFrame() {
    let frame = document.getElementById(WORKER_FRAME_ID)
    if (frame instanceof HTMLIFrameElement) return frame
    const createdFrame = document.createElement("iframe")
    createdFrame.id = WORKER_FRAME_ID
    createdFrame.title = "OU Yeah! đang đọc trang video"
    createdFrame.setAttribute("aria-hidden", "true")
    document.body.appendChild(createdFrame)
    return createdFrame
  }

  function removeWorkerFrame() {
    document.getElementById(WORKER_FRAME_ID)?.remove()
  }

  async function resolveResourceExtension(resource, signal) {
    if (resource.extension) return resource.extension
    try {
      const response = await fetch(resource.sourceUrl, {
        method: "HEAD",
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
        signal
      })
      const disposition = response.headers.get("content-disposition") || ""
      const dispositionName = filenameFromDisposition(disposition)
      resource.extension = extensionFromValue(dispositionName || response.url)
    } catch {
      // Moodle installations can reject HEAD; use the activity icon as fallback.
    }
    resource.extension ||= inferExtensionFromIcon(resource.iconHint)
    return resource.extension
  }

  function filenameFromDisposition(value) {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
    if (encoded) {
      try {
        return decodeURIComponent(encoded.replace(/^"|"$/g, ""))
      } catch {
        return encoded
      }
    }
    return /filename="?([^";]+)"?/i.exec(value)?.[1] || ""
  }

  function inferExtensionFromIcon(iconHint) {
    const normalized = normalizeText(iconHint)
    if (/pdf/.test(normalized)) return ".pdf"
    if (/powerpoint|presentation|ppt/.test(normalized)) return ".pptx"
    if (/word|document|docx/.test(normalized)) return ".docx"
    if (/excel|spreadsheet|xlsx/.test(normalized)) return ".xlsx"
    if (/archive|zip/.test(normalized)) return ".zip"
    return ""
  }

  function scanResources(scope, course) {
    return Array.from(scope.querySelectorAll(".activity")).flatMap((activity) => {
      const type = classifyActivity(activity)
      if (!type) return []

      const nameElement = activity.querySelector(".activityname .instancename, .activityname, .instancename")
      const title = cleanVisibleText(nameElement) || `${type} ${activity.id || ""}`.trim()
      const link = nameElement?.closest("a[href]") || nameElement?.querySelector("a[href]")
      const sourceCandidate = link instanceof HTMLAnchorElement ? link.href : ""
      const sourceUrl = sameCourseUrl(sourceCandidate)
      const restriction = cleanVisibleText(activity.querySelector(".availabilityinfo"))
      const availability = sourceUrl && !restriction ? "available" : "locked"
      const activityId = activityIdFromUrl(sourceUrl) || activity.dataset.id || activity.id.replace(/^module-/, "")
      const sections = sectionPath(activity)
      const icon = activity.querySelector("img.activityicon, .activityiconcontainer img")

      return [{
        id: `${course.id || "course"}-${activityId || crypto.randomUUID()}`,
        activityId: activityId || null,
        type,
        title,
        sourceUrl: sourceUrl || null,
        availability,
        restriction: restriction || (sourceUrl ? "" : sourceCandidate ? "Liên kết ngoài miền không được tải tự động." : "ELOLMS chưa cung cấp link truy cập."),
        completion: activityCompletion(activity),
        sections,
        iconHint: `${icon?.getAttribute("src") || ""} ${icon?.getAttribute("alt") || ""}`,
        extension: extensionFromValue(title),
        localPath: "",
        downloadPath: ""
      }]
    })
  }

  function classifyActivity(activity) {
    const title = normalizeText(cleanVisibleText(activity.querySelector(".activityname, .instancename")))
    if (/^\[xem\]\s+video\b/.test(title)) return "video"
    if (/^\[tai ve\]\s+slide\b/.test(title)) return "slide"
    if (/^\[tai ve\]\s+script\b/.test(title)) return "script"
    return ""
  }

  function sectionPath(activity) {
    const sections = []
    let current = activity.closest(".course-section")
    while (current instanceof HTMLElement) {
      const title = sectionTitle(current)
      if (title) sections.unshift({
        id: current.dataset.id || current.dataset.sectionid || current.id || null,
        title,
        directory: ""
      })
      current = current.parentElement?.closest(".course-section") || null
    }
    return sections
  }

  function sectionTitle(section) {
    const title = section.querySelector(":scope > .course-section-header .sectionname")
    return cleanVisibleText(title)
  }

  function activityCompletion(activity) {
    const completion = activity.querySelector('[data-region="completion-info"], .activity-completion')
    const text = normalizeText(`${completion?.textContent || ""} ${completion?.getAttribute("aria-label") || ""} ${completion?.getAttribute("title") || ""}`)
    if (/chua hoan thanh|not complete|incomplete/.test(text)) return "incomplete"
    if (/da hoan thanh|completed|done/.test(text)) return "completed"
    const pressed = completion?.querySelector('[aria-pressed="true"]')
    return pressed ? "completed" : "unknown"
  }

  function assignLocalPaths(resources, course) {
    const duplicates = new Map()
    const sectionDirectories = new Map()
    const usedSectionDirectories = new Map()
    resources.forEach((resource) => {
      const pathKeys = []
      const directoryParts = []
      resource.sections.forEach((section) => {
        const parentKey = pathKeys[pathKeys.length - 1] || "root"
        const key = `${parentKey}/${section.id || section.title}`
        if (!sectionDirectories.has(key)) {
          const used = usedSectionDirectories.get(parentKey) || new Set()
          const base = compactSectionDirectory(section.title)
          let directory = base
          let suffix = 2
          while (used.has(directory.toLowerCase())) {
            directory = compactPathSegment(`${base} (${suffix})`, 22)
            suffix += 1
          }
          used.add(directory.toLowerCase())
          usedSectionDirectories.set(parentKey, used)
          sectionDirectories.set(key, directory)
        }
        const directory = sectionDirectories.get(key)
        section.directory = directory
        directoryParts.push(directory)
        pathKeys.push(key)
      })
      const relativeDirectory = directoryParts.filter(Boolean).join("/")
      const downloadDirectory = [COURSE_ROOT_FOLDER, sanitizeSegment(course.title, 24), relativeDirectory].filter(Boolean).join("/")
      const baseTitle = sanitizeSegment(resource.title, 60)
      const key = `${downloadDirectory}/${baseTitle}`.toLowerCase()
      const count = (duplicates.get(key) || 0) + 1
      duplicates.set(key, count)
      const suffix = count > 1 ? ` (${count})` : ""
      const leafName = `${baseTitle}${suffix}${resource.extension || ""}`
      resource.localPath = [relativeDirectory, leafName].filter(Boolean).join("/")
      resource.downloadPath = `${downloadDirectory}/${leafName}`
    })
  }

  function fitResourceDownloadPath(resource, extension = "") {
    const segments = String(resource.downloadPath || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
    if (!segments.length) throw new Error("Không tạo được đường dẫn lưu học liệu.")

    const lastIndex = segments.length - 1
    if (extension && !segments[lastIndex].toLowerCase().endsWith(extension)) {
      segments[lastIndex] += extension
    }
    const fitted = compactPathSegments(segments, 180)
    resource.downloadPath = fitted.join("/")
    resource.localPath = fitted.slice(2).join("/")
  }

  function compactPathSegments(segments, maxLength) {
    const compacted = segments.map((segment) => String(segment))
    let joined = compacted.join("/")
    if (joined.length > maxLength) {
      const leafIndex = compacted.length - 1
      const excess = joined.length - maxLength
      compacted[leafIndex] = truncatePathSegment(
        compacted[leafIndex],
        Math.max(16, compacted[leafIndex].length - excess),
        true
      )
    }
    return compacted
  }

  function compactSectionDirectory(title) {
    const cleaned = sanitizeSegment(title, 22)
    const numbered = /^(CHƯƠNG|Chủ đề|Phần)\s+[^-–—]+/i.exec(cleaned)?.[0]?.trim()
    return compactPathSegment(numbered || cleaned, 22)
  }

  function compactPathSegment(segment, maxLength) {
    return String(segment || "").slice(0, Math.max(1, maxLength)).trimEnd()
  }

  function truncatePathSegment(segment, maxLength, preserveExtension) {
    if (segment.length <= maxLength) return segment
    const extension = preserveExtension ? /\.[a-z0-9]{1,8}$/i.exec(segment)?.[0] || "" : ""
    const available = Math.max(1, maxLength - extension.length)
    return `${segment.slice(0, available).trimEnd()}${extension}`
  }

  function courseMetadata() {
    const title = cleanVisibleText(document.querySelector("h1"))
      || document.title.replace(/\s*\|\s*ELOLMS.*$/i, "").trim()
      || `Khóa học ${courseId()}`
    const code = cleanVisibleText(document.querySelector(".course-header .text-muted, [data-region='course-content'] .text-muted"))
    return {
      id: courseId(),
      title,
      code: code || null,
      sourceUrl: `${location.origin}${location.pathname}?id=${encodeURIComponent(courseId())}`,
      progress: courseProgress()
    }
  }

  function courseId() {
    return new URL(location.href).searchParams.get("id") || ""
  }

  function courseProgress() {
    const values = Array.from(document.querySelectorAll('[role="progressbar"][aria-valuenow]'))
      .map((element) => Number(element.getAttribute("aria-valuenow")))
      .filter(Number.isFinite)
    return values.length ? Math.max(...values) : null
  }

  async function downloadManifest(session) {
    const manifest = buildManifest(session)
    const manifestFilename = session.manifestFilename
      ? sanitizeSegment(session.manifestFilename, 120)
      : `ou-yeah-course-manifest-${sanitizeSegment(session.scopeTitle || "hoc-lieu", 72)}.json`
    const filename = `${COURSE_ROOT_FOLDER}/${sanitizeSegment(session.course.title, 24)}/${manifestFilename}`
    const response = await sendRuntimeMessage({
      type: "ou-yeah-download-course-manifest",
      filename,
      content: JSON.stringify(manifest, null, 2)
    })
    if (!response?.ok || !response.jobId) {
      session.manifestError = response?.error || "Không thể tạo manifest."
      return
    }
    const result = await waitForJob(response.jobId)
    if (result.status === "error") session.manifestError = result.label || "Không thể tải manifest."
  }

  function buildManifest(session) {
    const counts = countStatuses(session.resources)
    const sectionRoots = []
    const nodeByPath = new Map()

    session.resources.forEach((resource) => {
      let children = sectionRoots
      let path = ""
      resource.sections.forEach((section) => {
        path += `/${section.id || section.title}`
        let node = nodeByPath.get(path)
        if (!node) {
          node = { id: section.id, title: section.title, directory: section.directory, children: [], resources: [] }
          nodeByPath.set(path, node)
          children.push(node)
        }
        children = node.children
      })
      const leafPath = resource.sections.reduce((value, section) => `${value}/${section.id || section.title}`, "")
      const leaf = nodeByPath.get(leafPath)
      leaf?.resources.push(manifestResource(resource))
    })

    return {
      schemaVersion: 1,
      generator: { name: "OU Yeah!", version: chrome.runtime.getManifest().version },
      generatedAt: new Date().toISOString(),
      course: session.course,
      scope: { title: session.scopeTitle, startedAt: session.startedAt, status: session.status },
      download: counts,
      instructionsForAgents: [
        "Use this manifest as the canonical index for the downloaded course materials.",
        "Do not assume locked, failed or missing resources exist on disk.",
        "Resolve localPath values relative to the directory containing this manifest."
      ],
      sections: sectionRoots
    }
  }

  function manifestResource(resource) {
    return {
      type: resource.type,
      activityId: resource.activityId,
      title: resource.title,
      sourceUrl: resource.sourceUrl,
      availability: resource.availability,
      restriction: resource.restriction || null,
      completion: resource.completion,
      downloadStatus: resource.downloadStatus,
      localPath: resource.downloadStatus === "downloaded" ? resource.localPath : null,
      error: resource.error || null
    }
  }

  function countStatuses(resources) {
    const result = { total: resources.length, downloaded: 0, locked: 0, failed: 0, pending: 0 }
    resources.forEach((resource) => {
      if (resource.downloadStatus in result) result[resource.downloadStatus] += 1
      else if (resource.downloadStatus === "downloading") result.pending += 1
    })
    return result
  }

  function estimateRemainingText(completed, total, startedAt, status) {
    if (!total || completed >= total || !["running", "building"].includes(status)) return ""
    const started = Date.parse(String(startedAt || ""))
    if (!Number.isFinite(started) || completed <= 0) return "Còn lại: đang tính"
    const elapsed = Math.max(1, Date.now() - started)
    const remaining = Math.max(1, Math.round((elapsed / completed) * (total - completed)))
    return `Còn khoảng ${formatDuration(remaining)}`
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1000))
    if (seconds < 60) return `${seconds} giây`
    const minutes = Math.ceil(seconds / 60)
    if (minutes < 60) return `${minutes} phút`
    const hours = Math.floor(minutes / 60)
    const restMinutes = minutes % 60
    return restMinutes ? `${hours} giờ ${restMinutes} phút` : `${hours} giờ`
  }

  function renderSessionPanel() {
    if (courseDataPanel && !activeSession) {
      renderCourseDataPanel()
      return
    }
    if (!activeSession) return
    if (activeSession.panelHidden && ["complete", "canceled"].includes(activeSession.status)) {
      closeRoot()
      return
    }
    if (panelMinimized) {
      renderMinimizedLauncher()
      return
    }

    const root = ensureRoot()
    root.dataset.mode = "session"
    const counts = countStatuses(activeSession.resources)
    const readyTotal = activeSession.resources.filter((resource) => resource.availability === "available").length
    const processed = counts.downloaded + counts.failed
    const percent = readyTotal ? Math.round((processed / readyTotal) * 100) : 100
    const current = activeSession.resources[activeSession.currentIndex]
    const failedResources = activeSession.resources.filter((resource) => resource.downloadStatus === "failed")
    const statusText = sessionStatusText(activeSession.status, current)
    const etaText = estimateRemainingText(processed, readyTotal, activeSession.startedAt, activeSession.status)
    const canResume = activeSession.status === "paused"
    const isActive = activeSession.status === "running"

    root.innerHTML = `
      <aside class="ou-yeah-course-download-panel" aria-live="polite">
        <div class="ou-yeah-course-download-panel-head">
          <div>
            <span class="ou-yeah-course-download-eyebrow">OU YEAH! · HỌC LIỆU</span>
            <strong>${escapeHtml(statusText)}</strong>
            <small>${processed}/${readyTotal} mục · ${counts.locked} bị khóa · ${counts.failed} lỗi${etaText ? ` · ${etaText}` : ""}</small>
          </div>
          <button type="button" data-ou-download-dismiss aria-label="Thu nhỏ bảng tiến trình" title="Thu nhỏ">−</button>
        </div>
        <div class="ou-yeah-course-download-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width:${percent}%"></span>
        </div>
        <div class="ou-yeah-course-download-current">${current ? escapeHtml(current.title) : "Manifest sẽ nằm trong thư mục khóa học."}</div>
        ${courseDataSummaryMarkup(activeSession.courseDataSummary)}
        ${failedResources.length ? failedResourcesMarkup(failedResources) : ""}
        <div class="ou-yeah-course-download-actions">
          ${isActive ? '<button type="button" data-ou-download-pause>Tạm dừng</button><button type="button" data-ou-download-cancel>Hủy ngay</button>' : ""}
          ${canResume ? '<button type="button" class="is-primary" data-ou-download-resume>Tiếp tục</button>' : ""}
          ${activeSession.status === "complete" && counts.failed ? '<button type="button" class="is-primary" data-ou-download-retry>Thử lại mục lỗi</button>' : ""}
        </div>
      </aside>
    `

    root.querySelector("[data-ou-download-dismiss]")?.addEventListener("click", minimizeSessionPanel)
    root.querySelector("[data-ou-download-pause]")?.addEventListener("click", requestPause)
    root.querySelector("[data-ou-download-cancel]")?.addEventListener("click", requestCancel)
    root.querySelector("[data-ou-download-resume]")?.addEventListener("click", resumeSession)
    root.querySelector("[data-ou-download-retry]")?.addEventListener("click", retryFailed)
  }

  function renderCourseDataPanel() {
    if (!courseDataPanel) return
    const root = ensureRoot()
    root.dataset.mode = "course-data"
    const actions = courseDataPanel.actions || {}
    if (courseDataPanel.minimized) {
      root.innerHTML = `
        <button type="button" class="ou-yeah-course-download-minimized" data-ou-course-data-restore>
          <span class="ou-yeah-course-download-icon" aria-hidden="true"></span>
          <span class="ou-yeah-course-download-minimized-copy"><strong>${escapeHtml(courseDataPanel.title)}</strong><small>${escapeHtml(courseDataPanel.message)}</small></span>
          <span class="ou-yeah-course-download-minimized-progress" aria-hidden="true"><i style="width:${courseDataPanel.percent}%"></i></span>
        </button>
      `
      root.querySelector("[data-ou-course-data-restore]")?.addEventListener("click", () => actions.onRestore?.())
      return
    }

    const hasProgress = courseDataPanel.totalTasks > 0
    const metrics = hasProgress
      ? `${courseDataPanel.completedTasks}/${courseDataPanel.totalTasks} bước · ${courseDataPanel.entitiesCount} thực thể · ${courseDataPanel.filesCount} tệp${courseDataPanel.etaText ? ` · ${courseDataPanel.etaText}` : ""}`
      : courseDataPanel.metrics || ""
    const errors = courseDataPanel.errors?.length
      ? `<details class="ou-yeah-course-download-failures" open><summary>${courseDataPanel.errors.length} lỗi</summary><ul>${courseDataPanel.errors.slice(-8).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></details>`
      : ""

    root.innerHTML = `
      <aside class="ou-yeah-course-download-panel" data-state="${escapeHtml(courseDataPanel.status)}" aria-live="polite">
        <div class="ou-yeah-course-download-panel-head">
          <div>
            <span class="ou-yeah-course-download-eyebrow">${escapeHtml(courseDataPanel.eyebrow)}</span>
            <strong>${escapeHtml(courseDataPanel.title)}</strong>
            <small>${escapeHtml(metrics)}</small>
          </div>
          <button type="button" data-ou-course-data-minimize aria-label="Thu nhỏ bảng tiến trình" title="Thu nhỏ">−</button>
        </div>
        <div class="ou-yeah-course-download-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${courseDataPanel.percent}">
          <span style="width:${courseDataPanel.percent}%"></span>
        </div>
        <div class="ou-yeah-course-download-current">${escapeHtml(courseDataPanel.current || courseDataPanel.message)}</div>
        ${errors}
        <div class="ou-yeah-course-download-actions">
          ${actions.onPause ? '<button type="button" data-ou-course-data-pause>Tạm dừng</button>' : ""}
          ${actions.onResume ? '<button type="button" data-ou-course-data-resume>Tiếp tục</button>' : ""}
          ${actions.onCancel ? '<button type="button" data-ou-course-data-cancel>Hủy</button>' : ""}
          ${actions.onRetry ? '<button type="button" class="is-primary" data-ou-course-data-retry>Chạy lại</button>' : ""}
          ${actions.onNew ? '<button type="button" class="is-primary" data-ou-course-data-new>Xuất bản mới</button>' : ""}
          ${actions.onDismiss ? '<button type="button" data-ou-course-data-dismiss>Đóng</button>' : ""}
        </div>
      </aside>
    `
    root.querySelector("[data-ou-course-data-minimize]")?.addEventListener("click", () => actions.onMinimize?.())
    root.querySelector("[data-ou-course-data-pause]")?.addEventListener("click", () => actions.onPause?.())
    root.querySelector("[data-ou-course-data-resume]")?.addEventListener("click", () => actions.onResume?.())
    root.querySelector("[data-ou-course-data-cancel]")?.addEventListener("click", () => actions.onCancel?.())
    root.querySelector("[data-ou-course-data-retry]")?.addEventListener("click", () => actions.onRetry?.())
    root.querySelector("[data-ou-course-data-new]")?.addEventListener("click", () => actions.onNew?.())
    root.querySelector("[data-ou-course-data-dismiss]")?.addEventListener("click", () => actions.onDismiss?.())
  }

  function normalizeCourseDataPanel(summary) {
    const totalTasks = Math.max(0, Number(summary.totalTasks) || 0)
    const completedTasks = Math.max(0, Math.min(totalTasks || Number(summary.completedTasks) || 0, Number(summary.completedTasks) || 0))
    return {
      eyebrow: String(summary.eyebrow || "OU YEAH! · COURSE DATA"),
      status: String(summary.status || "running"),
      title: String(summary.title || "Đang xuất dữ liệu"),
      message: String(summary.message || ""),
      current: String(summary.current || summary.message || ""),
      completedTasks,
      totalTasks,
      entitiesCount: Math.max(0, Number(summary.entitiesCount) || 0),
      filesCount: Math.max(0, Number(summary.filesCount) || 0),
      percent: totalTasks ? Math.max(0, Math.min(100, Math.round((completedTasks / totalTasks) * 100))) : 0,
      startedAt: String(summary.startedAt || ""),
      etaText: estimateRemainingText(completedTasks, totalTasks, summary.startedAt, summary.status),
      metrics: String(summary.metrics || ""),
      errors: Array.isArray(summary.errors) ? summary.errors.map((error) => String(error)) : [],
      minimized: summary.minimized === true
    }
  }

  function failedResourcesMarkup(resources) {
    const rows = resources.slice(0, 8).map((resource) => `
      <li>
        <strong>${escapeHtml(resource.title)}</strong>
        <small>${escapeHtml(resource.error || "Không tải được học liệu.")}</small>
      </li>
    `).join("")
    return `
      <details class="ou-yeah-course-download-failures" open>
        <summary>${resources.length} mục cần thử lại</summary>
        <ul>${rows}</ul>
      </details>
    `
  }

  function courseDataSummaryMarkup(summary) {
    if (!summary) return ""
    const isComplete = summary.status === "complete"
    return `
      <section class="ou-yeah-course-download-course-summary">
        <span class="ou-yeah-course-download-eyebrow">OU YEAH! · COURSE DATA</span>
        <strong>${isComplete ? "Gói dữ liệu đã sẵn sàng" : "Đang hoàn thiện gói dữ liệu"}</strong>
        <p>${escapeHtml(summary.message || "")}</p>
        <div><span>${summary.completedTasks}/${summary.totalTasks} bước</span><span>${summary.entitiesCount} thực thể</span><span>${summary.filesCount} tệp</span>${summary.etaText ? `<span>${escapeHtml(summary.etaText)}</span>` : ""}</div>
      </section>
    `
  }

  function minimizeSessionPanel() {
    if (!activeSession) return
    if (["complete", "canceled"].includes(activeSession.status)) {
      activeSession.panelHidden = true
      panelMinimized = false
      persistSession().catch(() => {})
      closeRoot()
      return
    }
    panelMinimized = true
    persistSession().catch(() => {})
    renderMinimizedLauncher()
  }

  function renderMinimizedLauncher() {
    if (!activeSession) return
    const root = ensureRoot()
    const counts = countStatuses(activeSession.resources)
    const readyTotal = activeSession.resources.filter((resource) => resource.availability === "available").length
    const processed = counts.downloaded + counts.failed
    const percent = readyTotal ? Math.round((processed / readyTotal) * 100) : 100
    const current = activeSession.resources[activeSession.currentIndex]
    root.dataset.mode = "minimized"
    root.innerHTML = `
      <button type="button" class="ou-yeah-course-download-minimized" data-ou-download-reopen aria-label="Mở lại bảng tiến trình tải học liệu" title="Mở lại tiến trình">
        <span class="ou-yeah-course-download-icon" aria-hidden="true"></span>
        <span class="ou-yeah-course-download-minimized-copy">
          <strong>${escapeHtml(sessionStatusText(activeSession.status, current))}</strong>
          <small>${processed}/${readyTotal} mục</small>
        </span>
        <span class="ou-yeah-course-download-minimized-percent" aria-hidden="true">${percent}%</span>
        <span class="ou-yeah-course-download-minimized-progress" aria-hidden="true"><i style="width:${percent}%"></i></span>
      </button>
    `
    root.querySelector("[data-ou-download-reopen]")?.addEventListener("click", () => {
      panelMinimized = false
      renderSessionPanel()
    })
  }

  function updateActiveProgress(message) {
    if (!activeSession || activeSession.status !== "running") return
    const current = activeSession.resources[activeSession.currentIndex]
    if (current) current.progressLabel = message.label || ""
    const panelCurrent = document.querySelector(".ou-yeah-course-download-current")
    if (panelCurrent && current) {
      panelCurrent.textContent = message.label ? `${current.title} · ${message.label}` : current.title
    }
  }

  function sessionStatusText(status, current) {
    if (status === "running") return current?.progressLabel || "Đang tải học liệu"
    if (status === "paused") return "Đã tạm dừng"
    if (status === "canceled") return "Đã hủy hàng đợi"
    if (status === "complete") return "Đã xử lý xong học liệu"
    return "Hàng đợi học liệu"
  }

  function cancellationError() {
    const error = new Error("Tác vụ tải đã được hủy.")
    Object.assign(error, { code: "OU_YEAH_DOWNLOAD_CANCELED" })
    return error
  }

  function throwIfCancellationRequested() {
    if (cancelRequested) throw cancellationError()
  }

  function requestPause() {
    if (!activeSession || activeSession.status !== "running") return
    pauseRequested = true
    const current = document.querySelector(".ou-yeah-course-download-current")
    if (current) current.textContent = "Sẽ tạm dừng sau tệp hiện tại…"
  }

  function requestCancel() {
    if (!activeSession || !["running", "paused"].includes(activeSession.status)) return
    cancelRequested = true
    activeCancelController?.abort()
    activeSession.status = "canceled"
    activeSession.message = "Đã hủy ngay. Đang dừng tác vụ hiện tại…"
    const currentResource = activeSession.resources[activeSession.currentIndex]
    if (currentResource?.downloadStatus === "downloading") {
      currentResource.downloadStatus = "pending"
      currentResource.error = ""
    }
    const jobId = activeJobId
    if (jobId) {
      sendRuntimeMessage({ type: "ou-yeah-cancel-download-job", jobId }).catch(() => {})
    }
    const currentPanel = document.querySelector(".ou-yeah-course-download-current")
    if (currentPanel) currentPanel.textContent = "Đã hủy ngay. Đang dọn tác vụ hiện tại…"
    persistSession().catch(() => {})
    renderSessionPanel()
  }

  function resumeSession() {
    if (!activeSession || queueRunning) return
    pauseRequested = false
    cancelRequested = false
    activeCancelController = new AbortController()
    activeSession.panelHidden = false
    activeSession.resources.forEach((resource) => {
      if (resource.downloadStatus === "downloading") resource.downloadStatus = "pending"
    })
    activeSession.status = "running"
    runQueue().catch(handleError)
  }

  function retryFailed() {
    if (!activeSession || queueRunning) return
    const firstFailed = activeSession.resources.findIndex((resource) => resource.downloadStatus === "failed")
    if (firstFailed < 0) return
    activeSession.resources.forEach((resource) => {
      if (resource.downloadStatus === "failed") resource.downloadStatus = "pending"
    })
    activeSession.panelHidden = false
    panelMinimized = false
    activeSession.currentIndex = firstFailed
    activeSession.status = "running"
    persistSession().catch(() => {})
    runQueue().catch(handleError)
  }

  function restoreSession(saved) {
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.resources)) return
    activeSession = saved
    if (activeSession.status === "running") {
      activeSession.status = "paused"
      activeSession.resources.forEach((resource) => {
        if (resource.downloadStatus === "downloading") resource.downloadStatus = "pending"
      })
      persistSession().catch(() => {})
    }
    if (activeSession.status === "canceled") return
    if (activeSession.panelHidden && ["complete", "canceled"].includes(activeSession.status)) return
    if (activeSession.status === "complete"
      && !activeSession.resources.some((resource) => resource.downloadStatus === "failed")) return
    renderSessionPanel()
  }

  async function persistSession() {
    if (!activeSession) return
    activeSession.updatedAt = new Date().toISOString()
    await storageSet({ [STORAGE_KEY]: activeSession })
  }

  function waitForJob(jobId, timeoutMs = 20 * 60_000) {
    const recent = recentJobMessages.get(jobId)
    if (recent && TERMINAL_JOB_STATES.has(recent.status)) {
      recentJobMessages.delete(jobId)
      return Promise.resolve(recent)
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        jobWaiters.delete(jobId)
        reject(new Error("Tác vụ tải xuống không phản hồi quá lâu."))
      }, timeoutMs)
      jobWaiters.set(jobId, (message) => {
        window.clearTimeout(timeout)
        recentJobMessages.delete(jobId)
        resolve(message)
      })
    })
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID)
    if (root instanceof HTMLElement) return root
    root = document.createElement("div")
    root.id = ROOT_ID
    document.body.appendChild(root)
    return root
  }

  function closeRoot() {
    document.getElementById(ROOT_ID)?.remove()
  }

  function showNotice(message, isError = false) {
    const root = ensureRoot()
    root.dataset.mode = "notice"
    root.innerHTML = `<div class="ou-yeah-course-download-notice ${isError ? "is-error" : ""}">${escapeHtml(message)}</div>`
    window.setTimeout(() => {
      if (root.dataset.mode === "notice") root.remove()
    }, 3800)
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const downloadIcon = chrome.runtime.getURL("src/icons/inbox-in.svg")
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
      #${TOOLBAR_ID} { display:flex; align-items:center; flex:0 0 auto; margin-right:8px; }
      #${TOOLBAR_ID}.is-fallback { justify-content:flex-end; margin:0 0 8px; }
      .${BUTTON_CLASS} { position:relative; z-index:3; display:inline-flex; align-items:center; gap:7px; min-height:32px; margin:0; padding:6px 10px; border:1px solid #d7ddea; border-radius:10px; background:#fff; color:#344d9f; font:600 13px/1 "Space Grotesk","Segoe UI",sans-serif; cursor:pointer; box-shadow:none; }
      .${BUTTON_CLASS}:hover { border-color:#aebbea; background:#f6f8ff; color:#2947aa; }
      .${BUTTON_CLASS}.is-course { min-height:35px; padding:7px 11px; background:#fff; border-color:#b9c5ec; color:#3658b0; }
      .${BUTTON_CLASS}.is-course:hover { border-color:#8fa2df; background:#f4f6ff; }
      .ou-yeah-course-download-icon { width:16px; height:16px; flex:0 0 16px; background:currentColor; -webkit-mask:url("${downloadIcon}") center/contain no-repeat; mask:url("${downloadIcon}") center/contain no-repeat; }
      .ou-yeah-course-download-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
      .course-section-header.ou-yeah-course-download-header { align-items:center; }
      .course-section-header.ou-yeah-course-download-header > .ou-yeah-course-download-header-main { min-width:0; flex:1 1 auto; overflow:hidden; }
      .course-section-header.ou-yeah-course-download-header > .ou-yeah-course-download-header-main > .d-flex { width:100%; min-width:0; flex:1 1 auto; overflow:hidden; }
      .course-section-header.ou-yeah-course-download-header > .ou-yeah-course-download-header-main .icons-collapse-expand { flex:0 0 auto; }
      .course-section-header.ou-yeah-course-download-header .sectionname { min-width:0; max-width:100%; flex:1 1 auto; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .course-section-header.ou-yeah-course-download-header > .${BUTTON_CLASS} { width:30px; min-width:30px; height:30px; min-height:30px; flex:0 0 30px; align-self:center; justify-content:center; gap:0; margin:0 8px 0 5px; padding:0; border-color:transparent; border-radius:8px; background:transparent; opacity:.82; }
      .course-section-header.ou-yeah-course-download-header:hover > .${BUTTON_CLASS},
      .course-section-header.ou-yeah-course-download-header > .${BUTTON_CLASS}:focus-visible { border-color:#cbd4f1; background:#f5f7ff; opacity:1; }
      #${WORKER_FRAME_ID} { position:fixed; left:-10000px; top:0; width:1280px; height:720px; opacity:.01; pointer-events:none; border:0; }
      #${ROOT_ID}, #${ROOT_ID} * { box-sizing:border-box; font-family:"Space Grotesk","Segoe UI",sans-serif !important; }
      #${ROOT_ID} { position:relative; z-index:2147483000; }
      .ou-yeah-course-download-backdrop { position:fixed; inset:0; background:rgba(19,23,33,.35); backdrop-filter:blur(2px); }
      .ou-yeah-course-download-dialog { position:fixed; left:50%; top:50%; width:min(720px,calc(100vw - 32px)); max-height:min(760px,calc(100vh - 32px)); overflow:auto; transform:translate(-50%,-50%); border:1px solid #dfe3ec; border-radius:18px; background:#fff; color:#181b22; box-shadow:0 28px 80px rgba(20,28,50,.24); }
      .ou-yeah-course-download-dialog header { display:flex; justify-content:space-between; gap:20px; padding:22px 24px 14px; border-bottom:1px solid #eceef3; }
      .ou-yeah-course-download-dialog h2 { margin:4px 0 4px; font-size:21px; line-height:1.3; }
      .ou-yeah-course-download-dialog p { margin:0; color:#717783; font-size:13px; }
      .ou-yeah-course-download-eyebrow { color:#5269c7; font-size:10px; font-weight:750; letter-spacing:.08em; }
      .ou-yeah-course-download-close,.ou-yeah-course-download-panel-head button { width:32px; height:32px; border:0; border-radius:9px; background:#f2f3f6; color:#343842; font-size:22px; cursor:pointer; }
      .ou-yeah-course-download-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:16px 24px 8px; }
      .ou-yeah-course-download-summary span { padding:12px; border:1px solid #e5e8ef; border-radius:12px; color:#686f7c; font-size:12px; }
      .ou-yeah-course-download-summary strong { display:block; color:#1c2230; font-size:19px; }
      .ou-yeah-course-download-types { display:flex; gap:8px; margin:10px 24px; padding:0; border:0; }
      .ou-yeah-course-download-types legend { width:100%; margin:0 0 8px; color:#5f6672; font-size:12px; font-weight:650; }
      .ou-yeah-course-download-types label { display:flex; align-items:center; gap:7px; padding:9px 11px; border:1px solid #dfe3eb; border-radius:10px; cursor:pointer; }
      .ou-yeah-course-download-types label:has(input:checked) { border-color:#acb9e9; background:#f2f5ff; color:#3658b0; }
      .ou-yeah-course-download-types label.is-disabled { opacity:.45; cursor:not-allowed; }
      .ou-yeah-course-download-types small { color:#7c8390; }
      .ou-yeah-course-download-locked { margin:12px 24px; border:1px solid #ebe2d8; border-radius:12px; background:#fcfaf7; }
      .ou-yeah-course-download-locked summary { padding:11px 13px; color:#795a36; cursor:pointer; font-size:13px; font-weight:650; }
      .ou-yeah-course-download-locked ul { max-height:170px; overflow:auto; margin:0; padding:0 14px 12px 31px; }
      .ou-yeah-course-download-locked li { margin:7px 0; font-size:12px; }
      .ou-yeah-course-download-locked li span,.ou-yeah-course-download-locked li small { display:block; }
      .ou-yeah-course-download-locked li small { color:#80766d; margin-top:2px; }
      .ou-yeah-course-download-locked p { padding:0 14px 12px; font-size:12px; }
      .ou-yeah-course-download-warning { display:flex; flex-direction:column; gap:3px; margin:14px 24px; padding:12px 14px; border-left:3px solid #5269c7; background:#f5f7fc; color:#555e6d; font-size:12px; }
      .ou-yeah-course-download-warning strong { color:#252c39; }
      .ou-yeah-course-download-dialog footer { display:flex; justify-content:flex-end; gap:9px; padding:15px 24px 20px; border-top:1px solid #eceef3; }
      .ou-yeah-course-download-primary,.ou-yeah-course-download-secondary { min-height:39px; padding:8px 14px; border-radius:10px; font:650 13px/1 "Space Grotesk","Segoe UI",sans-serif; cursor:pointer; }
      .ou-yeah-course-download-primary { border:1px solid #3658b0; background:#3658b0; color:#fff; }
      .ou-yeah-course-download-primary:disabled { opacity:.45; cursor:not-allowed; }
      .ou-yeah-course-download-secondary { border:1px solid #dce0e8; background:#fff; color:#4f5662; }
      .ou-yeah-course-download-panel { position:fixed; right:22px; bottom:22px; width:min(440px,calc(100vw - 32px)); max-width:calc(100vw - 24px); overflow:hidden; border:1px solid #dfe3ec; border-radius:16px; background:#fff; color:#1d2330; box-shadow:0 18px 54px rgba(25,35,61,.2); }
      .ou-yeah-course-download-panel-head { display:flex; justify-content:space-between; gap:15px; min-width:0; padding:15px 16px 10px; }
      .ou-yeah-course-download-panel-head > div { min-width:0; flex:1 1 auto; }
      .ou-yeah-course-download-panel-head strong,.ou-yeah-course-download-panel-head small { display:block; }
      .ou-yeah-course-download-panel-head strong { margin-top:3px; font-size:15px; }
      .ou-yeah-course-download-panel-head small { margin-top:3px; color:#767d89; font-size:11px; }
      .ou-yeah-course-download-panel.is-context-invalidated { border-color:#e5cfb8; }
      .ou-yeah-course-download-panel.is-context-invalidated .ou-yeah-course-download-eyebrow { color:#9a6635; }
      .ou-yeah-course-download-progress { height:4px; background:#edf0f5; }
      .ou-yeah-course-download-progress span { display:block; height:100%; background:#5269c7; transition:width .25s ease; }
       .ou-yeah-course-download-current { padding:9px 16px; color:#626a78; font-size:11px; line-height:1.45; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
       .ou-yeah-course-download-course-summary { margin:0 16px 10px; padding:10px 11px; border:1px solid #dfe4f2; border-radius:10px; background:#f8f9ff; }
       .ou-yeah-course-download-course-summary .ou-yeah-course-download-eyebrow { display:block; }
       .ou-yeah-course-download-course-summary strong,.ou-yeah-course-download-course-summary p { display:block; }
       .ou-yeah-course-download-course-summary strong { margin-top:3px; color:#283b84; font-size:12px; }
       .ou-yeah-course-download-course-summary p { margin:3px 0 6px; color:#626a78; font-size:10px; }
       .ou-yeah-course-download-course-summary>div { display:flex; gap:10px; flex-wrap:wrap; color:#747d92; font-size:10px; }
       .ou-yeah-course-download-failures { margin:0 16px 10px; border:1px solid #ead7d7; border-radius:10px; background:#fffafa; }
      .ou-yeah-course-download-failures summary { padding:8px 10px; color:#9b4949; font-size:11px; font-weight:700; cursor:pointer; }
      .ou-yeah-course-download-failures ul { max-height:150px; overflow:auto; margin:0; padding:0 10px 8px 27px; }
      .ou-yeah-course-download-failures li { margin:6px 0; color:#555d69; font-size:10px; }
      .ou-yeah-course-download-failures strong,.ou-yeah-course-download-failures small { display:block; }
      .ou-yeah-course-download-failures small { margin-top:2px; color:#9a6666; }
      .ou-yeah-course-download-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:7px; min-width:0; padding:0 16px 14px; }
      .ou-yeah-course-download-actions button { min-width:0; max-width:100%; padding:7px 10px; border:1px solid #dce1ea; border-radius:9px; background:#fff; color:#48505e; font:650 12px/1 "Space Grotesk","Segoe UI",sans-serif; cursor:pointer; }
      .ou-yeah-course-download-actions button.is-primary { border-color:#3658b0; background:#3658b0; color:#fff; }
      .ou-yeah-course-download-minimized { position:fixed; right:78px; bottom:24px; display:grid; grid-template-columns:18px minmax(0,1fr) auto; align-items:center; gap:9px; min-width:214px; max-width:min(330px,calc(100vw - 110px)); padding:10px 12px 12px; overflow:hidden; border:1px solid #d7deef; border-radius:13px; background:#fff; color:#2e3f83; text-align:left; box-shadow:0 14px 40px rgba(25,35,61,.18); cursor:pointer; }
      .ou-yeah-course-download-minimized:hover,.ou-yeah-course-download-minimized:focus-visible { border-color:#aebbea; background:#f8f9ff; outline:0; }
      .ou-yeah-course-download-minimized-copy { min-width:0; }
      .ou-yeah-course-download-minimized-copy strong,.ou-yeah-course-download-minimized-copy small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .ou-yeah-course-download-minimized-copy strong { color:#253468; font-size:12px; }
      .ou-yeah-course-download-minimized-copy small { margin-top:2px; color:#7a8190; font-size:10px; }
      .ou-yeah-course-download-minimized-percent { color:#69718a; font-size:10px; font-weight:700; }
      .ou-yeah-course-download-minimized-progress { position:absolute; left:0; right:0; bottom:0; height:3px; background:#edf0f6; }
      .ou-yeah-course-download-minimized-progress i { display:block; height:100%; background:#5269c7; transition:width .25s ease; }
      .ou-yeah-course-download-notice { position:fixed; right:22px; bottom:22px; max-width:380px; padding:12px 15px; border:1px solid #cfe2d8; border-radius:12px; background:#f5fbf7; color:#2d6f4b; box-shadow:0 14px 40px rgba(25,35,61,.14); }
      .ou-yeah-course-download-notice.is-error { border-color:#ead3d3; background:#fff7f7; color:#a14949; }
      @media (max-width:700px) { #${TOOLBAR_ID} { margin-right:5px; } .${BUTTON_CLASS}.is-course { padding:7px 9px; } .ou-yeah-course-download-summary { grid-template-columns:1fr; } .ou-yeah-course-download-types { flex-wrap:wrap; } .ou-yeah-course-download-panel { right:12px; bottom:12px; width:calc(100vw - 24px); } .ou-yeah-course-download-minimized { right:16px; bottom:72px; max-width:calc(100vw - 32px); } }
    `
    document.documentElement.appendChild(style)
  }

  function cleanVisibleText(element) {
    if (!(element instanceof Element)) return ""
    const clone = element.cloneNode(true)
    if (!(clone instanceof Element)) return ""
    clone.querySelectorAll(".accesshide,.sr-only,.visually-hidden,.activity-information,.activity-completion").forEach((node) => node.remove())
    return String(clone.textContent || "").replace(/\s+/g, " ").trim()
  }

  function sanitizeSegment(value, maxLength = 70) {
    const cleaned = String(value || "")
      .replace(/[\\/:*?"<>|]+/g, " - ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
    if (!cleaned) return "Không có tên"
    return compactPathSegment(cleaned, maxLength)
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  }

  function activityIdFromUrl(value) {
    try {
      return new URL(value).searchParams.get("id") || ""
    } catch {
      return ""
    }
  }

  function sameCourseUrl(value) {
    try {
      const url = new URL(value, location.href)
      return url.origin === location.origin && url.protocol === "https:" ? url.href : ""
    } catch {
      return ""
    }
  }

  function extensionFromValue(value) {
    try {
      const path = /^https?:/i.test(value) ? new URL(value).pathname : value
      return /\.(pdf|pptx?|ppsx?|docx?|xlsx?|odt|odp|txt|zip|mp4|m4v|webm|mov|mkv|ts)(?:[?#]|$)/i.exec(path)?.[0].toLowerCase() || ""
    } catch {
      return ""
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable()) {
        reject(extensionContextError())
        return
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          try {
            const error = chrome.runtime.lastError?.message
            if (error) reject(new Error(error))
            else resolve(response)
          } catch (error) {
            reject(error)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable()) {
        reject(extensionContextError())
        return
      }
      try {
        chrome.storage.local.get(key, (result) => {
          try {
            const error = chrome.runtime.lastError?.message
            if (error) reject(new Error(error))
            else resolve(result?.[key] || null)
          } catch (error) {
            reject(error)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable()) {
        reject(extensionContextError())
        return
      }
      try {
        chrome.storage.local.set(value, () => {
          try {
            const error = chrome.runtime.lastError?.message
            if (error) reject(new Error(error))
            else resolve()
          } catch (error) {
            reject(error)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      let timeout
      const cleanup = () => {
        window.clearTimeout(timeout)
        signal?.removeEventListener("abort", onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(cancellationError())
      }
      timeout = window.setTimeout(() => {
        cleanup()
        resolve()
      }, milliseconds)
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }

  function readableError(error) {
    return error instanceof Error ? error.message : String(error || "Đã có lỗi xảy ra.")
  }

  function isExtensionContextAvailable() {
    try {
      return Boolean(chrome?.runtime?.id && chrome.runtime.getURL(""))
    } catch {
      return false
    }
  }

  function extensionContextError() {
    return new Error("Extension context invalidated.")
  }

  function isExtensionContextError(error) {
    return /extension context invalidated/i.test(readableError(error))
  }

  function renderExtensionReloadNotice() {
    const root = ensureRoot()
    root.dataset.mode = "context-invalidated"
    root.innerHTML = `
      <aside class="ou-yeah-course-download-panel is-context-invalidated" role="alert">
        <div class="ou-yeah-course-download-panel-head">
          <div>
            <span class="ou-yeah-course-download-eyebrow">OU YEAH! · CẦN KẾT NỐI LẠI</span>
            <strong>Extension vừa được tải lại</strong>
            <small>Phiên tải đã tạm dừng. Hãy tải lại tab ELOLMS để dùng phiên bản mới.</small>
          </div>
        </div>
        <div class="ou-yeah-course-download-current">Tệp đang xử lý có thể vẫn hoàn tất trong Downloads; hãy kiểm tra trước khi tiếp tục.</div>
        <div class="ou-yeah-course-download-actions">
          <button type="button" class="is-primary" data-ou-download-reload-page>Tải lại tab</button>
        </div>
      </aside>
    `
    root.querySelector("[data-ou-download-reload-page]")?.addEventListener("click", () => location.reload())
  }

  function handleError(error) {
    if (isExtensionContextError(error)) {
      if (extensionContextInvalidated) return
      extensionContextInvalidated = true
      pauseRequested = true
      cancelRequested = false
      removeWorkerFrame()
      if (activeSession?.status === "running") activeSession.status = "paused"
      renderExtensionReloadNotice()
      return
    }

    const message = readableError(error)
    console.error("OU Yeah!: course download failed", error)
    showNotice(message, true)
    if (activeSession) {
      activeSession.status = "paused"
      persistSession().catch(() => {})
      renderSessionPanel()
    }
  }
})()
