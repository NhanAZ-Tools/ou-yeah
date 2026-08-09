(() => {
  "use strict"

  const IS_RUNTIME_FIXTURE = ["127.0.0.1", "localhost"].includes(location.hostname)
    && document.documentElement.dataset.ouYeahCourseDataFixture === "true"
  const IS_COURSE_VIEW = window.top === window.self
    && ((location.hostname === "elolms.ou.edu.vn" && location.pathname.toLowerCase() === "/course/view.php") || IS_RUNTIME_FIXTURE)
  if (!IS_COURSE_VIEW) return

  const FORMAT = "ou-yeah-course-data-v1"
  const ROOT_ID = "ou-yeah-course-data-export-root"
  const STYLE_ID = "ou-yeah-course-data-export-style"
  const TOOLBAR_ID = "ou-yeah-course-data-export-toolbar"
  const STORAGE_PREFIX = "ouYeahCourseDataExport:"
  const MATERIAL_STORAGE_PREFIX = "ouYeahCourseDownloadSession:"
  const SNAPSHOT_PREFIX = "ouYeahCourseDataSnapshot:"
  const MAX_BINARY_FILE_BYTES = 64 * 1024 * 1024
  const MAX_ARCHIVE_BYTES = 320 * 1024 * 1024
  const MATERIAL_TYPES = [
    { id: "video", label: "Video" },
    { id: "slide", label: "Slide" },
    { id: "script", label: "Script" }
  ]
  const DEFAULT_MATERIAL_TYPES = ["script"]
  const AI_CONTEXT_POLICY = Object.freeze({
    includeMaterialTypes: ["script"],
    excludeMaterialTypes: ["video", "slide"],
    instruction: "Read Script files for lesson text. Do not open or add Video or Slide files to AI context; they are for human viewing."
  })
  const GROUPS = [
    { id: "overview", label: "Tổng quan, đề cương" },
    { id: "content", label: "Nội dung và tài nguyên" },
    { id: "materials", label: "Video, Slide, Script" },
    { id: "forums", label: "Diễn đàn và thông báo" },
    { id: "assignments", label: "Bài tập và bài nộp của tôi" },
    { id: "assessments", label: "Bài kiểm tra đã được phép xem" },
    { id: "schedule", label: "Lịch trình học tập" },
    { id: "grades", label: "Điểm số của tôi" },
    { id: "participants", label: "Danh sách thành viên" },
    { id: "notifications", label: "Thông báo tài khoản" }
  ]
  const MATERIAL_GROUP = GROUPS.find((group) => group.id === "materials")
  const DISPLAY_GROUPS = GROUPS.reduce((result, group) => {
    if (group.id === "materials") return result
    if (group.id === "participants" && MATERIAL_GROUP) result.push(MATERIAL_GROUP)
    result.push(group)
    return result
  }, [])
  const DEFAULT_GROUP_IDS = GROUPS
    .filter((group) => !["participants", "notifications"].includes(group.id))
    .map((group) => group.id)

  let observer = null
  let refreshTimer = 0
  let activeSession = null
  let pauseRequested = false
  let cancelRequested = false
  let panelMinimized = false

  init().catch(handleError)

  async function init() {
    injectStyles()
    mountControl()
    observer = new MutationObserver(scheduleMount)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener("beforeunload", (event) => {
      if (!activeSession || !["running", "paused", "building", "delegated"].includes(activeSession.status)) return
      event.preventDefault()
      event.returnValue = ""
    })
    document.addEventListener("ou-yeah-course-material-session-finished", () => {
      if (activeSession?.status !== "interrupted" || !panelMinimized) return
      panelMinimized = false
      renderPanel()
    })

    const courseId = getCourseId()
    const [saved, materialSaved] = await Promise.all([
      storageGet(`${STORAGE_PREFIX}${courseId}`),
      storageGet(`${MATERIAL_STORAGE_PREFIX}${courseId}`)
    ])
    if (saved && ["running", "paused", "building", "delegated"].includes(saved.status)) {
      activeSession = {
        ...saved,
        status: "interrupted",
        message: "Lần xuất trước bị gián đoạn. Có thể chạy lại với cùng lựa chọn; snapshot cũ vẫn được giữ nguyên."
      }
      const materialStillActive = materialSaved
        && ["running", "paused"].includes(materialSaved.status)
        && Array.isArray(saved.selectedGroups)
        && saved.selectedGroups.includes("materials")
      if (materialStillActive) {
        panelMinimized = true
        return
      }
      renderPanel()
    }
  }

  function scheduleMount() {
    window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(mountControl, 160)
  }

  function mountControl() {
    const courseContent = document.querySelector(".course-content")
    if (!(courseContent instanceof HTMLElement)) return

    // Course download used to expose a second, overlapping top-level action.
    // Reuse that toolbar when it exists so the user has one obvious entry point.
    const materialToolbar = document.getElementById("ou-yeah-course-download-toolbar")
    const ownToolbar = document.getElementById(TOOLBAR_ID)
    if (materialToolbar instanceof HTMLElement && ownToolbar instanceof HTMLElement && ownToolbar !== materialToolbar) ownToolbar.remove()
    let toolbar = materialToolbar instanceof HTMLElement ? materialToolbar : ownToolbar
    if (!(toolbar instanceof HTMLElement)) {
      toolbar = document.createElement("div")
      toolbar.id = TOOLBAR_ID
      const collapseAll = document.getElementById("collapsesections")
      const nativeActions = collapseAll?.parentElement
      if (nativeActions instanceof HTMLElement) nativeActions.insertBefore(toolbar, collapseAll)
      else courseContent.parentElement?.insertBefore(toolbar, courseContent)
    }
    if (toolbar.dataset.ouYeahUnifiedExport === "true") return

    const oldButton = toolbar.querySelector("button")
    const button = document.createElement("button")
    button.type = "button"
    button.className = oldButton?.className || "ou-yeah-course-data-button"
    button.classList.add("ou-yeah-course-data-unified-button")
    button.title = "Tải toàn bộ dữ liệu khóa học"
    button.setAttribute("aria-label", "Tải toàn bộ dữ liệu khóa học")
    button.innerHTML = `
      <span class="ou-yeah-course-data-icon ou-yeah-course-download-icon" aria-hidden="true"></span>
      <span>Tải toàn bộ</span>
    `
    oldButton?.replaceWith(button)
    if (!oldButton) toolbar.appendChild(button)
    toolbar.dataset.ouYeahUnifiedExport = "true"

    button.addEventListener("click", () => {
      if (activeSession && ["running", "paused", "building", "delegated"].includes(activeSession.status)) {
        if (activeSession.status === "delegated") return
        panelMinimized = false
        renderPanel()
        return
      }
      openPreview()
    })
  }

  function openPreview() {
    const materialApi = /** @type {any} */ (window).OUYeahCourseDownloadApi
    if (materialApi?.isBusy?.()) return
    materialApi?.dismissPanel?.()
    const inventory = scanCourseInventory()
    const course = courseMetadata()
    const completion = courseProgress()
    const defaultGroups = activeSession?.selectedGroups?.length
      ? [...activeSession.selectedGroups]
      : [...DEFAULT_GROUP_IDS]
    const defaultMaterialTypes = activeSession?.selectedMaterialTypes?.length
      ? [...activeSession.selectedMaterialTypes]
      : [...DEFAULT_MATERIAL_TYPES]
    const groupCounts = inventoryGroupCounts(inventory)
    const root = ensureRoot()
    root.dataset.mode = "preview"
    root.innerHTML = `
      <div class="ou-yeah-course-data-backdrop" data-ou-data-close></div>
      <section class="ou-yeah-course-data-dialog" role="dialog" aria-modal="true" aria-labelledby="ou-yeah-course-data-title">
        <header>
          <div>
            <span class="ou-yeah-course-data-eyebrow">OU YEAH! · GÓI AI + NGƯỜI ĐỌC</span>
            <h2 id="ou-yeah-course-data-title">Tải gói học tập hợp nhất</h2>
            <p>${escapeHtml(course.title)}${completion == null ? "" : ` · ${completion}% hoàn thành`}</p>
          </div>
          <div class="ou-yeah-course-data-header-metrics" aria-label="Tóm tắt khóa học">
            <span><strong>${inventory.activities.length}</strong><small>hoạt động</small></span>
            <span><strong>${inventory.counts.available}</strong><small>truy cập</small></span>
            <span><strong>${inventory.counts.restricted}</strong><small>hạn chế</small></span>
          </div>
          <button type="button" class="ou-yeah-course-data-close" data-ou-data-close aria-label="Đóng">×</button>
        </header>
        <div class="ou-yeah-course-data-selection-head">
          <div>
            <strong>Chọn phạm vi tải</strong>
            <span data-ou-data-selection-summary>Đang chọn các nhóm dữ liệu thông thường</span>
          </div>
          <div class="ou-yeah-course-data-selection-actions">
            <button type="button" class="ou-yeah-course-data-link" data-ou-data-select-all>Chọn tất cả</button>
            <button type="button" class="ou-yeah-course-data-link" data-ou-data-clear-all>Bỏ chọn tất cả</button>
          </div>
        </div>
        <div class="ou-yeah-course-data-groups" role="group" aria-label="Phạm vi dữ liệu">
          ${DISPLAY_GROUPS.map((group) => group.id === "materials" ? `
            <div class="ou-yeah-course-data-material-scope" data-ou-data-group-card="materials">
              <label>
                <input type="checkbox" data-ou-data-group value="${group.id}"${defaultGroups.includes(group.id) ? " checked" : ""}>
                <span><strong>Học liệu</strong></span>
              </label>
              <div class="ou-yeah-course-data-material-options" role="group" aria-label="Loại học liệu">
                ${MATERIAL_TYPES.map((type) => `
                  <label>
                    <input type="checkbox" data-ou-data-material-type value="${type.id}"${defaultMaterialTypes.includes(type.id) ? " checked" : ""}>
                    <span>${type.label}</span>
                  </label>
                `).join("")}
              </div>
            </div>
          ` : `
            <label data-ou-data-group-card="${group.id}">
              <input type="checkbox" data-ou-data-group value="${group.id}"${defaultGroups.includes(group.id) ? " checked" : ""}>
              <span><strong>${escapeHtml(group.label)}</strong><small>${groupCountLabel(group.id, groupCounts[group.id])}</small></span>
            </label>
          `).join("")}
        </div>
        <footer>
          <button type="button" class="ou-yeah-course-data-secondary" data-ou-data-close>Để sau</button>
          <button type="button" class="ou-yeah-course-data-primary" data-ou-data-start>Bắt đầu tải</button>
        </footer>
      </section>
    `

    root.querySelectorAll("[data-ou-data-close]").forEach((node) => node.addEventListener("click", closeRoot))
    const groupInputs = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll("[data-ou-data-group]")])
    const materialInputs = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll("[data-ou-data-material-type]")])
    const startButton = root.querySelector("[data-ou-data-start]")
    const updateSelection = () => {
      const selectedGroups = groupInputs.filter((input) => input.checked).map((input) => input.value)
      const materialsSelected = selectedGroups.includes("materials")
      const selectedMaterialTypes = materialInputs.filter((input) => input.checked).map((input) => input.value)
      materialInputs.forEach((input) => { input.disabled = !materialsSelected })
      const summary = root.querySelector("[data-ou-data-selection-summary]")
      if (summary) summary.textContent = selectedGroups.length
        ? `${selectedGroups.length}/${GROUPS.length} nhóm${materialsSelected ? ` · ${selectedMaterialTypes.length}/${MATERIAL_TYPES.length} loại học liệu` : ""}`
        : "Chưa chọn nhóm dữ liệu"
      if (startButton instanceof HTMLButtonElement) {
        const invalidMaterials = materialsSelected && selectedMaterialTypes.length === 0
        startButton.disabled = selectedGroups.length === 0 || invalidMaterials
        startButton.textContent = startButton.disabled
          ? (invalidMaterials ? "Chọn loại học liệu" : "Chọn phạm vi")
          : `Bắt đầu tải (${selectedGroups.length} nhóm)`
      }
    }
    groupInputs.forEach((input) => input.addEventListener("change", updateSelection))
    materialInputs.forEach((input) => input.addEventListener("change", updateSelection))
    root.querySelector("[data-ou-data-select-all]")?.addEventListener("click", () => {
      groupInputs.forEach((input) => { input.checked = true })
      materialInputs.forEach((input) => { input.checked = true })
      updateSelection()
    })
    root.querySelector("[data-ou-data-clear-all]")?.addEventListener("click", () => {
      groupInputs.forEach((input) => { input.checked = false })
      materialInputs.forEach((input) => { input.checked = false })
      updateSelection()
    })
    updateSelection()
    root.querySelector("[data-ou-data-start]")?.addEventListener("click", () => {
      const selectedGroups = groupInputs.filter((input) => input.checked).map((input) => input.value)
      const selectedMaterialTypes = materialInputs.filter((input) => input.checked).map((input) => input.value)
      closeRoot()
      void startExport(course, inventory, selectedGroups, selectedMaterialTypes).catch(handleError)
    })
  }

  function inventoryGroupCounts(inventory) {
    const count = (group) => inventory.activities.filter((activity) => activity.group === group).length
    return {
      overview: 1,
      content: count("content"),
      materials: inventory.activities.filter((activity) => activity.materialType).length,
      video: inventory.activities.filter((activity) => activity.materialType === "video").length,
      slide: inventory.activities.filter((activity) => activity.materialType === "slide").length,
      script: inventory.activities.filter((activity) => activity.materialType === "script").length,
      forums: count("forums"),
      assignments: count("assignments"),
      assessments: count("assessments"),
      schedule: 1,
      grades: 1,
      participants: 1,
      notifications: 1
    }
  }

  function groupCountLabel(groupId, count) {
    if (groupId === "materials") return `${count || 0} học liệu`
    if (["overview", "schedule", "grades", "participants", "notifications"].includes(groupId)) return "1 nguồn"
    return `${count || 0} mục`
  }

  async function startExport(course, inventory, selectedGroupsValue, selectedMaterialTypesValue = DEFAULT_MATERIAL_TYPES) {
    pauseRequested = false
    cancelRequested = false
    panelMinimized = false
    const selectedGroups = [...new Set(selectedGroupsValue)].filter((group) => GROUPS.some((item) => item.id === group))
    const selectedMaterialTypes = normalizeMaterialTypes(selectedMaterialTypesValue)
    const snapshotKey = `${SNAPSHOT_PREFIX}${course.id}`
    let materialApi = /** @type {any} */ (window).OUYeahCourseDownloadApi
    materialApi?.dismissPanel?.()
    let previousSnapshot
    activeSession = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      course,
      selectedGroups,
      selectedMaterialTypes,
      status: "running",
      stage: "inventory",
      message: "Đang lập chỉ mục khóa học…",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedTasks: 0,
      totalTasks: selectedGroups.length + 2,
      errors: [],
      warnings: [],
      filesCount: 0,
      entitiesCount: inventory.activities.length,
      archiveBytes: 0,
      useUnifiedMaterialPanel: false
    }
    setCourseDataBusy(true)
    renderPanel()
    await persistSession()
    renderPanel()
    previousSnapshot = await storageGet(snapshotKey).catch(() => null)

    const context = createExportContext(course, inventory, selectedGroups, previousSnapshot, selectedMaterialTypes)
    addInitialFiles(context)

    try {
      const collectors = collectorPlan(selectedGroups, context)
      activeSession.totalTasks = collectors.length + 1 + (selectedGroups.includes("materials") ? 1 : 0)
      await persistSession()

      for (const collector of collectors) {
        await waitIfPaused()
        if (cancelRequested) break
        activeSession.stage = collector.id
        activeSession.message = collector.label
        await persistSession()
        renderPanel()
        try {
          await collector.run()
        } catch (error) {
          const message = `${collector.label}: ${readableError(error)}`
          context.diagnostics.errors.push({ stage: collector.id, message })
          activeSession.errors.push(message)
        }
        activeSession.completedTasks += 1
        syncSessionStats(context)
        await persistSession()
        renderPanel()
      }

      if (cancelRequested) {
        activeSession.status = "canceled"
        activeSession.message = "Đã hủy. Snapshot trước đó không bị thay đổi."
        setCourseDataBusy(false)
        await persistSession()
        renderPanel()
        return
      }

      await waitIfPaused()
      if (cancelRequested) {
        activeSession.status = "canceled"
        activeSession.message = "Đã hủy. Snapshot trước đó không bị thay đổi."
        setCourseDataBusy(false)
        await persistSession()
        renderPanel()
        return
      }
      if (selectedGroups.includes("materials")) {
        activeSession.status = "delegated"
        activeSession.stage = "materials"
        activeSession.message = "Video, Slide và Script đang được xử lý ở bảng tải học liệu riêng…"
        panelMinimized = true
        await persistSession()
        document.getElementById(ROOT_ID)?.remove()
        if (materialApi?.downloadAllMaterials) {
          const result = await materialApi.downloadAllMaterials({ scopeTitle: "Học liệu đã chọn", types: selectedMaterialTypes, hideOnFinish: true, waitForResume: true, manifestFilename: "ou-yeah-course-manifest.json" })
          context.materialDownload = result
          activeSession.useUnifiedMaterialPanel = Boolean(materialApi.setCourseDataSummary && result.resources?.length)
          addJson(context, "01-content/materials-download.json", {
            format: FORMAT,
            exportedAt: context.exportedAt,
            aiContextPolicy: { ...AI_CONTEXT_POLICY },
            note: "Các tệp Video, Slide và Script do Chrome lưu ngoài thư mục 00-AI; localPath là đường dẫn tương đối trong thư mục khóa học.",
            ...result
          })
          for (const resource of result.resources || []) {
            const entity = context.entities.find((item) => String(item.activityId || "") === String(resource.activityId || ""))
            if (!entity) continue
            if (resource.localPath) Object.assign(entity, { localPath: resource.localPath, externalDownload: true })
            if (resource.downloadStatus === "failed") {
              Object.assign(entity, {
                accessState: "failed",
                restriction: resource.error || "Không tải được học liệu."
              })
            }
          }
          const failedMaterials = (result.resources || []).filter((resource) => resource.downloadStatus === "failed")
          if (failedMaterials.length) {
            context.diagnostics.errors.push(...failedMaterials.map((resource) => ({
              stage: "materials",
              id: resource.id || resource.activityId || resource.title,
              sourceUrl: resource.sourceUrl || null,
              message: `${resource.title}: ${resource.error || "Không tải được học liệu."}`
            })))
          } else if (result.failed) {
            context.diagnostics.errors.push({
              stage: "materials",
              message: `${result.failed} học liệu tải lỗi; xem manifest học liệu để biết chi tiết.`
            })
          }
          if (result.status === "canceled") activeSession.warnings.push("Đã hủy hàng đợi học liệu; cây dữ liệu AI vẫn được ghi và giữ rõ trạng thái này.")
          if (result.failed) activeSession.warnings.push(`${result.failed} học liệu tải lỗi; xem manifest học liệu để thử lại.`)
        } else {
          activeSession.warnings.push("Không thể khởi động trình tải Video/Slide/Script trong tab này.")
        }
        activeSession.completedTasks += 1
        panelMinimized = false
        if (activeSession.useUnifiedMaterialPanel) materialApi?.setCourseDataSummary?.({
          status: "building",
          message: "Đang hoàn thiện chỉ mục và ghi file AI vào thư mục khóa học…",
          completedTasks: activeSession.completedTasks,
          totalTasks: activeSession.totalTasks,
          entitiesCount: context.entities.length,
          filesCount: context.files.length,
          errors: activeSession.errors
        })
      }

      await waitIfPaused()
      activeSession.status = "building"
      activeSession.stage = "package"
      activeSession.message = "Đang hoàn thiện chỉ mục, kiểm tra thay đổi và ghi file AI…"
      renderPanel()

      finalizeContext(context)
      const dataTreeWritten = await downloadCourseDataTree(context, course)
      if (!dataTreeWritten) {
        activeSession.status = "canceled"
        activeSession.message = "Đã hủy khi đang ghi file AI. Snapshot trước đó không bị thay đổi."
        setCourseDataBusy(false)
        await persistSession()
        renderPanel()
        return
      }
      activeSession.completedTasks += 1
      syncSessionStats(context)

      const snapshot = buildSnapshot(context)
      await storageSet({ [snapshotKey]: snapshot })

      panelMinimized = false
      activeSession.status = "complete"
      activeSession.stage = "complete"
      activeSession.message = `Đã xuất ${context.entities.length} thực thể và ${context.files.length} tệp dữ liệu.`
      activeSession.updatedAt = new Date().toISOString()
      setCourseDataBusy(false)
      await persistSession()
      const unifiedPanelShown = activeSession.useUnifiedMaterialPanel
        && materialApi?.setCourseDataSummary?.({
          status: "complete",
          message: activeSession.message,
          completedTasks: activeSession.completedTasks,
          totalTasks: activeSession.totalTasks,
          entitiesCount: context.entities.length,
          filesCount: context.files.length,
          errors: activeSession.errors
        }) === true
      if (unifiedPanelShown) document.getElementById(ROOT_ID)?.remove()
      else renderPanel()
    } catch (error) {
      handleError(error)
    }
  }

  function collectorPlan(selected, context) {
    const plan = []
    if (selected.includes("overview")) plan.push({ id: "overview", label: "Đang đọc tổng quan, đề cương và lịch trình gốc…", run: () => collectOverview(context) })
    if (selected.includes("content")) plan.push({ id: "content", label: "Đang xuất trang nội dung và tài nguyên…", run: () => collectContent(context) })
    if (selected.includes("forums")) plan.push({ id: "forums", label: "Đang xuất thông báo, thảo luận và Video Conference…", run: () => collectForums(context) })
    if (selected.includes("assignments")) plan.push({ id: "assignments", label: "Đang xuất đề bài, tệp hướng dẫn và dữ liệu bài nộp của bạn…", run: () => collectAssignments(context) })
    if (selected.includes("assessments")) plan.push({ id: "assessments", label: "Đang đọc các bài kiểm tra được ELOLMS cho phép xem…", run: () => collectAssessments(context) })
    if (selected.includes("schedule")) plan.push({ id: "schedule", label: "Đang xuất lịch trình học tập…", run: () => collectLearningSchedule(context) })
    if (selected.includes("grades")) plan.push({ id: "grades", label: "Đang xuất báo cáo điểm của bạn…", run: () => collectGrades(context) })
    if (selected.includes("participants")) plan.push({ id: "participants", label: "Đang xuất danh sách thành viên đã giới hạn trường dữ liệu…", run: () => collectParticipants(context) })
    if (selected.includes("notifications")) plan.push({ id: "notifications", label: "Đang xuất thông báo tài khoản đang hiển thị…", run: () => collectNotifications(context) })
    return plan
  }

  function normalizeMaterialTypes(value) {
    const allowed = new Set(MATERIAL_TYPES.map((type) => type.id))
    const selected = Array.isArray(value) ? value.filter((type) => allowed.has(type)) : []
    return [...new Set(selected)]
  }

  function createExportContext(course, inventory, selected, previousSnapshot, selectedMaterialTypes) {
    return {
      course,
      inventory,
      selected,
      selectedMaterialTypes: normalizeMaterialTypes(selectedMaterialTypes),
      previousSnapshot,
      exportedAt: new Date().toISOString(),
      files: [],
      fileNames: new Set(),
      entities: inventory.activities.map((activity) => ({ ...activity })),
      diagnostics: { errors: [], warnings: [], skipped: [] },
      archiveBytes: 0,
      assetCache: new Map(),
      materialDownload: null
    }
  }

  function addInitialFiles(context) {
    addJson(context, "course-index.json", buildCourseIndex(context, false))
    addText(context, "course-context.md", renderCourseContext(context))
    addJson(context, "access-report.json", buildAccessReport(context))
  }

  async function collectOverview(context) {
    const url = `${location.origin}/theme/boost/coursepages/coursesummary.php?id=${encodeURIComponent(context.course.id)}`
    const doc = await fetchHtmlDocument(url)
    const main = getMainContent(doc)
    const links = Array.from(main.querySelectorAll("a[href]"))
      .map((link) => ({ title: cleanText(link.textContent), url: absoluteUrl(link.getAttribute("href"), url) }))
      .filter((link) => link.url)
    const data = {
      id: `course-overview-${context.course.id}`,
      type: "courseOverview",
      title: "Tổng quan khóa học",
      sourceUrl: url,
      localPath: "00-course/overview.md",
      markdown: htmlToMarkdown(main, url),
      links
    }
    context.entities.push(data)
    addText(context, "00-course/overview.md", `# Tổng quan khóa học\n\nNguồn: ${url}\n\n${data.markdown}\n`)
    addJson(context, "00-course/metadata.json", { format: FORMAT, exportedAt: context.exportedAt, course: context.course, overviewUrl: url })

    for (const link of links) {
      if (!/viewfile\.php/i.test(link.url) && !/đề cương|de cuong|lịch trình|lich trinh/i.test(link.title)) continue
      const kind = /outline|đề cương|de cuong/i.test(`${link.url} ${link.title}`) ? "syllabus" : "schedule"
      const label = kind === "syllabus" ? "Đề cương" : "Lịch trình"
      const result = await addRemoteAsset(context, link.url, `00-course/${kind}/${label}`, { allowHtml: true })
      context.entities.push({
        id: `${kind}-${context.course.id}`,
        type: kind,
        title: link.title || label,
        sourceUrl: link.url,
        localPath: result?.path || null,
        accessState: result ? "available" : "failed"
      })
    }
  }

  async function collectContent(context) {
    const targets = context.inventory.activities.filter((activity) => activity.group === "content")
    for (let index = 0; index < targets.length; index += 1) {
      await waitIfPaused()
      if (cancelRequested) return
      const activity = targets[index]
      activeSession.message = `Nội dung ${index + 1}/${targets.length}: ${activity.title}`
      renderPanel()
      const directory = `01-content/${pathForActivity(activity)}`

      if (activity.accessState === "inline") {
        const element = findActivityElement(activity.activityId)
        const markdown = element ? htmlToMarkdown(element, location.href) : activity.summary || activity.title
        addText(context, `${directory}/content.md`, `# ${activity.title}\n\n${markdown}\n`)
        addJson(context, `${directory}/activity.json`, activity)
        updateEntity(context, activity.id, { localPath: `${directory}/content.md` })
        continue
      }
      if (activity.accessState !== "available" || !activity.sourceUrl) {
        context.diagnostics.skipped.push({ id: activity.id, reason: activity.restriction || "ELOLMS chưa cho phép truy cập" })
        continue
      }
      if (activity.materialType) {
        addJson(context, `${directory}/activity.json`, {
          ...activity,
          note: "Tệp này được tải bởi trình tải học liệu và đặt trong cây thư mục khóa học tương ứng."
        })
        continue
      }

      try {
        const fetchUrl = sameOriginUrl(activity.sourceUrl)
        if (!fetchUrl) throw new Error("Liên kết hoạt động ngoài miền không được tải tự động.")
        const response = await fetch(fetchUrl, { credentials: "include", redirect: "follow", cache: "no-store" })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const responseUrl = sameOriginUrl(response.url || fetchUrl)
        if (!responseUrl) throw new Error("Trang hoạt động chuyển hướng sang miền ngoài; đã bỏ qua.")
        const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase()
        if (/text\/html|application\/xhtml\+xml/.test(contentType)) {
          const doc = parseHtml(await response.text(), responseUrl)
          const main = getMainContent(doc)
          const markdown = htmlToMarkdown(main, responseUrl)
          addText(context, `${directory}/content.md`, `# ${activity.title}\n\nNguồn: ${activity.sourceUrl}\n\n${markdown}\n`)
          addJson(context, `${directory}/activity.json`, { ...activity, resolvedUrl: responseUrl, contentType })
          await collectEmbeddedAssets(context, main, responseUrl, `${directory}/assets`)
          updateEntity(context, activity.id, { localPath: `${directory}/content.md` })
        } else {
          const extension = extensionForResponse(contentType, responseUrl) || extensionFromValue(activity.title) || "bin"
          const bytes = new Uint8Array(await response.arrayBuffer())
          const path = `${directory}/${sanitizeSegment(removeKnownExtension(activity.title), 80)}.${extension}`
          addBinary(context, path, bytes, { sourceUrl: activity.sourceUrl, contentType })
          addJson(context, `${directory}/activity.json`, { ...activity, resolvedUrl: responseUrl, contentType, localPath: path })
          updateEntity(context, activity.id, { localPath: path })
        }
      } catch (error) {
        context.diagnostics.errors.push({ id: activity.id, sourceUrl: activity.sourceUrl, message: readableError(error) })
      }
    }
  }

  async function collectForums(context) {
    const targets = context.inventory.activities.filter((activity) => activity.group === "forums" && activity.sourceUrl && activity.accessState === "available")
    const api = /** @type {any} */ (window).OUYeahForumExportApi
    if (!api?.collectBundle) throw new Error("Module xuất diễn đàn chưa sẵn sàng.")

    for (let index = 0; index < targets.length; index += 1) {
      await waitIfPaused()
      if (cancelRequested) return
      const activity = targets[index]
      activeSession.message = `Diễn đàn ${index + 1}/${targets.length}: ${activity.title}`
      renderPanel()
      try {
        const bundle = await api.collectBundle(activity.sourceUrl)
        const directory = `02-forums/${forumDirectory(activity)}`
        for (const file of bundle.files || []) addBinary(context, `${directory}/${file.name}`, file.data)
        const entity = context.entities.find((item) => item.id === activity.id)
        if (entity) {
          entity.localPath = `${directory}/forum.json`
          entity.topicCount = bundle.exported?.topicCount || 0
          entity.postCount = bundle.exported?.postCount || 0
        }
      } catch (error) {
        context.diagnostics.errors.push({ id: activity.id, sourceUrl: activity.sourceUrl, message: readableError(error) })
      }
    }
  }

  async function collectAssignments(context) {
    const targets = context.inventory.activities.filter((activity) => activity.group === "assignments")
    for (let index = 0; index < targets.length; index += 1) {
      await waitIfPaused()
      if (cancelRequested) return
      const activity = targets[index]
      if (!activity.sourceUrl || activity.accessState !== "available") {
        context.diagnostics.skipped.push({ id: activity.id, reason: activity.restriction || "Bài tập chưa mở" })
        continue
      }
      activeSession.message = `Bài tập ${index + 1}/${targets.length}: ${activity.title}`
      renderPanel()
      try {
        const doc = await fetchHtmlDocument(activity.sourceUrl)
        const main = getMainContent(doc)
        const directory = `03-assignments/${assignmentDirectory(activity)}`
        const tables = extractTables(main)
        const markdown = htmlToMarkdown(main, activity.sourceUrl)
        const hasOwnSubmission = /trạng thái nộp bài|submission status|lần sửa cuối|last modified|bài nộp/i.test(cleanText(main.textContent))
        const links = collectFileLinks(main, activity.sourceUrl)
        const assets = []
        for (const link of links) {
          const result = await addRemoteAsset(context, link.url, `${directory}/files/${sanitizeSegment(link.title || "Tệp", 70)}`)
          if (result) assets.push({ ...link, localPath: result.path })
        }
        const data = {
          ...activity,
          type: "assignment",
          exportedAt: context.exportedAt,
          hasOwnSubmission,
          ownDataOnly: true,
          tables,
          attachments: assets
        }
        addText(context, `${directory}/assignment.md`, `# ${activity.title}\n\nNguồn: ${activity.sourceUrl}\n\n${markdown}\n`)
        addJson(context, `${directory}/assignment.json`, data)
        updateEntity(context, activity.id, { localPath: `${directory}/assignment.json`, ownDataOnly: true })
      } catch (error) {
        context.diagnostics.errors.push({ id: activity.id, sourceUrl: activity.sourceUrl, message: readableError(error) })
      }
    }
  }

  async function collectAssessments(context) {
    const targets = context.inventory.activities.filter((activity) => activity.group === "assessments")
    for (let index = 0; index < targets.length; index += 1) {
      await waitIfPaused()
      if (cancelRequested) return
      const activity = targets[index]
      if (!activity.sourceUrl || activity.accessState !== "available") {
        context.diagnostics.skipped.push({ id: activity.id, reason: activity.restriction || "Bài đánh giá chưa mở" })
        continue
      }
      activeSession.message = `Đánh giá ${index + 1}/${targets.length}: ${activity.title}`
      renderPanel()
      try {
        if (activity.moduleType === "quiz") await collectQuiz(context, activity)
        else await collectGenericAssessment(context, activity)
      } catch (error) {
        context.diagnostics.errors.push({ id: activity.id, sourceUrl: activity.sourceUrl, message: readableError(error) })
      }
    }
  }

  async function collectQuiz(context, activity) {
    const doc = await fetchHtmlDocument(activity.sourceUrl)
    const main = getMainContent(doc)
    const activityUrl = new URL(activity.sourceUrl)
    const viewPages = await collectPaginatedDocuments(activity.sourceUrl, doc, (candidate) => {
      const url = new URL(candidate)
      return url.origin === location.origin
        && url.pathname.toLowerCase() === "/mod/quiz/view.php"
        && url.searchParams.get("id") === activityUrl.searchParams.get("id")
    })
    const reviewUrls = dedupeBy(viewPages.flatMap(({ doc: page, url }) => Array.from(page.querySelectorAll("a[href*='/mod/quiz/review.php?attempt=']"))
      .map((link) => absoluteUrl(link.getAttribute("href"), url))
      .filter(Boolean)), (url) => url)
    const questionsById = new Map()
    const attempts = []
    const directory = `04-assessments/${assessmentDirectory(activity)}`

    for (let index = 0; index < reviewUrls.length; index += 1) {
      const reviewUrl = reviewUrls[index]
      try {
        const reviewDoc = await fetchHtmlDocument(reviewUrl)
        const attemptId = new URL(reviewUrl).searchParams.get("attempt") || String(index + 1)
        const questions = Array.from(reviewDoc.querySelectorAll(".que"))
          .map((question) => extractReviewedQuestion(question, attemptId, reviewUrl))
        attempts.push({ attemptId, sourceUrl: reviewUrl, questionCount: questions.length })
        for (const question of questions) mergeQuestion(questionsById, question)
      } catch (error) {
        context.diagnostics.warnings.push({ id: activity.id, sourceUrl: reviewUrl, message: readableError(error) })
      }
    }

    const questions = [...questionsById.values()]
    const imageFiles = []
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const question = questions[questionIndex]
      for (let imageIndex = 0; imageIndex < question.images.length; imageIndex += 1) {
        const image = question.images[imageIndex]
        const result = await addRemoteAsset(context, image.sourceUrl, `${directory}/images/question-${pad(questionIndex + 1)}-${pad(imageIndex + 1)}`)
        if (result) {
          image.localPath = result.path
          imageFiles.push(result.path)
        }
      }
    }

    const data = {
      format: "ou-yeah-quiz-bank-v3",
      exportedAt: context.exportedAt,
      quiz: { id: activity.activityId, title: activity.title, sourceUrl: activity.sourceUrl },
      collection: {
        mode: reviewUrls.length ? "completed-review" : "metadata-only",
        completedReviewPages: attempts.length,
        uniqueQuestions: questions.length,
        doesNotCreateAttempts: true
      },
      attempts,
      questions,
      imageFiles,
      pageSummary: cleanText(main.textContent)
    }
    addJson(context, `${directory}/quiz-bank.json`, data)
    addText(context, `${directory}/quiz-bank.md`, renderQuizMarkdown(data))
    updateEntity(context, activity.id, { localPath: `${directory}/quiz-bank.json`, reviewMode: data.collection.mode })
  }

  async function collectGenericAssessment(context, activity) {
    const doc = await fetchHtmlDocument(activity.sourceUrl)
    const main = getMainContent(doc)
    const directory = `04-assessments/${assessmentDirectory(activity)}`
    addText(context, `${directory}/assessment.md`, `# ${activity.title}\n\nNguồn: ${activity.sourceUrl}\n\n${htmlToMarkdown(main, activity.sourceUrl)}\n`)
    addJson(context, `${directory}/assessment.json`, {
      ...activity,
      exportedAt: context.exportedAt,
      tables: extractTables(main),
      ownDataOnly: true
    })
    updateEntity(context, activity.id, { localPath: `${directory}/assessment.json`, ownDataOnly: true })
  }

  async function collectLearningSchedule(context) {
    const url = `${location.origin}/theme/boost/coursepages/learningschedule.php?id=${encodeURIComponent(context.course.id)}`
    const doc = await fetchHtmlDocument(url)
    const main = getMainContent(doc)
    const tables = extractTables(main)
    const rows = tables.flatMap((table) => table.rows)
    const links = Array.from(main.querySelectorAll("a[href]"))
      .map((link) => ({ title: cleanText(link.textContent), url: absoluteUrl(link.getAttribute("href"), url) }))
      .filter((link) => link.title && link.url)
    const structuredEvents = extractLearningScheduleEvents(main, url)
    const fallbackEvents = dedupeBy(rows.filter((row) => row.some((cell) => /\d{1,2}[:/]\d{1,2}|hoàn thành|completed/i.test(cell))), (row) => normalizeForKey(row.join("|")))
      .map((row, index) => ({ id: `schedule-row-${index + 1}`, kind: "table-row", cells: row }))
    const events = structuredEvents.length ? structuredEvents : fallbackEvents
    const data = {
      format: FORMAT,
      exportedAt: context.exportedAt,
      sourceUrl: url,
      eventCount: events.length,
      events,
      tables,
      links
    }
    context.entities.push({ id: `learning-schedule-${context.course.id}`, type: "learningSchedule", title: "Lịch trình học tập", sourceUrl: url, localPath: "00-course/schedule/learning-schedule.json", eventCount: events.length, accessState: "available" })
    addJson(context, "00-course/schedule/learning-schedule.json", data)
    addText(context, "00-course/schedule/learning-schedule.md", renderScheduleMarkdown(data, htmlToMarkdown(main, url)))
    addText(context, "00-course/schedule/calendar.ics", renderScheduleIcs(context.course, events))
  }

  function extractLearningScheduleEvents(root, baseUrl) {
    const events = Array.from(root.querySelectorAll("a[data-event-id][href]")).map((link) => {
      const eventItem = link.closest("[data-region='event-item']")
      const day = link.closest("[data-day-timestamp]")
      const text = cleanText(link.textContent)
      const time = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/)?.slice(1, 3).map(pad).join(":") || ""
      const dayTimestamp = Number(day?.getAttribute("data-day-timestamp"))
      const date = Number.isFinite(dayTimestamp) && dayTimestamp > 0 ? localDateFromTimestamp(dayTimestamp) : ""
      const title = cleanText(link.getAttribute("title")) || cleanText(text.replace(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/, " "))
      return {
        id: link.getAttribute("data-event-id") || hashString(`${title}|${date}|${time}`),
        kind: "calendar-event",
        title,
        sourceUrl: absoluteUrl(link.getAttribute("href"), baseUrl),
        date,
        time,
        startLocal: date && time ? `${date}T${time}:00` : "",
        dayTimestamp: Number.isFinite(dayTimestamp) && dayTimestamp > 0 ? dayTimestamp : null,
        component: eventItem?.getAttribute("data-event-component") || "",
        eventType: eventItem?.getAttribute("data-event-eventtype") || ""
      }
    }).filter((event) => event.title)
    return dedupeBy(events, (event) => event.id || normalizeForKey(`${event.title}|${event.startLocal}|${event.sourceUrl}`))
  }

  function localDateFromTimestamp(timestampSeconds) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(timestampSeconds * 1000))
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }

  async function collectGrades(context) {
    const url = `${location.origin}/grade/report/index.php?id=${encodeURIComponent(context.course.id)}`
    const doc = await fetchHtmlDocument(url)
    const main = getMainContent(doc)
    const tables = extractTables(main)
    const profile = doc.querySelector("a[href*='/user/profile.php?id='], a[href*='/user/view.php?id=']")
    const data = {
      format: FORMAT,
      exportedAt: context.exportedAt,
      sourceUrl: url,
      scope: "current-user-only",
      user: { name: cleanText(profile?.textContent), profileUrl: absoluteUrl(profile?.getAttribute("href"), url) },
      tables
    }
    context.entities.push({ id: `grades-self-${context.course.id}`, type: "gradeReport", title: "Điểm số của tôi", sourceUrl: url, localPath: "05-learning/grades-self.json", accessState: "available", privacy: "personal" })
    addJson(context, "05-learning/grades-self.json", data)
    addText(context, "05-learning/grades-self.md", `# Điểm số của tôi\n\n> Chỉ chứa báo cáo của tài khoản đang đăng nhập.\n\nNguồn: ${url}\n\n${htmlToMarkdown(main, url)}\n`)
  }

  async function collectParticipants(context) {
    const url = new URL(`${location.origin}/user/index.php`)
    url.searchParams.set("id", context.course.id)
    url.searchParams.set("perpage", "5000")
    const doc = await fetchHtmlDocument(url.href)
    const pages = await collectPaginatedDocuments(url.href, doc, (candidate) => {
      const pageUrl = new URL(candidate)
      return pageUrl.origin === location.origin
        && pageUrl.pathname.toLowerCase() === "/user/index.php"
        && pageUrl.searchParams.get("id") === context.course.id
    })
    const rows = []
    pages.forEach(({ doc: page, url: pageUrl }) => {
      page.querySelectorAll("table tbody tr").forEach((row) => {
        const profile = row.querySelector("a[href*='/user/view.php?id='], a[href*='/user/profile.php?id=']")
        if (!(profile instanceof HTMLAnchorElement)) return
        const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent))
        const profileUrl = absoluteUrl(profile.getAttribute("href"), pageUrl)
        const userId = profileUrl ? new URL(profileUrl).searchParams.get("id") : ""
        rows.push({
          id: userId || hashString(profileUrl),
          name: cleanText(profile.textContent),
          profileUrl,
          role: cells.find((cell) => /sinh viên|student|giảng viên|teacher|manager/i.test(cell)) || "",
          group: cells.find((cell) => /TPE|nhóm|group/i.test(cell)) || ""
        })
      })
    })
    const participants = dedupeBy(rows, (row) => row.id)
    const data = {
      format: FORMAT,
      exportedAt: context.exportedAt,
      sourceUrl: url.href,
      privacy: "sensitive-opt-in",
      excludedFields: ["lastAccess", "email", "hiddenProfileFields", "grades", "submissions"],
      sourcePageCount: pages.length,
      participantCount: participants.length,
      participants
    }
    context.entities.push({ id: `participants-${context.course.id}`, type: "participantDirectory", title: "Danh sách thành viên", sourceUrl: url.href, localPath: "06-people/participants.json", participantCount: participants.length, accessState: "available", privacy: "sensitive" })
    addJson(context, "06-people/participants.json", data)
    addText(context, "06-people/participants.md", renderParticipantsMarkdown(data))
  }

  async function collectNotifications(context) {
    const url = `${location.origin}/message/output/popup/notifications.php`
    const doc = await fetchHtmlDocument(url)
    const main = getMainContent(doc)
    let candidates = Array.from(main.querySelectorAll("[data-region='notification-content'], [data-region='notification'], .notification"))
    if (!candidates.length) candidates = Array.from(main.querySelectorAll("[data-region='notification-list'] li, .notification-area li, table tbody tr"))
    const notifications = []
    candidates.forEach((node, index) => {
      const text = cleanText(node.textContent)
      if (!text || text.length < 8) return
      const link = node.querySelector("a[href]")
      notifications.push({
        id: node.id || `notification-${index + 1}`,
        text,
        sourceUrl: absoluteUrl(link?.getAttribute("href"), url) || null
      })
    })
    const unique = dedupeBy(notifications, (item) => normalizeForKey(`${item.text}|${item.sourceUrl || ""}`)).slice(0, 500)
    const data = {
      format: FORMAT,
      exportedAt: context.exportedAt,
      sourceUrl: url,
      scope: "current-account-visible-page",
      canonical: false,
      limitation: "ELOLMS có thể chỉ cung cấp một cửa sổ thông báo gần đây; diễn đàn và lịch trình là nguồn chuẩn hơn.",
      notificationCount: unique.length,
      notifications: unique
    }
    context.entities.push({ id: `notifications-${context.course.id}`, type: "notificationFeed", title: "Thông báo tài khoản", sourceUrl: url, localPath: "90-user-feed/notifications.json", notificationCount: unique.length, accessState: "available", privacy: "personal" })
    addJson(context, "90-user-feed/notifications.json", data)
    addText(context, "90-user-feed/notifications.md", renderNotificationsMarkdown(data))
  }

  function scanCourseInventory() {
    const activities = []
    const seen = new Set()
    document.querySelectorAll(".course-content .activity").forEach((element, index) => {
      if (!(element instanceof HTMLElement)) return
      const sourceLink = element.querySelector(".activityname a[href], a.aalink[href], a[href*='/mod/']")
      const sourceCandidate = absoluteUrl(sourceLink?.getAttribute("href"), location.href)
      const sourceUrl = sameOriginUrl(sourceCandidate)
      const moduleType = moduleTypeFor(element, sourceCandidate)
      const rawId = element.dataset.id || element.dataset.cmid || element.id.match(/module-(\d+)/)?.[1]
        || (sourceUrl ? new URL(sourceUrl).searchParams.get("id") : "") || String(index + 1)
      const id = `${moduleType}-${rawId}`
      if (seen.has(id)) return
      seen.add(id)
      const titleNode = element.querySelector(".activityname .instancename, .activityname, .instancename")
      const title = cleanActivityTitle(titleNode?.textContent || sourceLink?.textContent || `Hoạt động ${index + 1}`)
      const restriction = cleanText(element.querySelector(".availabilityinfo, .description .alert, [data-region='availabilityinfo']")?.textContent)
      const accessState = sourceUrl ? "available" : moduleType === "label" ? "inline" : "restricted"
      const sectionPath = sectionPathFor(element)
      const materialType = materialTypeFor(title)
      activities.push({
        id,
        activityId: String(rawId),
        moduleType,
        group: groupForActivity(moduleType, title),
        materialType,
        title,
        sourceUrl: sourceUrl || null,
        sectionPath,
        order: index + 1,
        accessState,
        restriction: accessState === "restricted"
          ? restriction || (sourceCandidate ? "Liên kết ngoài miền không được tải tự động" : "ELOLMS không cung cấp liên kết truy cập")
          : "",
        summary: cleanText(element.querySelector(".contentafterlink, .description")?.textContent),
        privacy: privacyForActivity(moduleType)
      })
    })
    return {
      capturedAt: new Date().toISOString(),
      activities,
      counts: {
        available: activities.filter((item) => ["available", "inline"].includes(item.accessState)).length,
        restricted: activities.filter((item) => item.accessState === "restricted").length,
        total: activities.length
      }
    }
  }

  function moduleTypeFor(element, sourceUrl) {
    const match = String(element.className).match(/(?:^|\s)modtype_([a-z0-9_-]+)/i)
    if (match) return match[1].toLowerCase()
    if (sourceUrl) return new URL(sourceUrl).pathname.match(/\/mod\/([^/]+)\//i)?.[1]?.toLowerCase() || "resource"
    return "label"
  }

  function groupForActivity(moduleType, title) {
    if (moduleType === "forum") return "forums"
    if (moduleType === "assign") return "assignments"
    if (["quiz", "feedback", "choice", "survey", "questionnaire"].includes(moduleType)) return "assessments"
    if (/bài tập (nhóm|lớn)/i.test(title)) return "assignments"
    return "content"
  }

  function privacyForActivity(moduleType) {
    if (moduleType === "forum") return "class"
    if (["assign", "quiz", "feedback"].includes(moduleType)) return "personal"
    return "course"
  }

  function materialTypeFor(title) {
    const normalized = normalizeForKey(title)
    if (/^\[xem\]\s+video\b/.test(normalized)) return "video"
    if (/^\[tai ve\]\s+slide\b/.test(normalized)) return "slide"
    if (/^\[tai ve\]\s+script\b/.test(normalized)) return "script"
    return null
  }

  function sectionPathFor(element) {
    const path = []
    let section = element.closest(".course-section")
    while (section instanceof HTMLElement) {
      const title = cleanText(section.querySelector(":scope > .course-section-header .sectionname, :scope > .sectionname, :scope > .content > h3.sectionname")?.textContent)
      if (title) path.unshift(title)
      section = section.parentElement?.closest(".course-section") || null
    }
    return path
  }

  function courseMetadata() {
    const courseId = getCourseId()
    const title = cleanText(document.querySelector(".page-header-headings h1, header h1")?.textContent)
      || cleanText(document.title.replace(/\s*\|\s*ELOLMS.*$/i, "")) || `Khóa học ${courseId}`
    const code = cleanText(document.querySelector(".page-header-headings h6, header h6")?.textContent)
      || cleanText(document.querySelector("[data-course-code]")?.getAttribute("data-course-code"))
    return { id: courseId, title, code, sourceUrl: canonicalCourseUrl(courseId), progress: courseProgress() }
  }

  function courseProgress() {
    const nodes = Array.from(document.querySelectorAll("[role='progressbar'], .progress-bar, [aria-valuenow]"))
    for (const node of nodes) {
      const value = Number(node.getAttribute("aria-valuenow") || String(node.textContent).match(/(\d{1,3})\s*%/)?.[1])
      if (Number.isFinite(value) && value >= 0 && value <= 100) return value
    }
    const match = cleanText(document.body.textContent).match(/(?:Completed|Hoàn thành)\s*(\d{1,3})\s*%/i)
    return match ? Number(match[1]) : null
  }

  function getCourseId() {
    return new URL(location.href).searchParams.get("id") || "unknown"
  }

  function canonicalCourseUrl(courseId) {
    return `${location.origin}/course/view.php?id=${encodeURIComponent(courseId)}`
  }

  function findActivityElement(activityId) {
    const escaped = CSS.escape(String(activityId))
    return document.querySelector(`#module-${escaped}, .activity[data-id='${escaped}'], .activity[data-cmid='${escaped}']`)
  }

  function pathForActivity(activity) {
    const sections = activity.sectionPath?.length ? activity.sectionPath : ["Khác"]
    return [...sections, `${pad(activity.order)}-${activity.title}`].map((part) => sanitizeSegment(part, 90)).join("/")
  }

  function forumDirectory(activity) {
    return `${pad(activity.order)}-${sanitizeSegment(activity.title, 90)}`
  }

  function assignmentDirectory(activity) {
    return `${pathForActivity(activity)}`
  }

  function assessmentDirectory(activity) {
    return `${pathForActivity(activity)}`
  }

  async function fetchHtmlDocument(url) {
    const fetchUrl = sameOriginUrl(url)
    if (!fetchUrl) throw new Error("Chỉ tải trang dữ liệu từ miền ELOLMS hiện tại.")
    const response = await fetch(fetchUrl, { credentials: "include", redirect: "follow", cache: "no-store" })
    if (!response.ok) throw new Error(`ELOLMS trả về HTTP ${response.status}.`)
    const responseUrl = sameOriginUrl(response.url || fetchUrl)
    if (!responseUrl) throw new Error("ELOLMS chuyển hướng sang miền ngoài; đã bỏ qua dữ liệu này.")
    const html = await response.text()
    const doc = parseHtml(html, responseUrl)
    if (doc.querySelector("#login, form[action*='/login/index.php']")) throw new Error("Phiên đăng nhập ELOLMS đã hết hạn.")
    return doc
  }

  async function collectPaginatedDocuments(startUrl, firstDocument, acceptsUrl, maxPages = 100) {
    const pages = [{ url: startUrl, doc: firstDocument }]
    const seen = new Set([canonicalPageUrl(startUrl)])
    const queue = paginationUrls(firstDocument, startUrl).filter(acceptsUrl)

    while (queue.length && pages.length < maxPages) {
      await waitIfPaused()
      if (cancelRequested) break
      const nextUrl = queue.shift()
      const key = canonicalPageUrl(nextUrl)
      if (seen.has(key)) continue
      seen.add(key)
      const doc = await fetchHtmlDocument(nextUrl)
      pages.push({ url: nextUrl, doc })
      paginationUrls(doc, nextUrl).filter(acceptsUrl).forEach((url) => {
        if (!seen.has(canonicalPageUrl(url))) queue.push(url)
      })
    }

    return pages
  }

  function paginationUrls(doc, baseUrl) {
    const pageParameterNames = new Set(["page", "offset", "limitfrom", "attemptpage", "p"])
    return dedupeBy(Array.from(doc.querySelectorAll(".pagination a[href], [data-region='paging-control-container'] a[href], a[data-page-number][href]"))
      .map((link) => ({
        url: absoluteUrl(link.getAttribute("href"), baseUrl),
        explicitPage: link.hasAttribute("data-page-number")
      }))
      .filter(({ url, explicitPage }) => {
        if (!url) return false
        const parsed = new URL(url, baseUrl)
        if (parsed.searchParams.has("tifirst") || parsed.searchParams.has("tilast")) return false
        return explicitPage || [...parsed.searchParams.keys()].some((key) => pageParameterNames.has(key.toLowerCase()))
      })
      .map(({ url }) => url), (url) => canonicalPageUrl(url))
  }

  function canonicalPageUrl(value) {
    const url = new URL(value, location.href)
    url.hash = "";
    [...new Set(url.searchParams.keys())].sort().forEach((key) => {
      const values = url.searchParams.getAll(key).sort()
      url.searchParams.delete(key)
      values.forEach((item) => url.searchParams.append(key, item))
    })
    return url.href
  }

  function parseHtml(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html")
    const base = doc.createElement("base")
    base.href = baseUrl
    doc.head.prepend(base)
    return doc
  }

  function getMainContent(doc) {
    return doc.querySelector("#region-main, [role='main'], main, .course-content") || doc.body
  }

  function extractTables(root) {
    return Array.from(root.querySelectorAll("table")).map((table, index) => {
      const rows = Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll(":scope > th, :scope > td"))
        .map((cell) => cleanText(cell.textContent)))
      return { index: index + 1, caption: cleanText(table.querySelector("caption")?.textContent), rows }
    }).filter((table) => table.rows.length)
  }

  function collectFileLinks(root, baseUrl) {
    const accepted = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|csv|zip|rar|7z)(?:$|[?#])/i
    return dedupeBy(Array.from(root.querySelectorAll("a[href]")).map((link) => ({
      title: cleanText(link.textContent) || cleanText(link.getAttribute("download")) || "Tệp đính kèm",
      url: absoluteUrl(link.getAttribute("href"), baseUrl)
    })).filter((link) => link.url && (/pluginfile\.php|forcedownload|viewfile\.php/i.test(link.url) || accepted.test(link.url))), (link) => link.url)
  }

  async function collectEmbeddedAssets(context, root, baseUrl, directory) {
    const imageLinks = Array.from(root.querySelectorAll("img[src]"))
      .map((image, index) => ({ title: cleanText(image.getAttribute("alt")) || `Ảnh ${index + 1}`, url: absoluteUrl(image.getAttribute("src"), baseUrl) }))
      .filter((item) => item.url && !/avatar|userpix|theme\/image/i.test(item.url))
    const files = [...imageLinks, ...collectFileLinks(root, baseUrl)]
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      await addRemoteAsset(context, file.url, `${directory}/${pad(index + 1)}-${sanitizeSegment(file.title, 60)}`)
    }
  }

  async function addRemoteAsset(context, url, preferredPath, options = {}) {
    const fetchUrl = sameOriginUrl(url)
    if (!fetchUrl) {
      if (url) context.diagnostics.warnings.push({ sourceUrl: url, message: "Tài nguyên ngoài miền không được tải tự động; chỉ giữ tham chiếu nguồn." })
      return null
    }
    context.assetCache ||= new Map()
    if (context.assetCache.has(fetchUrl)) return context.assetCache.get(fetchUrl)
    const response = await fetch(fetchUrl, { credentials: "include", redirect: "follow", cache: "no-store" })
    if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ${fetchUrl}`)
    const responseUrl = sameOriginUrl(response.url || fetchUrl)
    if (!responseUrl) throw new Error("Tài nguyên chuyển hướng sang miền ngoài; đã bỏ qua.")
    const length = Number(response.headers.get("content-length") || 0)
    if (length > MAX_BINARY_FILE_BYTES) {
      context.diagnostics.skipped.push({ sourceUrl: url, reason: `Tệp lớn hơn giới hạn ${formatBytes(MAX_BINARY_FILE_BYTES)}` })
      return null
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase()
    let result
    if (options.allowHtml && /text\/html|application\/xhtml\+xml/.test(contentType)) {
      const doc = parseHtml(await response.text(), responseUrl)
      const embeddedUrls = collectEmbeddedDocumentUrls(doc, responseUrl)
      const path = `${stripTrailingExtension(preferredPath)}.md`
      const references = embeddedUrls.length
        ? `\n\n## Tệp được trình xem nhúng\n\n${embeddedUrls.map((item) => `- [${escapeMarkdown(item.kind === "file" ? "Tệp dữ liệu trực tiếp" : "Trình xem")}](<${item.url}>)`).join("\n")}`
        : ""
      addText(context, path, `# ${cleanText(doc.title) || "Tài liệu"}\n\nNguồn: ${responseUrl}${references}\n\n${htmlToMarkdown(getMainContent(doc), responseUrl)}\n`)
      if (embeddedUrls.some((item) => new URL(item.url).origin !== location.origin)) {
        context.diagnostics.warnings.push({
          sourceUrl: url,
          message: "Tài liệu dùng trình xem chéo miền; thư mục AI đã lưu liên kết nguồn nhưng trình duyệt có thể không cho nhúng tệp nhị phân."
        })
      }
      result = { path, sourceUrl: fetchUrl, contentType, embeddedUrls }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      const extension = extensionForResponse(contentType, responseUrl) || extensionFromValue(fetchUrl) || "bin"
      const path = `${stripTrailingExtension(preferredPath)}.${extension}`
      if (!addBinary(context, path, bytes, { sourceUrl: fetchUrl, contentType })) return null
      result = { path, sourceUrl: fetchUrl, contentType, size: bytes.length }
    }
    context.assetCache.set(fetchUrl, result)
    return result
  }

  function collectEmbeddedDocumentUrls(doc, baseUrl) {
    const urls = []
    doc.querySelectorAll("iframe[src], embed[src], object[data]").forEach((node) => {
      const raw = node.getAttribute("src") || node.getAttribute("data")
      const viewerUrl = absoluteUrl(raw, baseUrl)
      if (!viewerUrl) return
      urls.push({ kind: "viewer", url: viewerUrl })
      try {
        const parsedViewer = new URL(viewerUrl)
        const file = parsedViewer.searchParams.get("file")
        const fileUrl = absoluteUrl(file, viewerUrl)
        if (fileUrl) urls.push({ kind: "file", url: fileUrl })
        const portalDocument = parsedViewer.pathname.match(/\/viewpdf\/(1|2)\/(\d+)\/?$/i)
        if (parsedViewer.hostname === "portal.elo.edu.vn" && portalDocument) {
          const endpoint = portalDocument[1] === "1" ? "downloadFileSubjectOutline" : "downloadFileSubjectSchedule"
          urls.push({ kind: "file", url: `${parsedViewer.origin}/api/logic/System/ViewPdf/${endpoint}/${portalDocument[2]}` })
        }
      } catch {
        // The viewer URL is still useful even when it has no parseable file parameter.
      }
    })
    return dedupeBy(urls, (item) => item.url)
  }

  function htmlToMarkdown(root, baseUrl) {
    if (!(root instanceof Element)) return cleanText(root?.textContent)
    const renderChildren = (element, state = {}) => Array.from(element.childNodes).map((node) => renderNode(node, state)).join("")
    const renderNode = (node, state = {}) => {
      if (node.nodeType === Node.TEXT_NODE) return String(node.textContent || "").replace(/\s+/g, " ")
      if (!(node instanceof Element)) return ""
      const tag = node.tagName.toLowerCase()
      if (["script", "style", "noscript", "button", "form", "nav"].includes(tag)) return ""
      if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${renderChildren(node).trim()}\n\n`
      if (tag === "br") return "\n"
      if (tag === "hr") return "\n\n---\n\n"
      if (["strong", "b"].includes(tag)) return `**${renderChildren(node).trim()}**`
      if (["em", "i"].includes(tag)) return `_${renderChildren(node).trim()}_`
      if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${String(node.textContent || "").replace(/`/g, "\\`")}\``
      if (tag === "pre") return `\n\n\`\`\`\n${String(node.textContent || "").trim()}\n\`\`\`\n\n`
      if (tag === "a") {
        const href = absoluteUrl(node.getAttribute("href"), baseUrl)
        const label = renderChildren(node).trim() || href
        return href ? `[${escapeMarkdown(label)}](${href.replace(/\s/g, "%20")})` : label
      }
      if (tag === "img") {
        const src = absoluteUrl(node.getAttribute("src"), baseUrl)
        return src ? `![${escapeMarkdown(cleanText(node.getAttribute("alt")) || "Ảnh")}](<${src}>)` : ""
      }
      if (tag === "table") return renderMarkdownTable(node)
      if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol"
        const lines = Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li")
          .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${renderChildren(item, { inList: true }).trim().replace(/\n+/g, " ")}`)
        return `\n\n${lines.join("\n")}\n\n`
      }
      if (["p", "div", "section", "article", "figure", "figcaption", "blockquote"].includes(tag)) {
        const value = renderChildren(node, state).trim()
        return value ? state.inList ? `${value} ` : `\n\n${tag === "blockquote" ? value.split("\n").map((line) => `> ${line}`).join("\n") : value}\n\n` : ""
      }
      return renderChildren(node, state)
    }
    return cleanupMarkdown(renderChildren(root))
  }

  function renderMarkdownTable(table) {
    const sourceRows = table instanceof Element
      ? Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.children)
        .filter((cell) => ["th", "td"].includes(cell.tagName.toLowerCase()))
        .map((cell) => cleanText(cell.textContent)))
      : Array.isArray(table?.rows) ? table.rows : []
    const rows = sourceRows.map((row) => row.map((cell) => cleanText(cell).replace(/\|/g, "\\|")))
    const width = Math.max(0, ...rows.map((row) => row.length))
    if (!width || !rows.length) return ""
    const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""))
    return `\n\n| ${normalized[0].join(" | ")} |\n| ${normalized[0].map(() => "---").join(" | ")} |${normalized.length > 1 ? `\n${normalized.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}` : ""}\n\n`
  }

  function extractReviewedQuestion(question, attemptId, sourceUrl) {
    const text = cleanText(question.querySelector(".qtext")?.textContent)
    const options = Array.from(question.querySelectorAll(".answer > div, .answer .r0, .answer .r1")).map((option, index) => ({
      key: cleanText(option.querySelector(".answernumber")?.textContent).replace(/[.)\s]+$/g, "") || String.fromCharCode(97 + index),
      text: cleanText(option.querySelector(".flex-fill, .d-flex > div:last-child, label")?.textContent || option.textContent),
      correct: option.classList.contains("correct") || (option.getAttribute("class") || "").split(/\s+/).some((className) => /^đúng$/i.test(className))
    }))
    const rightAnswer = cleanText(question.querySelector(".rightanswer")?.textContent)
    const correctAnswers = correctOptionKeys(options, rightAnswer)
    const correctAnswerSet = new Set(correctAnswers)
    const normalizedOptions = options.map((option) => ({ ...option, correct: correctAnswerSet.has(option.key) }))
    const feedback = cleanText(question.querySelector(".generalfeedback, .specificfeedback, .outcome")?.textContent)
    const images = Array.from(question.querySelectorAll(".qtext img[src], .formulation img[src], .answer img[src], .generalfeedback img[src], .specificfeedback img[src], .outcome img[src]"))
      .map((image) => ({ sourceUrl: absoluteUrl(image.getAttribute("src"), sourceUrl), alt: cleanText(image.getAttribute("alt")) || "Ảnh câu hỏi" }))
      .filter((image) => image.sourceUrl)
    return {
      id: question.id || `question-${hashString(text)}`,
      key: normalizeForKey(text),
      text,
      options: normalizedOptions,
      correctAnswers,
      rightAnswer,
      feedback,
      images,
      observedInAttempts: [attemptId],
      sourceUrls: [sourceUrl]
    }
  }

  function correctOptionKeys(options, rightAnswer) {
    const normalizedRightAnswer = normalizeForKey(rightAnswer)
    const answerText = normalizedRightAnswer.match(/(?:the\s+correct\s+answer\s+is|dap\s+an(?:\s+dung)?(?:\s+la)?)\s*:\s*(.+)$/i)?.[1] || ""
    const normalizedAnswer = normalizeForKey(answerText)
    const keyMatches = normalizedAnswer
      ? options.filter((option) => normalizeForKey(option.key) === normalizedAnswer).map((option) => option.key)
      : []
    const textMatches = normalizedAnswer
      ? options.filter((option) => normalizeForKey(option.text) === normalizedAnswer).map((option) => option.key)
      : []
    if (keyMatches.length) return keyMatches
    if (textMatches.length) return textMatches
    return options.filter((option) => option.correct).map((option) => option.key)
  }

  function mergeQuestion(map, question) {
    if (!question.text) return
    const key = question.key || hashString(question.text)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, question)
      return
    }
    existing.observedInAttempts = [...new Set([...existing.observedInAttempts, ...question.observedInAttempts])]
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...question.sourceUrls])]
    if (!existing.rightAnswer && question.rightAnswer) existing.rightAnswer = question.rightAnswer
    if (!existing.feedback && question.feedback) existing.feedback = question.feedback
    if (!existing.correctAnswers.length && question.correctAnswers.length) existing.correctAnswers = question.correctAnswers
    existing.images = dedupeBy([...existing.images, ...question.images], (image) => image.sourceUrl)
  }

  function renderQuizMarkdown(data) {
    const lines = [
      `# ${data.quiz.title}`,
      "",
      `Nguồn: ${data.quiz.sourceUrl}`,
      "",
      `- Chế độ: ${data.collection.mode}`,
      `- Lượt đã đọc: ${data.collection.completedReviewPages}`,
      `- Câu duy nhất: ${data.collection.uniqueQuestions}`,
      "",
      "> Chỉ xuất các lượt đã làm mà ELOLMS đang cho phép xem lại; OU Yeah! không tự tạo lượt làm bài.",
      ""
    ]
    data.questions.forEach((question, index) => {
      lines.push(`## Câu ${index + 1}`, "", question.text || "_Không đọc được nội dung câu hỏi._", "")
      question.options.forEach((option) => lines.push(`- ${option.key}. ${option.text}${option.correct ? " **(đúng)**" : ""}`))
      if (question.rightAnswer) lines.push("", `**Đáp án ELOLMS:** ${question.rightAnswer}`)
      if (question.feedback) lines.push("", `**Phản hồi:** ${question.feedback}`)
      question.images.forEach((image) => lines.push("", `![${escapeMarkdown(image.alt)}](${image.localPath || image.sourceUrl})`))
      lines.push("")
    })
    return `${cleanupMarkdown(lines.join("\n"))}\n`
  }

  function renderScheduleMarkdown(data, fallbackMarkdown) {
    const lines = ["# Lịch trình học tập", "", `Nguồn: ${data.sourceUrl}`, "", `Số sự kiện nhận diện: ${data.eventCount}`, ""]
    data.events.forEach((event, index) => {
      if (event.kind === "calendar-event") {
        const when = event.startLocal ? event.startLocal.replace("T", " ").slice(0, 16) : [event.date, event.time].filter(Boolean).join(" ")
        lines.push(`- ${index + 1}. **${escapeMarkdown(event.title)}**${when ? ` — ${when}` : ""}${event.sourceUrl ? ` — [Mở](${event.sourceUrl})` : ""}`)
      } else if (Array.isArray(event.cells)) {
        lines.push(`- ${index + 1}. ${event.cells.join(" · ")}`)
      }
    })
    if (data.tables?.length) {
      lines.push("", "## Dữ liệu bảng", "")
      data.tables.forEach((table, index) => lines.push(`### Bảng ${index + 1}`, "", renderMarkdownTable(table), ""))
    }
    if (fallbackMarkdown) lines.push("", "## Bản đầy đủ", "", fallbackMarkdown)
    return `${cleanupMarkdown(lines.join("\n"))}\n`
  }

  function renderScheduleIcs(course, events) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OU Yeah!//Course Data Export//VI", "CALSCALE:GREGORIAN", "X-WR-TIMEZONE:Asia/Ho_Chi_Minh"]
    events.forEach((event) => {
      const parsed = event.startLocal ? event.startLocal.replace(/[-:]/g, "").replace("T", "T")
        : parseScheduleDate(Array.isArray(event.cells) ? event.cells.join(" ") : "")
      if (!parsed) return
      lines.push("BEGIN:VEVENT")
      lines.push(`UID:${hashString(`${course.id}|${event.id}|${parsed}`)}@ou-yeah.local`)
      lines.push(`DTSTAMP:${formatIcsDate(new Date())}`)
      lines.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${parsed}`)
      lines.push(`SUMMARY:${escapeIcs(event.title || event.cells?.find((cell) => cell && !/\d/.test(cell)) || course.title)}`)
      lines.push(`DESCRIPTION:${escapeIcs(event.title || event.cells?.join(" | ") || "")}`)
      lines.push(`URL:${event.sourceUrl || canonicalCourseUrl(course.id)}`)
      lines.push("END:VEVENT")
    })
    lines.push("END:VCALENDAR")
    return `${lines.join("\r\n")}\r\n`
  }

  function parseScheduleDate(text) {
    const match = text.match(/(?:ngày\s*)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})[^\d]{0,12}(\d{1,2})[:h](\d{2})/i)
      || text.match(/ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*(?:năm\s*)?(\d{4})[^\d]{0,12}(\d{1,2})[:h](\d{2})/i)
    if (!match) return null
    const [, day, month, year, hour, minute] = match
    return `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`
  }

  function formatIcsDate(date) {
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  }

  function escapeIcs(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
  }

  function renderParticipantsMarkdown(data) {
    const lines = [
      "# Danh sách thành viên",
      "",
      "> Dữ liệu nhạy cảm, chỉ xuất sau khi người dùng chủ động bật lựa chọn.",
      "> Không gồm email, lần truy cập gần nhất, điểm hoặc bài nộp.",
      "",
      `Nguồn: ${data.sourceUrl}`,
      "",
      "| Họ tên | Vai trò | Nhóm | Hồ sơ |",
      "| --- | --- | --- | --- |"
    ]
    data.participants.forEach((person) => lines.push(`| ${escapeTable(person.name)} | ${escapeTable(person.role)} | ${escapeTable(person.group)} | ${person.profileUrl ? `[Mở](${person.profileUrl})` : ""} |`))
    return `${lines.join("\n")}\n`
  }

  function renderNotificationsMarkdown(data) {
    const lines = [
      "# Thông báo tài khoản",
      "",
      `Nguồn: ${data.sourceUrl}`,
      "",
      `> ${data.limitation}`,
      ""
    ]
    data.notifications.forEach((item, index) => lines.push(`${index + 1}. ${item.text}${item.sourceUrl ? ` — [Chi tiết](${item.sourceUrl})` : ""}`))
    return `${lines.join("\n")}\n`
  }

  function finalizeContext(context) {
    const snapshot = buildSnapshot(context)
    addJson(context, "course-index.json", buildCourseIndex(context, true))
    addText(context, "course-context.md", renderCourseContext(context))
    addJson(context, "access-report.json", buildAccessReport(context))
    addJson(context, "diagnostics/errors.json", context.diagnostics)
    addJson(context, "snapshots/current.json", snapshot)
    addJson(context, "snapshots/changes.json", snapshot.changes)
    addText(context, "README.md", renderPackageReadme(context, snapshot))
    addText(context, "AGENTS.md", renderCourseAgents(context))
    addText(context, "AI-AGENTS.md", renderAiAgents())
    addText(context, "00-START-HERE.md", renderReaderGuide(context))
    addText(context, "FILE-TREE.txt", renderFileTree([
      "../AGENTS.md",
      "AGENTS.md",
      ...context.files
        .filter((file) => !["AGENTS.md", "AI-AGENTS.md"].includes(file.name))
        .map((file) => file.name),
      "FILE-TREE.txt"
    ]))
    addJson(context, "course-index.json", buildCourseIndex(context, true))
  }

  function renderCourseAgents(context) {
    return `# AGENTS.md — ${context.course.title}

This file is the local reading guide for AI agents such as Codex. It applies to this course folder and its descendants.

## Start here

1. Read 00-AI/00-START-HERE.md for the two reading modes.
2. Read 00-AI/course-context.md for the course overview.
3. Use 00-AI/course-index.json for structured entities and relationships.
4. Check 00-AI/access-report.json before treating absent data as unavailable.
5. For AI context, read Script files only through 00-AI/01-content/materials-download.json. Do not open or add Video or Slide files to the agent context; they are kept for human viewing. Its localPath values are relative to this course folder.

## Path rules

- AI-readable files are stored directly under 00-AI/; do not expect an archive to be extracted automatically.
- 00-AI-archive/ is only a historical ZIP backup; do not read it as active AI context.
- Human-readable materials remain in the sibling chapter/topic/part folders.
- ou-yeah-course-manifest.json is the canonical index for downloaded materials and also uses paths relative to this course folder.
- Do not invent, rename or mark as available any file that is absent, locked or failed in the reports.

## Evidence and privacy

- Prefer local files and their recorded sourceUrl values over guesses.
- Keep access limitations, failed downloads and missing pages explicit in answers.
- Treat submissions, grades and participant data as private. Do not share or summarize them beyond the user's request.

Course: **${context.course.title}**
Code: **${context.course.code || "n/a"}**
Source: ${context.course.sourceUrl}
Generated: ${context.exportedAt}
`
  }

  function renderAiAgents() {
    return `# AGENTS.md — AI tree

Read ../AGENTS.md before processing files in this directory.

- course-context.md is the readable overview.
- course-index.json is the structured index.
- access-report.json records access and missing-content states.
- 01-content/materials-download.json maps AI entities to downloaded materials outside 00-AI/. The AI context policy is Script-only: never open or add Video or Slide files to the agent context.

Do not infer content that is locked, missing or marked as failed.
`
  }

  function renderReaderGuide(context) {
    const courseFolder = sanitizeSegment(context.course.title, 24)
    return `# OU Yeah! Course AI Tree\n\nThis folder contains two reading modes for **${context.course.title}** without requiring an archive.\n\n## For AI agents\n\n1. Read the parent \`../AGENTS.md\`.\n2. Start with \`course-context.md\`.\n3. Use \`course-index.json\` to locate entities and relationships.\n4. Check \`access-report.json\` before treating missing content as unavailable.\n5. Use \`01-content/materials-download.json\` to resolve Script files only. Do not open or add Video or Slide files to AI context.\n\n## For human readers\n\nOpen the sibling material tree under:\n\n\`Downloads/OU Yeah!/${courseFolder}/\`\n\nVideo, Slide and Script files are kept there in the chapter/topic/part folders for human viewing. The \`localPath\` values in \`01-content/materials-download.json\` point to those files, but AI agents must read Script only.\n\n## Privacy\n\nReview the files before sharing them. They can contain course content, personal submissions, grades or participant data when those scopes were explicitly selected.\n`
  }

  function buildCourseIndex(context, complete) {
    const byType = countBy(context.entities, (entity) => entity.type || entity.moduleType || "unknown")
    const byAccess = countBy(context.entities, (entity) => entity.accessState || "available")
    return {
      format: FORMAT,
      schemaVersion: 1,
      complete,
      exportedAt: context.exportedAt,
      course: context.course,
      selectedGroups: context.selected,
      selectedMaterialTypes: context.selectedMaterialTypes,
      aiContextPolicy: { ...AI_CONTEXT_POLICY },
      selectedModules: context.selected,
      stats: { entityCount: context.entities.length, fileCount: context.files.length, archiveBytes: context.archiveBytes, byType, byAccess },
      materialDownload: context.materialDownload,
      folders: ["00-course", "01-content", "02-forums", "03-assignments", "04-assessments", "05-learning", "06-people", "90-user-feed", "diagnostics", "snapshots"],
      entities: context.entities.map((entity) => ({
        id: entity.id,
        type: entity.type || entity.moduleType,
        group: entity.group || null,
        materialType: entity.materialType || null,
        title: entity.title,
        sourceUrl: entity.sourceUrl || null,
        localPath: entity.localPath || null,
        sectionPath: entity.sectionPath || [],
        accessState: entity.accessState || "available",
        privacy: entity.privacy || "course"
      })),
      agentHints: {
        startHere: "course-context.md",
        structuredIndex: "course-index.json",
        accessLimitations: "access-report.json",
        changeLog: "snapshots/changes.json",
        instruction: "Ưu tiên localPath; chỉ dùng sourceUrl để đối chiếu khi phiên ELOLMS còn hiệu lực. Không suy diễn nội dung bị khóa."
      }
    }
  }

  function renderCourseContext(context) {
    const available = context.entities.filter((entity) => ["available", "inline"].includes(entity.accessState)).length
    const restricted = context.entities.filter((entity) => entity.accessState === "restricted").length
    const failed = context.entities.filter((entity) => entity.accessState === "failed").length
    const materialTypes = context.selectedMaterialTypes?.length ? context.selectedMaterialTypes.join(", ") : "Không chọn"
    return `# ${context.course.title}\n\n- Mã học phần: ${context.course.code || "Không rõ"}\n- Course ID: ${context.course.id}\n- Nguồn: ${context.course.sourceUrl}\n- Tiến độ tại lúc xuất: ${context.course.progress == null ? "Không xác định" : `${context.course.progress}%`}\n- Thời điểm xuất: ${context.exportedAt}\n- Thực thể truy cập được: ${available}\n- Thực thể bị hạn chế: ${restricted}\n- Thực thể tải lỗi: ${failed}\n\n## Hướng dẫn cho AI agent\n\n1. Đọc \`course-index.json\` để định tuyến theo thực thể và thư mục.\n2. Đọc \`access-report.json\` trước khi kết luận dữ liệu bị thiếu.\n3. Dùng Markdown để hiểu ngữ nghĩa và JSON để xử lý quan hệ/bảng.\n4. Không xem dữ liệu không có trong gói là “không tồn tại”; ELOLMS có thể đang khóa hoặc phân trang.\n5. Ngữ cảnh AI chỉ gồm Script. Không mở hoặc thêm Video/Slide vào ngữ cảnh; đây là học liệu dành cho người đọc trong cây thư mục bên cạnh. Dùng \`materialDownload\` và manifest chỉ để định vị Script khi cần.\n\n## Phạm vi đã chọn\n\n${context.selected.map((id) => `- ${GROUPS.find((group) => group.id === id)?.label || id}`).join("\n")}\n- Loại học liệu đã tải: ${materialTypes}\n- Chính sách ngữ cảnh AI: chỉ đọc Script; không mở hoặc thêm Video/Slide\n`
  }

  function buildAccessReport(context) {
    const available = context.entities
      .filter((entity) => ["available", "inline"].includes(entity.accessState))
      .map((entity) => ({ id: entity.id, title: entity.title, sourceUrl: entity.sourceUrl || null }))
    const restricted = context.entities
      .filter((entity) => entity.accessState === "restricted")
      .map((entity) => ({ id: entity.id, title: entity.title, reason: entity.restriction || "ELOLMS không cho truy cập" }))
    const skipped = context.diagnostics.skipped
    const errors = context.diagnostics.errors
    const failed = context.entities
      .filter((entity) => entity.accessState === "failed")
      .map((entity) => ({ id: entity.id, title: entity.title, sourceUrl: entity.sourceUrl || null, reason: entity.restriction || "Không tải được dữ liệu." }))
    return {
      format: FORMAT,
      exportedAt: context.exportedAt,
      policy: "Chỉ thu thập dữ liệu tài khoản hiện tại được ELOLMS cho phép truy cập; không tự mở khóa, không đánh dấu hoàn thành.",
      summary: {
        available: available.length,
        restricted: restricted.length,
        failed: failed.length,
        skipped: skipped.length,
        errors: errors.length
      },
      available,
      restricted,
      failed,
      skipped,
      errors
    }
  }

  function buildSnapshot(context) {
    const entities = Object.fromEntries(context.entities.map((entity) => [entity.id, {
      signature: hashString(JSON.stringify(stableEntity(entity))),
      title: entity.title,
      type: entity.type || entity.moduleType,
      sourceUrl: entity.sourceUrl || null,
      accessState: entity.accessState || "available"
    }]))
    const previous = context.previousSnapshot?.entities || {}
    const added = Object.keys(entities).filter((id) => !previous[id])
    const removed = Object.keys(previous).filter((id) => !entities[id])
    const changed = Object.keys(entities).filter((id) => previous[id] && previous[id].signature !== entities[id].signature)
    return {
      format: FORMAT,
      courseId: context.course.id,
      capturedAt: context.exportedAt,
      entities,
      changes: {
        comparedWith: context.previousSnapshot?.capturedAt || null,
        added,
        changed,
        removed,
        unchangedCount: Object.keys(entities).length - added.length - changed.length
      }
    }
  }

  function stableEntity(entity) {
    const clone = { ...entity }
    delete clone.exportedAt
    delete clone.observedInAttempts
    return clone
  }

  function updateEntity(context, id, changes) {
    const entity = context.entities.find((item) => item.id === id)
    if (entity) Object.assign(entity, changes)
  }

  function addText(context, name, value) {
    return addBinary(context, name, new TextEncoder().encode(String(value)), { text: true })
  }

  function addJson(context, name, value) {
    return addText(context, name, `${JSON.stringify(value, null, 2)}\n`)
  }

  function addBinary(context, rawName, data, metadata = {}) {
    const name = normalizeArchivePath(rawName)
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (bytes.length > MAX_BINARY_FILE_BYTES) {
      context.diagnostics.skipped.push({ path: name, reason: `Tệp lớn hơn ${formatBytes(MAX_BINARY_FILE_BYTES)}` })
      return false
    }
    const existingIndex = context.files.findIndex((file) => file.name === name)
    const existingSize = existingIndex >= 0 ? context.files[existingIndex].data.length : 0
    if (context.archiveBytes - existingSize + bytes.length > MAX_ARCHIVE_BYTES) {
      context.diagnostics.skipped.push({ path: name, reason: `Gói vượt giới hạn ${formatBytes(MAX_ARCHIVE_BYTES)}` })
      return false
    }
    const file = { name, data: bytes, metadata }
    if (existingIndex >= 0) context.files[existingIndex] = file
    else context.files.push(file)
    context.fileNames.add(name)
    context.archiveBytes = context.archiveBytes - existingSize + bytes.length
    return true
  }

  function renderFileTree(names) {
    const tree = {}
    names.slice().sort().forEach((name) => {
      let cursor = tree
      name.split("/").forEach((segment) => {
        cursor[segment] ||= {}
        cursor = cursor[segment]
      })
    })
    const lines = []
    const walk = (node, depth) => Object.keys(node).sort().forEach((key) => {
      lines.push(`${"  ".repeat(depth)}${key}${Object.keys(node[key]).length ? "/" : ""}`)
      walk(node[key], depth + 1)
    })
    walk(tree, 0)
    return `${lines.join("\n")}\n`
  }

  async function downloadCourseDataTree(context, course) {
    const materialApi = /** @type {any} */ (window).OUYeahCourseDownloadApi
    if (typeof materialApi?.waitForDownloadJob !== "function") {
      throw new Error("Cần tải lại tab ELOLMS để ghi trực tiếp các file AI.")
    }

    const courseFolder = courseDownloadFolder(course)
    const files = context.files.slice()
    for (let index = 0; index < files.length; index += 1) {
      await waitIfPaused()
      if (cancelRequested) return false
      const file = files[index]
      const relativePath = file.name === "AGENTS.md"
        ? "AGENTS.md"
        : file.name === "AI-AGENTS.md"
          ? "00-AI/AGENTS.md"
          : `00-AI/${file.name}`
      activeSession.message = `Đang ghi file AI ${index + 1}/${files.length}: ${relativePath}`
      activeSession.updatedAt = new Date().toISOString()
      renderPanel()
      await persistSession()
      await downloadCourseDataFile(file.data, `${courseFolder}/${relativePath}`, materialApi)
    }
    return true
  }

  async function downloadCourseDataFile(data, filename, materialApi) {
    const blob = new Blob([data], { type: "application/octet-stream" })
    const blobUrl = URL.createObjectURL(blob)
    try {
      const response = await sendExtensionMessage({
        type: "ou-yeah-download-course-file",
        blobUrl,
        filename
      })
      if (!response?.ok || !response.jobId) {
        throw new Error(response?.error || "Không thể ghi file AI vào cây khóa học.")
      }
      const result = await materialApi.waitForDownloadJob(response.jobId, 20 * 60_000)
      if (result?.status !== "complete") {
        throw new Error(result?.label || "Chrome không hoàn tất file AI.")
      }
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    }
  }

  function sendExtensionMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError?.message
          if (error) reject(new Error(error))
          else resolve(response)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function courseDownloadFolder(course) {
    return `OU Yeah!/${sanitizeSegment(course.title, 24)}`
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID)
    if (!(root instanceof HTMLElement)) {
      root = document.createElement("div")
      root.id = ROOT_ID
      document.documentElement.appendChild(root)
    }
    return root
  }

  function closeRoot() {
    const root = document.getElementById(ROOT_ID)
    if (activeSession && ["running", "paused", "building", "delegated"].includes(activeSession.status)) {
      panelMinimized = true
      renderPanel()
      return
    }
    root?.remove()
  }

  function renderPanel() {
    if (!activeSession) return
    const materialApi = /** @type {any} */ (window).OUYeahCourseDownloadApi
    if (activeSession.status === "delegated") {
      materialApi?.clearCourseDataPanel?.()
      document.getElementById(ROOT_ID)?.remove()
      return
    }
    if (activeSession.useUnifiedMaterialPanel
      && ["building", "complete"].includes(activeSession.status)) {
      materialApi?.clearCourseDataPanel?.()
      document.getElementById(ROOT_ID)?.remove()
      return
    }
    const etaText = estimateRemainingText(
      activeSession.completedTasks,
      activeSession.totalTasks,
      activeSession.startedAt,
      activeSession.status
    )
    const panelSummary = {
      eyebrow: "OU YEAH! · COURSE DATA",
      status: activeSession.status,
      title: panelTitle(activeSession.status),
      message: activeSession.message || "",
      current: activeSession.message || "",
      completedTasks: activeSession.completedTasks,
      totalTasks: activeSession.totalTasks,
      startedAt: activeSession.startedAt,
      etaText,
      entitiesCount: activeSession.entitiesCount,
      filesCount: activeSession.filesCount,
      errors: activeSession.errors,
      minimized: panelMinimized
    }
    const onPause = () => {
      pauseRequested = true
      activeSession.status = "paused"
      activeSession.message = "Đã tạm dừng an toàn. Bấm Tiếp tục để chạy tiếp."
      persistSession().catch(handleError)
      renderPanel()
    }
    const onResume = () => {
      pauseRequested = false
      activeSession.status = "running"
      activeSession.message = "Đang tiếp tục tiến trình…"
      persistSession().catch(handleError)
      renderPanel()
    }
    const onCancel = () => {
      if (!window.confirm("Hủy tiến trình hiện tại? Snapshot thành công gần nhất vẫn được giữ.")) return
      cancelRequested = true
      pauseRequested = false
      activeSession.message = "Đang dừng ở điểm an toàn gần nhất…"
      renderPanel()
    }
    const terminalStatus = ["complete", "canceled", "error", "interrupted"].includes(activeSession.status)
    const panelActions = {
      onMinimize: () => {
        panelMinimized = true
        renderPanel()
      },
      onRestore: () => {
        panelMinimized = false
        renderPanel()
      },
      ...(activeSession.status === "running" ? { onPause, onCancel } : {}),
      ...(activeSession.status === "paused" ? { onResume, onCancel } : {}),
      ...(terminalStatus ? {
        ...(activeSession.status !== "complete" || activeSession.errors?.length ? {
          onRetry: () => retryExport().catch(handleError)
        } : {}),
        onNew: openPreview,
        onDismiss: () => {
          materialApi.clearCourseDataPanel?.()
          document.getElementById(ROOT_ID)?.remove()
        }
      } : {})
    }
    if (typeof materialApi?.setCourseDataPanel !== "function") {
      renderCompatCourseDataPanel(panelSummary, panelActions)
      return
    }
    materialApi.setCourseDataPanel(panelSummary, panelActions)
    const unifiedRoot = document.getElementById("ou-yeah-course-download-root")
    const unifiedPanelVisible = unifiedRoot?.dataset.mode === "course-data"
      && unifiedRoot.querySelector(".ou-yeah-course-download-panel, .ou-yeah-course-download-minimized")
    if (!unifiedPanelVisible) {
      materialApi.clearCourseDataPanel?.()
      unifiedRoot?.remove()
      renderCompatCourseDataPanel(panelSummary, panelActions)
      return
    }
    document.getElementById(ROOT_ID)?.remove()
  }

  function renderCompatCourseDataPanel(summary, actions) {
    const root = ensureRoot()
    root.dataset.mode = "panel"
    if (summary.minimized) {
      root.innerHTML = `
        <button type="button" class="ou-yeah-course-download-minimized" data-ou-course-data-restore>
          <span class="ou-yeah-course-download-icon" aria-hidden="true"></span>
          <span class="ou-yeah-course-download-minimized-copy"><strong>${escapeHtml(summary.title)}</strong><small>${escapeHtml(summary.message)}</small></span>
        </button>
      `
      root.querySelector("[data-ou-course-data-restore]")?.addEventListener("click", () => actions.onRestore?.())
      return
    }
    const totalTasks = Math.max(0, Number(summary.totalTasks) || 0)
    const completedTasks = Math.max(0, Number(summary.completedTasks) || 0)
    const percent = totalTasks ? Math.max(0, Math.min(100, Math.round((completedTasks / totalTasks) * 100))) : 0
    root.innerHTML = `
      <aside class="ou-yeah-course-download-panel" data-state="${escapeHtml(summary.status)}" aria-live="polite">
        <div class="ou-yeah-course-download-panel-head">
          <div><span class="ou-yeah-course-download-eyebrow">${escapeHtml(summary.eyebrow)}</span><strong>${escapeHtml(summary.title)}</strong><small>${completedTasks}/${totalTasks} bước · ${summary.entitiesCount || 0} thực thể · ${summary.filesCount || 0} tệp${summary.etaText ? ` · ${escapeHtml(summary.etaText)}` : ""}</small></div>
          <button type="button" data-ou-course-data-minimize aria-label="Thu nhỏ bảng tiến trình" title="Thu nhỏ">−</button>
        </div>
        <div class="ou-yeah-course-download-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
        <div class="ou-yeah-course-download-current">${escapeHtml(summary.current || summary.message)}</div>
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

  async function retryExport() {
    const selected = activeSession?.selectedGroups?.length ? activeSession.selectedGroups : [...DEFAULT_GROUP_IDS]
    const selectedMaterialTypes = activeSession?.selectedMaterialTypes?.length
      ? activeSession.selectedMaterialTypes
      : [...DEFAULT_MATERIAL_TYPES]
    activeSession = null
    await startExport(courseMetadata(), scanCourseInventory(), selected, selectedMaterialTypes)
  }

  async function waitIfPaused() {
    while (pauseRequested && !cancelRequested) await new Promise((resolve) => window.setTimeout(resolve, 180))
  }

  function syncSessionStats(context) {
    if (!activeSession) return
    activeSession.filesCount = context.files.length
    activeSession.entitiesCount = context.entities.length
    activeSession.archiveBytes = context.archiveBytes
    activeSession.updatedAt = new Date().toISOString()
    activeSession.warnings = [...new Set([...(activeSession.warnings || []), ...context.diagnostics.warnings.map((item) => item.message || String(item))])]
  }

  function panelTitle(status) {
    return ({ running: "Đang xuất dữ liệu", paused: "Đã tạm dừng", building: "Đang ghi file AI", delegated: "Đang tải học liệu", complete: "Cây dữ liệu AI đã sẵn sàng", canceled: "Đã hủy", interrupted: "Tiến trình bị gián đoạn", error: "Xuất dữ liệu gặp lỗi" })[status] || "Xuất dữ liệu khóa học"
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

  async function persistSession() {
    if (!activeSession) return
    activeSession.updatedAt = new Date().toISOString()
    await storageSet({ [`${STORAGE_PREFIX}${activeSession.course.id}`]: activeSession })
  }

  function setCourseDataBusy(value) {
    document.documentElement.dataset.ouYeahCourseDataBusy = value ? "true" : "false"
  }

  function handleError(error) {
    const message = readableError(error)
    console.warn("OU Yeah!: course data export failed", error)
    if (!activeSession) return
    activeSession.status = "error"
    activeSession.message = /Extension context invalidated/i.test(message) ? "Tiện ích vừa được cập nhật. Tải lại tab khóa học rồi chạy lại; snapshot trước vẫn an toàn." : message
    activeSession.errors ||= []
    activeSession.errors.push(message)
    setCourseDataBusy(false)
    persistSession().catch(() => {})
    panelMinimized = false
    renderPanel()
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (result) => {
          if (chrome.runtime.lastError) {
            resolve(null)
            return
          }
          resolve(result[key] || null)
        })
      } catch { resolve(null) }
    })
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(values, () => resolve()) } catch { resolve() }
    })
  }

  function normalizeArchivePath(value) {
    return String(value || "file").replace(/\\/g, "/").split("/").filter(Boolean).map((part) => sanitizeSegment(part, 110)).join("/")
  }

  function sanitizeSegment(value, maxLength = 70) {
    const safeValue = Array.from(cleanText(value)).map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("")
    const cleaned = safeValue.replace(/[<>:"/\\|?*]/g, "-").replace(/[. ]+$/g, "").replace(/\s+/g, " ").trim()
    return (cleaned || "Không tên").slice(0, maxLength)
  }

  function stripTrailingExtension(value) {
    return String(value || "").replace(/\.[a-z0-9]{1,8}$/i, "")
  }

  function removeKnownExtension(value) {
    return String(value || "").replace(/\.(pdf|pptx?|ppsx?|docx?|xlsx?|od[tp]|txt|zip|mp4|m4v|webm|mov|mkv)$/i, "")
  }

  function extensionFromValue(value) {
    try {
      return new URL(String(value), location.href).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || ""
    } catch { return String(value || "").match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "" }
  }

  function extensionForResponse(contentType, url) {
    const map = { "application/pdf": "pdf", "application/json": "json", "text/plain": "txt", "text/csv": "csv", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "application/zip": "zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx" }
    if (map[contentType]) return map[contentType]
    return extensionFromValue(url)
  }

  function pad(value) {
    return String(value).padStart(2, "0")
  }

  function absoluteUrl(value, baseUrl = location.href) {
    if (!value || /^(?:javascript|mailto|tel):/i.test(value)) return ""
    try { return new URL(value, baseUrl).href } catch { return "" }
  }

  function sameOriginUrl(value) {
    const url = absoluteUrl(value, location.href)
    try { return url && new URL(url).origin === location.origin ? url : "" } catch { return "" }
  }

  function cleanText(value) {
    return String(value || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim()
  }

  function cleanActivityTitle(value) {
    return cleanText(value).replace(/\s*(?:Tệp|File|URL|Trang|Page|Diễn đàn|Forum|Bài kiểm tra|Quiz)\s*$/i, "").trim()
  }

  function normalizeForKey(value) {
    return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase()
  }

  function cleanupMarkdown(value) {
    return String(value || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  }

  function escapeMarkdown(value) {
    return String(value || "").replace(/([\\`*_[\]<>])/g, "\\$1")
  }

  function escapeTable(value) {
    return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
  }

  function dedupeBy(values, keyOf) {
    const seen = new Set()
    return values.filter((value) => {
      const key = keyOf(value)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function countBy(values, keyOf) {
    return values.reduce((result, value) => {
      const key = keyOf(value)
      result[key] = (result[key] || 0) + 1
      return result
    }, {})
  }

  function hashString(value) {
    let hash = 2166136261
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  }

  function readableError(error) {
    return error instanceof Error ? error.message : String(error || "Lỗi không xác định")
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    let icon = ""
    try { icon = chrome.runtime.getURL("src/icons/inbox-in.svg") } catch { /* Runtime fixtures and freshly reloaded extensions use the text fallback. */ }
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
      #${TOOLBAR_ID}{display:inline-flex;margin-inline:8px}
      .ou-yeah-course-data-button,.ou-yeah-course-data-primary{display:inline-flex;align-items:center;gap:8px;border:1px solid #405fc2;border-radius:10px;background:#405fc2;color:#fff;padding:10px 14px;font:600 14px/1 "Space Grotesk","Segoe UI",sans-serif;cursor:pointer}
      .ou-yeah-course-data-button:hover,.ou-yeah-course-data-primary:hover{background:#3553b4}
      .ou-yeah-course-data-icon{width:18px;height:18px;display:inline-block;background:currentColor;${icon ? `mask:url('${icon}') center/contain no-repeat;-webkit-mask:url('${icon}') center/contain no-repeat` : "border-radius:5px"}}
      #${ROOT_ID},#${ROOT_ID} *{font-family:"Space Grotesk","Segoe UI",sans-serif !important}
      #${ROOT_ID}{color:#202638;position:relative;z-index:2147483000}
      .ou-yeah-course-data-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(2px)}
      .ou-yeah-course-data-dialog{position:fixed;left:50%;top:50%;width:min(880px,calc(100vw - 36px));max-height:calc(100vh - 40px);transform:translate(-50%,-50%);display:flex;flex-direction:column;background:#fff;border:1px solid #dfe4ef;border-radius:22px;box-shadow:0 22px 70px rgba(16,24,40,.22);overflow:hidden}
      .ou-yeah-course-data-dialog>header{display:flex;justify-content:space-between;gap:20px;padding:26px 30px 20px;border-bottom:1px solid #e7eaf1}.ou-yeah-course-data-dialog h2{font-size:25px;margin:4px 0 2px}.ou-yeah-course-data-dialog p{margin:0;color:#737b8e}.ou-yeah-course-data-eyebrow{display:block;color:#5269c7;font-size:11px;font-weight:700;letter-spacing:.08em}
      .ou-yeah-course-data-close,.ou-yeah-course-data-minimize{width:40px;height:40px;border:0;border-radius:12px;background:#f2f4f7;color:#343b4d;font-size:22px;cursor:pointer}

      .ou-yeah-course-data-selection-head{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:0 30px 12px}.ou-yeah-course-data-selection-head strong,.ou-yeah-course-data-selection-head span{display:block}.ou-yeah-course-data-selection-head>div:first-child span{margin-top:3px;color:#7b8394;font-size:12px}.ou-yeah-course-data-selection-actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end}.ou-yeah-course-data-link{border:0;background:transparent;color:#405fc2;font:600 12px/1 SpaceGrotesk,system-ui,sans-serif;cursor:pointer;padding:4px}.ou-yeah-course-data-link:hover{text-decoration:underline}
      #${ROOT_ID} [hidden]{display:none !important}.ou-yeah-course-data-groups{padding:0 30px 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ou-yeah-course-data-groups label{display:flex;align-items:center;gap:12px;border:1px solid #dfe4ee;border-radius:13px;padding:11px 14px;cursor:pointer;min-width:0}.ou-yeah-course-data-groups label:has(input:checked){border-color:#9aacec;background:#f3f6ff;box-shadow:0 0 0 1px rgba(82,105,199,.08)}.ou-yeah-course-data-groups input,.ou-yeah-course-data-material-options input{accent-color:#405fc2;width:17px;height:17px;flex:0 0 auto}.ou-yeah-course-data-groups label>span{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0;flex:1}.ou-yeah-course-data-groups strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ou-yeah-course-data-groups small{color:#7b8394;font-size:11px;white-space:nowrap}.ou-yeah-course-data-material-options{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.ou-yeah-course-data-material-options label{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:0;background:transparent;padding:0;box-shadow:none;color:#4f5970;font-size:12px;cursor:pointer}.ou-yeah-course-data-material-options label:has(input:checked){border:0;background:transparent;box-shadow:none;color:#304ea9}.ou-yeah-course-data-material-options small{color:#7b8394}.ou-yeah-course-data-material-options input:disabled{opacity:.4}.ou-yeah-course-data-material-options label:has(input:disabled){cursor:not-allowed;opacity:.6}
      .ou-yeah-course-data-dialog>footer,.ou-yeah-course-data-panel>footer{display:flex;justify-content:flex-end;gap:9px;padding:16px 22px;border-top:1px solid #e7eaf1}
      .ou-yeah-course-data-secondary,.ou-yeah-course-data-danger{border:1px solid #d8deea;border-radius:10px;background:#fff;color:#40506b;padding:9px 13px;font-weight:600;cursor:pointer}.ou-yeah-course-data-danger{color:#a34047;border-color:#ecc8cb}.ou-yeah-course-data-primary:disabled{opacity:.45;cursor:not-allowed}
      .ou-yeah-course-data-panel{position:fixed;left:18px;bottom:20px;width:min(480px,calc(100vw - 36px));background:#fff;border:1px solid #dfe4ef;border-radius:18px;box-shadow:0 18px 44px rgba(24,35,62,.18);overflow:hidden}.ou-yeah-course-data-panel>header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px}.ou-yeah-course-data-panel>header strong{display:block;margin-top:4px;font-size:17px}.ou-yeah-course-data-panel-body{padding:0 20px 16px}.ou-yeah-course-data-panel-body p{color:#677084;margin:0 0 12px}.ou-yeah-course-data-metrics{display:flex;gap:12px;flex-wrap:wrap;color:#7a8292;font-size:12px}.ou-yeah-course-data-progress{height:4px;background:#edf0f6;margin:16px -20px -16px}.ou-yeah-course-data-progress span{display:block;width:var(--ou-data-progress);height:100%;background:#5269c7;transition:width .3s ease}.ou-yeah-course-data-panel[data-state=complete] .ou-yeah-course-data-progress span{background:#3c9d70}.ou-yeah-course-data-panel details{margin-top:16px;color:#a34047;font-size:12px}.ou-yeah-course-data-panel ul{max-height:110px;overflow:auto;padding-left:18px}
      .ou-yeah-course-data-delegated-note{align-self:center;color:#697287;font-size:12px;font-weight:600;margin-right:auto}
      .ou-yeah-course-data-reopen{position:fixed;left:18px;bottom:20px;display:flex;align-items:center;gap:8px;border:1px solid #405fc2;border-radius:999px;background:#405fc2;color:#fff;padding:11px 15px;box-shadow:0 12px 30px rgba(24,35,62,.22);cursor:pointer}
      .ou-yeah-course-data-panel{right:22px;left:auto;bottom:22px;width:min(440px,calc(100vw - 32px));border-radius:16px;box-shadow:0 18px 54px rgba(25,35,61,.2)}.ou-yeah-course-data-reopen{right:78px;left:auto;bottom:24px}
       @media(max-width:680px){.ou-yeah-course-data-groups{grid-template-columns:1fr}.ou-yeah-course-data-dialog{max-height:calc(100vh - 18px)}.ou-yeah-course-data-dialog>header,.ou-yeah-course-data-selection-head,.ou-yeah-course-data-groups{padding-left:18px;padding-right:18px}.ou-yeah-course-data-selection-actions,.ou-yeah-course-data-material-options{justify-content:flex-start}}
    `
    style.textContent += `
      .ou-yeah-course-data-dialog{overflow-y:auto}
      .ou-yeah-course-data-dialog>header{align-items:flex-start}
      .ou-yeah-course-data-header-metrics{display:flex;align-items:center;gap:14px;margin-left:auto;margin-right:4px;padding-top:3px;color:#7b8394}
      .ou-yeah-course-data-header-metrics span{display:flex;align-items:baseline;gap:4px;white-space:nowrap}
      .ou-yeah-course-data-header-metrics strong{color:#202638;font-size:15px}
      .ou-yeah-course-data-header-metrics small{font-size:10px}
      .ou-yeah-course-data-groups{max-height:none;overflow:visible}
      .ou-yeah-course-data-material-scope{grid-column:auto;border:1px solid #dfe4ee;border-radius:13px;padding:11px 14px;background:#fbfcff}
      .ou-yeah-course-data-material-scope>label{border:0!important;padding:0!important;background:transparent!important;box-shadow:none!important}
      .ou-yeah-course-data-groups{align-items:stretch}
      .ou-yeah-course-data-material-scope{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(0,2fr);align-items:center;gap:12px}
      .ou-yeah-course-data-material-scope>label{min-width:0}
      .ou-yeah-course-data-material-scope .ou-yeah-course-data-material-options{margin:0;min-width:0;justify-content:flex-start}
      @media(max-width:680px){.ou-yeah-course-data-dialog>header{padding-left:18px;padding-right:18px}.ou-yeah-course-data-header-metrics{gap:8px;flex-wrap:wrap;justify-content:flex-end}.ou-yeah-course-data-material-scope{grid-template-columns:1fr}.ou-yeah-course-data-material-scope .ou-yeah-course-data-material-options{margin:0}}
    `
    document.documentElement.appendChild(style)
  }

  function renderPackageReadme(context, snapshot) {
    return `# Thư mục dữ liệu khóa học cho AI\n\nCác file trong thư mục này được tạo bởi OU Yeah! theo schema \`${FORMAT}\`. Không cần giải nén để đọc.\n\n## Bắt đầu\n\n- \`course-context.md\`: tóm tắt dễ đọc và chỉ dẫn cho AI agent.\n- \`course-index.json\`: danh mục có cấu trúc của toàn bộ thực thể.\n- \`access-report.json\`: mục truy cập được, bị khóa, bỏ qua hoặc lỗi.\n- \`snapshots/changes.json\`: thay đổi so với lần xuất gần nhất trên máy này.\n- \`FILE-TREE.txt\`: cây file trong \`00-AI/\`; đọc \`../AGENTS.md\` để biết quy tắc của khóa học.\n\n## Cấu trúc\n\n- \`00-course/\`: tổng quan, đề cương, lịch trình.\n- \`01-content/\`: trang nội dung và tài nguyên chung.\n- \`02-forums/\`: thông báo, thảo luận, Video Conference cùng ảnh/tệp đính kèm.\n- \`03-assignments/\`: đề bài, hướng dẫn và trạng thái bài nộp của tài khoản hiện tại.\n- \`04-assessments/\`: bài đánh giá và các lượt đã làm được phép xem lại.\n- \`05-learning/\`: điểm số của tài khoản hiện tại.\n- \`06-people/\`: danh sách thành viên nếu người dùng chủ động bật.\n- \`90-user-feed/\`: thông báo tài khoản, là nguồn phụ và có thể bị ELOLMS giới hạn số lượng.\n\n## Thay đổi\n\n- Mới: ${snapshot.changes.added.length}\n- Thay đổi: ${snapshot.changes.changed.length}\n- Không còn thấy: ${snapshot.changes.removed.length}\n\n## Quyền riêng tư và giới hạn\n\nThư mục có thể chứa nội dung lớp học, bài nộp, điểm cá nhân và thông tin thành viên. Hãy kiểm tra trước khi đưa lên dịch vụ AI hoặc chia sẻ. OU Yeah! không vượt qua điều kiện truy cập, không tự hoàn thành bài học và không lấy điểm/bài nộp của sinh viên khác.\n\nNguồn: ${context.course.sourceUrl}\n`
  }
})()
