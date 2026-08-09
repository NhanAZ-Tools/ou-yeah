(() => {
  "use strict"

  const APP = "OU Yeah!"
  const FORMAT_VERSION = "ou-yeah-quiz-bank-v2"
  const LEGACY_FORMAT_VERSION = "ou-yeah-quiz-bank-v1"
  const STYLE_ID = "ou-yeah-quiz-trainer-style"
  const PANEL_ID = "ou-yeah-quiz-trainer"
  const WORKER_FRAME_ID = "ou-yeah-quiz-worker"
  const REVIEW_FRAME_ID = "ou-yeah-quiz-review-reader"
  const STORAGE_PREFIX = "ouYeahQuizTrainer:"
  const QUIZ_MODE_PRACTICE = "practice"
  const QUIZ_MODE_COMPLETED_REVIEW = "completed-review"
  const NO_NEW_QUESTION_STREAK_LIMIT = 3
  const MAX_ATTEMPTS = 50
  const PAGE_ACTION_DELAY = 520
  const IS_TOP_FRAME = window.top === window.self
  const IS_ELOLMS_QUIZ = location.hostname === "elolms.ou.edu.vn"
    && /^\/mod\/quiz\/(?:view|attempt|summary|review)\.php$/i.test(location.pathname)

  if (!IS_TOP_FRAME || !IS_ELOLMS_QUIZ) return

  let pageAutomationStarted = false
  let latestState = null
  let quizWorkerFrame = null
  let quizWorkerToken = 0
  let navigationGuardEnabled = false
  let plannedMainNavigation = false

  injectTheme()
  initializeQuizTrainer().catch(handleUnexpectedError)
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return
    pageAutomationStarted = false
    initializeQuizTrainer().catch(handleUnexpectedError)
  })

  async function initializeQuizTrainer() {
    const quizId = getQuizId()
    if (!quizId) return

    latestState = await loadState(quizId)
    const detectedMode = detectQuizMode()
    if (!latestState && !detectedMode) return
    const effectiveMode = latestState?.quizMode || detectedMode
    if (effectiveMode === QUIZ_MODE_COMPLETED_REVIEW && !isQuizViewPage() && !isQuizReviewPage()) return
    if (effectiveMode === QUIZ_MODE_COMPLETED_REVIEW) {
      latestState = syncCompletedReviewState(quizId, latestState)
      await saveState(latestState)
    }
    if (latestState?.status === "exporting") {
      latestState.status = "error"
      latestState.message = "Lần đóng gói trước đã bị gián đoạn. Bạn có thể tải lại phần bộ đề đã gom."
      latestState.warnings = [...new Set([
        ...(latestState.warnings || []),
        "Quá trình tạo ZIP bị gián đoạn do trang được tải lại hoặc đóng trước khi hoàn tất."
      ])]
      latestState.updatedAt = new Date().toISOString()
      await saveState(latestState)
    }
    mountPanel(quizId, latestState)

    if (latestState?.quizMode === QUIZ_MODE_PRACTICE && latestState.status === "running") {
      window.setTimeout(() => {
        runCurrentPage(latestState).catch(handleAutomationError)
      }, PAGE_ACTION_DELAY)
    }
  }

  function mountPanel(quizId, state) {
    if (document.getElementById(PANEL_ID)) {
      renderPanel(state)
      return
    }

    const main = document.querySelector("[role='main']")
    if (!(main instanceof HTMLElement)) return

    const panel = document.createElement("section")
    panel.id = PANEL_ID
    panel.className = "ou-yeah-quiz-trainer"
    panel.setAttribute("aria-label", "OU Yeah! Quiz Lab")
    panel.innerHTML = `
      <div class="ou-yeah-quiz-trainer-main">
        <span class="ou-yeah-quiz-trainer-icon" aria-hidden="true"></span>
        <div class="ou-yeah-quiz-trainer-copy">
          <span class="ou-yeah-quiz-trainer-kicker">OU Yeah! Quiz Lab</span>
          <strong class="ou-yeah-quiz-trainer-title">Quét đến khi bộ đề ổn định</strong>
          <span class="ou-yeah-quiz-trainer-status" data-ou-quiz-status>Tự dừng sau ${NO_NEW_QUESTION_STREAK_LIMIT} lượt liên tiếp không có câu mới.</span>
        </div>
        <div class="ou-yeah-quiz-trainer-actions">
          <button type="button" class="ou-yeah-quiz-trainer-export" data-ou-quiz-export hidden>Tải bộ đề</button>
          <button type="button" class="ou-yeah-quiz-trainer-action" data-ou-quiz-action>
            Bắt đầu quét bộ đề
          </button>
        </div>
      </div>
      <div class="ou-yeah-quiz-trainer-guard" data-ou-quiz-guard hidden></div>
      <div class="ou-yeah-quiz-trainer-progress" aria-hidden="true">
        <span class="ou-yeah-quiz-trainer-progress-fill"></span>
      </div>
      <div class="ou-yeah-quiz-trainer-meta">
        <span data-ou-quiz-count>0 lượt · 0 câu · 0/${NO_NEW_QUESTION_STREAK_LIMIT} lượt ổn định</span>
      </div>
    `

    const action = panel.querySelector("[data-ou-quiz-action]")
    action?.addEventListener("click", () => {
      handleQuizAction(quizId).catch(handleAutomationError)
    })

    const exportButton = panel.querySelector("[data-ou-quiz-export]")
    exportButton?.addEventListener("click", () => {
      exportStoredQuizBank(quizId).catch(handleAutomationError)
    })

    main.insertBefore(panel, main.firstChild)
    renderPanel(state)
  }

  async function handleQuizAction(quizId) {
    const state = await loadState(quizId)
    if (state?.quizMode === QUIZ_MODE_COMPLETED_REVIEW || looksLikeCompletedChapterQuiz()) {
      await exportCompletedChapterQuiz(quizId)
      return
    }
    await toggleQuizTrainer(quizId)
  }

  async function toggleQuizTrainer(quizId) {
    const state = await loadState(quizId)
    if (state?.status === "running") {
      stopQuizWorker()
      pageAutomationStarted = false
      state.status = "stopped"
      state.message = `Đã tạm dừng sau ${state.completedAttempts} lượt · ${state.questions.length} câu. Tiến trình đã được giữ lại.`
      state.updatedAt = new Date().toISOString()
      await saveState(state)
      latestState = state
      renderPanel(state)
      return
    }

    const nextState = state && ["stopped", "error", "complete"].includes(state.status)
      ? resumeQuizTrainerState(state)
      : createInitialState(quizId)
    pageAutomationStarted = false
    await saveState(nextState)
    latestState = nextState
    renderPanel(nextState)

    if (isQuizViewPage()) {
      await runCurrentPage(nextState)
    } else {
      navigateMainPage(nextState.viewUrl)
    }
  }

  function resumeQuizTrainerState(state) {
    const previousStatus = state.status
    const isSupplementalScan = previousStatus === "complete"
    state.status = "running"
    state.stopReason = ""
    if (isSupplementalScan) {
      state.noNewQuestionStreak = 0
      state.lastAttemptNewQuestions = 0
      state.maxAttempts = Math.max(Number(state.maxAttempts) || 0, state.completedAttempts + MAX_ATTEMPTS)
    }
    state.message = isSupplementalScan
      ? `Đang chuẩn bị quét bổ sung từ ${state.questions.length} câu hiện có...`
      : `Đang tiếp tục từ lượt ${state.completedAttempts + 1} · giữ nguyên ${state.questions.length} câu đã gom...`
    state.updatedAt = new Date().toISOString()
    return state
  }

  function createInitialState(quizId) {
    const quizTitle = cleanText(document.querySelector(".page-header-headings h1, header h1, [role='main'] h1")?.textContent)
      || document.title.replace(/\s*\|.*$/, "").trim()
      || "Bộ câu hỏi ELOLMS"
    const courseCode = cleanText(document.querySelector(".page-header-headings h6, header h6")?.textContent)
    const now = new Date().toISOString()

    return {
      format: FORMAT_VERSION,
      quizId,
      quizMode: QUIZ_MODE_PRACTICE,
      quizTitle,
      courseCode,
      viewUrl: `${location.origin}/mod/quiz/view.php?id=${encodeURIComponent(quizId)}`,
      executionMode: "iframe",
      maxAttempts: MAX_ATTEMPTS,
      completedAttempts: 0,
      noNewQuestionStreak: 0,
      lastAttemptNewQuestions: 0,
      stopReason: "",
      status: "running",
      message: "Đang chuẩn bị lượt 1...",
      questions: [],
      processedAttemptIds: [],
      warnings: [],
      startedAt: now,
      updatedAt: now
    }
  }

  function syncCompletedReviewState(quizId, storedState) {
    const reviewUrls = getCompletedReviewUrls(quizId)
    const state = storedState?.quizMode === QUIZ_MODE_COMPLETED_REVIEW
      ? normalizeState(storedState)
      : createInitialState(quizId)
    const processed = new Set(state.processedAttemptIds || [])
    const pendingReviews = reviewUrls.filter((url) => !processed.has(getAttemptIdFromReviewUrl(url)))

    state.quizMode = QUIZ_MODE_COMPLETED_REVIEW
    state.executionMode = "review-reader"
    state.availableReviewUrls = reviewUrls
    state.maxAttempts = reviewUrls.length
    state.noNewQuestionStreak = 0
    state.lastAttemptNewQuestions = 0

    if (!reviewUrls.length) {
      state.status = "locked"
      state.message = hasCompletedAttemptEvidence()
        ? "ELOLMS đã ghi nhận lượt hoàn thành nhưng hiện không cho xem lại câu hỏi và đáp án."
        : "Hãy hoàn thành và nộp lượt đầu tiên; nút tải sẽ mở khi ELOLMS có trang Xem lại."
    } else if (state.questions.length && !pendingReviews.length) {
      state.status = "complete"
      state.stopReason = "completed-reviews"
      state.message = `Đã có bộ đề từ ${state.completedAttempts} lượt hoàn thành · ${state.questions.length} câu.`
    } else {
      state.status = "ready"
      state.message = `Đã tìm thấy ${reviewUrls.length} lượt hoàn thành có thể xem lại. Sẵn sàng tải câu hỏi và đáp án.`
    }
    state.updatedAt = new Date().toISOString()
    return state
  }

  async function exportCompletedChapterQuiz(quizId) {
    let state = syncCompletedReviewState(quizId, await loadState(quizId))
    const reviewUrls = state.availableReviewUrls || []
    if (!reviewUrls.length) {
      await persistAndRender(state)
      throw new Error("Chỉ tải được sau khi bạn hoàn thành, nộp lượt đầu tiên và ELOLMS cho phép Xem lại.")
    }

    state.status = "exporting"
    state.message = `Đang đọc ${reviewUrls.length} lượt đã hoàn thành · không tạo hoặc nộp lượt làm bài mới...`
    await persistAndRender(state)

    for (let index = 0; index < reviewUrls.length; index += 1) {
      const review = await readCompletedReviewPage(reviewUrls[index], quizId)
      mergeQuestionBank(state, review.questions)
      if (!state.processedAttemptIds.includes(review.attemptId)) {
        state.processedAttemptIds.push(review.attemptId)
      }
      state.completedAttempts = state.processedAttemptIds.length
      state.message = `Đã đọc ${index + 1}/${reviewUrls.length} lượt hoàn thành · gom được ${state.questions.length} câu...`
      await persistAndRender(state)
    }

    state.stopReason = "completed-reviews"
    state.status = "exporting"
    state.message = `Đang tạo ZIP gồm ${state.questions.length} câu từ ${state.completedAttempts} lượt đã hoàn thành...`
    await persistAndRender(state)
    await exportQuizBank(state)

    state.status = "complete"
    state.message = `Đã tải bộ đề gồm ${state.questions.length} câu từ ${state.completedAttempts} lượt đã hoàn thành.`
    await persistAndRender(state)
  }

  function readCompletedReviewPage(reviewUrl, quizId) {
    return new Promise((resolve, reject) => {
      const validatedUrl = validateCompletedReviewUrl(reviewUrl, quizId)
      if (!validatedUrl) {
        reject(new Error("Đường dẫn Xem lại không hợp lệ hoặc không thuộc bài kiểm tra hiện tại."))
        return
      }

      document.getElementById(REVIEW_FRAME_ID)?.remove()
      const frame = document.createElement("iframe")
      frame.id = REVIEW_FRAME_ID
      frame.title = "OU Yeah! completed quiz review reader"
      frame.tabIndex = -1
      frame.setAttribute("aria-hidden", "true")
      frame.style.cssText = "position:fixed;width:1280px;height:900px;left:-20000px;top:0;opacity:.001;pointer-events:none;border:0;z-index:-2147483648;"

      let settled = false
      const finish = (callback) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutId)
        frame.remove()
        callback()
      }
      const timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error("Trang Xem lại tải quá lâu. Hãy kiểm tra phiên đăng nhập rồi thử lại.")))
      }, 15_000)

      frame.addEventListener("load", () => {
        try {
          const frameWindow = frame.contentWindow
          const frameDocument = frame.contentDocument
          if (!frameWindow || !frameDocument) throw new Error("Không truy cập được trang Xem lại của ELOLMS.")
          const loadedUrl = new URL(frameWindow.location.href)
          if (loadedUrl.origin !== location.origin || /\/login(?:\/|\.php|$)/i.test(loadedUrl.pathname)) {
            throw new Error("Phiên đăng nhập ELOLMS đã hết hạn. Hãy đăng nhập lại rồi thử tải.")
          }
          if (!/^\/mod\/quiz\/review\.php$/i.test(loadedUrl.pathname)) {
            throw new Error("ELOLMS không mở trang Xem lại cho lượt đã chọn.")
          }

          const attemptId = loadedUrl.searchParams.get("attempt") || getAttemptIdFromReviewUrl(validatedUrl)
          const questionElements = Array.from(frameDocument.querySelectorAll(".que"))
          if (!questionElements.length) throw new Error("Trang Xem lại không có dữ liệu câu hỏi.")
          const questions = questionElements.map((question) => extractReviewedQuestion(question, attemptId))
          finish(() => resolve({ attemptId, questions }))
        } catch (error) {
          finish(() => reject(error))
        }
      }, { once: true })

      frame.src = validatedUrl
      document.body.appendChild(frame)
    })
  }

  async function runCurrentPage(state) {
    if (pageAutomationStarted || state.status !== "running") return
    pageAutomationStarted = true

    if (state.executionMode === "iframe") {
      if (!isQuizViewPage()) {
        navigateMainPage(state.viewUrl)
        return
      }
      startQuizWorker(state)
      return
    }

    if (isQuizViewPage()) {
      await runQuizViewPage(state)
      return
    }
    if (isQuizAttemptPage()) {
      await runQuizAttemptPage(state)
      return
    }
    if (isQuizSummaryPage()) {
      await runQuizSummaryPage(state)
      return
    }
    if (isQuizReviewPage()) {
      await runQuizReviewPage(state)
    }
  }

  function startQuizWorker(state) {
    stopQuizWorker()
    const token = quizWorkerToken
    const frame = document.createElement("iframe")
    frame.id = WORKER_FRAME_ID
    frame.title = "OU Yeah! Quiz Lab worker"
    frame.tabIndex = -1
    frame.setAttribute("aria-hidden", "true")
    frame.style.cssText = "position:fixed;width:1280px;height:900px;left:-20000px;top:0;opacity:.001;pointer-events:none;border:0;z-index:-2147483648;"
    frame.src = state.viewUrl
    frame.dataset.ouWorkerVersion = "0"
    frame.addEventListener("load", () => {
      const version = Number(frame.dataset.ouWorkerVersion || "0") + 1
      frame.dataset.ouWorkerVersion = String(version)
      handleQuizWorkerLoad(frame, state.quizId, token, version).catch(handleAutomationError)
    })
    quizWorkerFrame = frame
    document.body.appendChild(frame)

    state.message = "Đang quét trong nền · bạn có thể đổi tab và quay lại theo dõi bất cứ lúc nào."
    persistAndRender(state).catch(handleAutomationError)
  }

  function stopQuizWorker() {
    quizWorkerToken += 1
    quizWorkerFrame?.remove()
    quizWorkerFrame = null
  }

  function isCurrentQuizWorker(frame, token, version) {
    return quizWorkerFrame === frame
      && quizWorkerToken === token
      && frame.isConnected
      && Number(frame.dataset.ouWorkerVersion || "0") === version
  }

  async function handleQuizWorkerLoad(frame, quizId, token, version) {
    if (!isCurrentQuizWorker(frame, token, version)) return
    const workerWindow = frame.contentWindow
    const workerDocument = frame.contentDocument
    if (!workerWindow || !workerDocument) throw new Error("Không truy cập được trang chạy nền của ELOLMS.")

    let workerUrl
    try {
      workerUrl = new URL(workerWindow.location.href)
    } catch {
      throw new Error("ELOLMS đã chặn trang quiz chạy trong nền.")
    }
    if (workerUrl.origin !== location.origin) throw new Error("Trang chạy nền rời khỏi ELOLMS ngoài dự kiến.")
    if (/\/login(?:\/|\.php|$)/i.test(workerUrl.pathname) || workerDocument.querySelector("#login, form[action*='/login/index.php']")) {
      throw new Error("Phiên đăng nhập ELOLMS đã hết hạn. Hãy đăng nhập lại rồi bấm bắt đầu quét lại.")
    }

    const state = await loadState(quizId)
    if (!state || state.status !== "running") {
      stopQuizWorker()
      return
    }
    if (!isCurrentQuizWorker(frame, token, version)) return

    if (/\/mod\/quiz\/view\.php$/i.test(workerUrl.pathname)) {
      await runQuizWorkerViewPage(frame, workerDocument, state, token, version)
      return
    }
    if (/\/mod\/quiz\/attempt\.php$/i.test(workerUrl.pathname)) {
      await runQuizWorkerAttemptPage(frame, workerDocument, state, token, version)
      return
    }
    if (/\/mod\/quiz\/summary\.php$/i.test(workerUrl.pathname)) {
      await runQuizWorkerSummaryPage(frame, workerDocument, state, token, version)
      return
    }
    if (/\/mod\/quiz\/review\.php$/i.test(workerUrl.pathname)) {
      await runQuizWorkerReviewPage(frame, workerDocument, state, token, version)
      return
    }
    throw new Error(`Trang chạy nền chuyển đến đường dẫn không hỗ trợ: ${workerUrl.pathname}`)
  }

  async function runQuizWorkerViewPage(frame, workerDocument, state, token, version) {
    if (shouldComplete(state)) {
      stopQuizWorker()
      await completeRun(state)
      return
    }

    const activeAttempt = workerDocument.querySelector("a[href*='/mod/quiz/attempt.php?attempt=']")
    if (isTag(activeAttempt, "A")) {
      state.message = `Đang tiếp tục lượt ${state.completedAttempts + 1} trong nền...`
      await persistAndRender(state)
      if (isCurrentQuizWorker(frame, token, version)) frame.src = activeAttempt.href
      return
    }

    const startForms = Array.from(workerDocument.querySelectorAll("form[action*='/mod/quiz/startattempt.php']"))
    const startForm = startForms.find((form) => form.id !== "mod_quiz_preflight_form")
    const startButton = startForm?.querySelector("button[type='submit'], input[type='submit']")
    if (!isTag(startForm, "FORM") || !isDomElement(startButton)) {
      throw new Error("Quiz không còn nút bắt đầu/làm lại. Hãy kiểm tra giới hạn số lượt trên ELOLMS.")
    }

    state.message = `Đang mở lượt ${state.completedAttempts + 1} trong nền...`
    await persistAndRender(state)
    if (!isCurrentQuizWorker(frame, token, version)) return
    startButton.click()

    const startResult = await waitForElement(() => {
      if (!isCurrentQuizWorker(frame, token, version)) return { type: "navigation" }
      const form = workerDocument.querySelector("#mod_quiz_preflight_form")
      if (!isTag(form, "FORM") || !isVisible(form)) return null
      const button = form.querySelector("input[name='submitbutton'], button[type='submit']")
      return isDomElement(button) ? { type: "preflight", button } : null
    }, 8_000)

    if (startResult?.type === "navigation") return
    if (startResult?.type === "preflight") {
      startResult.button.click()
      return
    }

    const currentState = await loadState(state.quizId)
    if (currentState?.updatedAt && currentState.updatedAt !== state.updatedAt) return
    throw new Error("ELOLMS không phản hồi sau khi yêu cầu bắt đầu lượt làm bài trong nền.")
  }

  async function runQuizWorkerAttemptPage(frame, workerDocument, state, token, version) {
    const form = workerDocument.querySelector("#responseform")
    if (!isTag(form, "FORM")) throw new Error("Không tìm thấy biểu mẫu câu hỏi của ELOLMS trong trang chạy nền.")

    const selectedGroups = selectFirstAnswers(form)
    state.message = `Lượt ${state.completedAttempts + 1}: đã chọn phương án đầu tiên cho ${selectedGroups} nhóm đáp án trong nền.`
    await persistAndRender(state)
    if (!isCurrentQuizWorker(frame, token, version)) return

    const nextButton = form.querySelector("#mod_quiz-next-nav, input.mod_quiz-next-nav, button.mod_quiz-next-nav")
    if (!isDomElement(nextButton)) throw new Error("Không tìm thấy nút chuyển trang/hoàn tất lượt thi.")
    nextButton.click()
  }

  async function runQuizWorkerSummaryPage(frame, workerDocument, state, token, version) {
    state.message = `Lượt ${state.completedAttempts + 1}: đang nộp bài trong nền...`
    await persistAndRender(state)
    if (!isCurrentQuizWorker(frame, token, version)) return

    const submitButton = findVisibleButton(/^(?:Nộp bài và kết thúc|Submit all and finish)$/i, workerDocument)
    if (!isDomElement(submitButton)) throw new Error("Không tìm thấy nút nộp bài ở trang tổng quan.")
    submitButton.click()

    const submitResult = await waitForElement(() => {
      if (!isCurrentQuizWorker(frame, token, version)) return { type: "navigation" }
      const dialog = Array.from(workerDocument.querySelectorAll("[role='dialog'], .modal.show"))
        .find((element) => isDomElement(element) && isVisible(element))
      if (!isDomElement(dialog)) return null
      const button = findVisibleButton(/^(?:Nộp bài và kết thúc|Submit all and finish)$/i, dialog)
      return isDomElement(button) ? { type: "confirmation", button } : null
    }, 8_000)

    if (submitResult?.type === "navigation") return
    if (submitResult?.type === "confirmation") {
      submitResult.button.click()
      return
    }
    throw new Error("Không tìm thấy nút xác nhận nộp bài trong trang chạy nền.")
  }

  async function runQuizWorkerReviewPage(frame, workerDocument, state, token, version) {
    const questions = Array.from(workerDocument.querySelectorAll(".que"))
    if (!questions.length) throw new Error("Trang xem lại chạy nền không có dữ liệu câu hỏi.")

    const attemptId = new URL(frame.contentWindow.location.href).searchParams.get("attempt") || `unknown-${Date.now()}`
    processReviewedQuestions(state, questions, attemptId)

    if (state.noNewQuestionStreak >= NO_NEW_QUESTION_STREAK_LIMIT) {
      state.stopReason = "stable"
    } else if (state.completedAttempts >= state.maxAttempts) {
      state.stopReason = "safety-limit"
    }

    if (shouldComplete(state)) {
      stopQuizWorker()
      await completeRun(state)
      return
    }

    const discovery = state.lastAttemptNewQuestions > 0
      ? `thêm ${state.lastAttemptNewQuestions} câu mới`
      : `không có câu mới (${state.noNewQuestionStreak}/${NO_NEW_QUESTION_STREAK_LIMIT})`
    state.message = `Lượt ${state.completedAttempts}: ${discovery} · đã gom ${state.questions.length} câu · tiếp tục chạy nền...`
    await persistAndRender(state)
    if (isCurrentQuizWorker(frame, token, version)) frame.src = state.viewUrl
  }

  async function runQuizViewPage(state) {
    if (shouldComplete(state)) {
      await completeRun(state)
      return
    }

    const activeAttempt = document.querySelector("a[href*='/mod/quiz/attempt.php?attempt=']")
    if (activeAttempt instanceof HTMLAnchorElement) {
      state.message = `Đang tiếp tục lượt ${state.completedAttempts + 1}...`
      await persistAndRender(state)
      location.assign(activeAttempt.href)
      return
    }

    const startForms = Array.from(document.querySelectorAll("form[action*='/mod/quiz/startattempt.php']"))
    const startForm = startForms.find((form) => form.id !== "mod_quiz_preflight_form")
    const startButton = startForm?.querySelector("button[type='submit'], input[type='submit']")
    if (!(startButton instanceof HTMLElement)) {
      throw new Error("Quiz không còn nút bắt đầu/làm lại. Hãy kiểm tra giới hạn số lượt trên ELOLMS.")
    }

    state.message = `Đang mở lượt ${state.completedAttempts + 1}...`
    await persistAndRender(state)
    let pageWasHidden = false
    const markPageHidden = () => {
      pageWasHidden = true
    }
    window.addEventListener("pagehide", markPageHidden, { once: true })
    startButton.click()

    const startResult = await waitForElement(() => {
      if (pageWasHidden || document.visibilityState === "hidden" || !startButton.isConnected || !isQuizViewPage()) {
        return { type: "navigation" }
      }
      const form = document.querySelector("#mod_quiz_preflight_form")
      if (!(form instanceof HTMLFormElement) || !isVisible(form)) return null
      const button = form.querySelector("input[name='submitbutton'], button[type='submit']")
      return button instanceof HTMLElement ? { type: "preflight", button } : null
    }, 8_000)
    window.removeEventListener("pagehide", markPageHidden)

    if (startResult?.type === "navigation") return
    if (startResult?.type === "preflight") {
      startResult.button.click()
      return
    }

    const currentState = await loadState(state.quizId)
    const anotherPageAdvanced = currentState?.updatedAt && currentState.updatedAt !== state.updatedAt
    if (anotherPageAdvanced || document.visibilityState !== "visible" || !startForm.isConnected) return

    throw new Error("ELOLMS không phản hồi sau khi yêu cầu bắt đầu lượt làm bài.")
  }

  async function runQuizAttemptPage(state) {
    const form = await waitForElement(() => document.querySelector("#responseform"), 8_000)
    if (!(form instanceof HTMLFormElement)) throw new Error("Không tìm thấy biểu mẫu câu hỏi của ELOLMS.")

    const selectedGroups = selectFirstAnswers(form)
    state.message = `Lượt ${state.completedAttempts + 1}: đã chọn phương án đầu tiên cho ${selectedGroups} nhóm đáp án.`
    await persistAndRender(state)
    await delay(260)

    const nextButton = form.querySelector("#mod_quiz-next-nav, input.mod_quiz-next-nav, button.mod_quiz-next-nav")
    if (!(nextButton instanceof HTMLElement)) throw new Error("Không tìm thấy nút chuyển trang/hoàn tất lượt thi.")
    nextButton.click()
  }

  function selectFirstAnswers(form) {
    let selectedGroups = 0
    const radioGroups = new Map()

    form.querySelectorAll(".que input[type='radio']:not([disabled])").forEach((radio) => {
      if (!isTag(radio, "INPUT") || radio.value === "-1" || !radio.name) return
      if (!radioGroups.has(radio.name)) radioGroups.set(radio.name, radio)
    })

    radioGroups.forEach((radio) => {
      radio.click()
      selectedGroups += 1
    })

    form.querySelectorAll(".que select:not([disabled])").forEach((select) => {
      if (!isTag(select, "SELECT")) return
      const option = Array.from(select.options).find((item) => !item.disabled && item.value !== "" && item.value !== "0")
      if (!option) return
      select.value = option.value
      dispatchFormEvent(select, "input")
      dispatchFormEvent(select, "change")
      selectedGroups += 1
    })

    form.querySelectorAll(".que input[type='checkbox']:not([disabled])").forEach((checkbox) => {
      if (!isTag(checkbox, "INPUT") || checkbox.checked) return
      checkbox.click()
      selectedGroups += 1
    })

    return selectedGroups
  }

  async function runQuizSummaryPage(state) {
    state.message = `Lượt ${state.completedAttempts + 1}: đang nộp bài...`
    await persistAndRender(state)

    const submitButton = findVisibleButton(/^(?:Nộp bài và kết thúc|Submit all and finish)$/i, document)
    if (!(submitButton instanceof HTMLElement)) throw new Error("Không tìm thấy nút nộp bài ở trang tổng quan.")
    submitButton.click()

    const confirmButton = await waitForElement(() => {
      const dialog = Array.from(document.querySelectorAll("[role='dialog'], .modal.show"))
        .find((element) => element instanceof HTMLElement && isVisible(element))
      if (!(dialog instanceof HTMLElement)) return null
      return findVisibleButton(/^(?:Nộp bài và kết thúc|Submit all and finish)$/i, dialog)
    }, 8_000)

    if (!(confirmButton instanceof HTMLElement)) throw new Error("Không tìm thấy nút xác nhận nộp bài.")
    confirmButton.click()
  }

  async function runQuizReviewPage(state) {
    const questions = await waitForQuestions()
    if (!questions.length) throw new Error("Trang xem lại không có dữ liệu câu hỏi.")

    const attemptId = new URL(location.href).searchParams.get("attempt") || `unknown-${Date.now()}`
    processReviewedQuestions(state, questions, attemptId)

    if (state.noNewQuestionStreak >= NO_NEW_QUESTION_STREAK_LIMIT) {
      state.stopReason = "stable"
    } else if (state.completedAttempts >= state.maxAttempts) {
      state.stopReason = "safety-limit"
    }

    if (shouldComplete(state)) {
      await completeRun(state)
      return
    }

    const discovery = state.lastAttemptNewQuestions > 0
      ? `thêm ${state.lastAttemptNewQuestions} câu mới`
      : `không có câu mới (${state.noNewQuestionStreak}/${NO_NEW_QUESTION_STREAK_LIMIT})`
    state.message = `Lượt ${state.completedAttempts}: ${discovery} · đã gom ${state.questions.length} câu · chuẩn bị lượt ${state.completedAttempts + 1}...`
    await persistAndRender(state)
    await delay(520)
    location.assign(state.viewUrl)
  }

  async function completeRun(state) {
    stopQuizWorker()
    pageAutomationStarted = false
    if (!state.stopReason) {
      state.stopReason = state.completedAttempts >= state.maxAttempts ? "safety-limit" : "stable"
    }
    const reason = state.stopReason === "safety-limit"
      ? `đã chạm trần an toàn ${state.maxAttempts} lượt`
      : `${NO_NEW_QUESTION_STREAK_LIMIT} lượt liên tiếp không có câu mới`
    state.status = "exporting"
    state.message = `Đã quét xong sau ${state.completedAttempts} lượt (${reason}) · đang tạo ZIP gồm ${state.questions.length} câu...`
    state.updatedAt = new Date().toISOString()
    await saveState(state)
    latestState = state
    renderPanel(state)

    await exportQuizBank(state)
    state.status = "complete"
    state.message = `Đã tải bộ ôn tập gồm ${state.questions.length} câu.`
    state.updatedAt = new Date().toISOString()
    await saveState(state)
    latestState = state
    renderPanel(state)
  }

  function shouldComplete(state) {
    return state.noNewQuestionStreak >= NO_NEW_QUESTION_STREAK_LIMIT
      || state.completedAttempts >= state.maxAttempts
  }

  async function exportStoredQuizBank(quizId) {
    const state = await loadState(quizId)
    if (!state?.questions?.length) throw new Error("Chưa có bộ câu hỏi để tải.")
    state.status = "exporting"
    state.message = `Đang tạo lại ZIP gồm ${state.questions.length} câu · vui lòng chờ...`
    await persistAndRender(state)
    await exportQuizBank(state)
    state.status = "complete"
    state.message = `Đã tải lại bộ ôn tập gồm ${state.questions.length} câu.`
    await persistAndRender(state)
  }

  async function exportQuizBank(state) {
    const assetResult = await downloadQuestionAssets(state.questions)
    const exportedAt = new Date().toISOString()
    const publicData = createPublicData(state, assetResult.assetPaths, exportedAt)
    const markdown = renderQuizMarkdown(publicData)
    const readme = renderBundleReadme(publicData)
    const files = [
      textZipFile("README.md", readme),
      textZipFile("quiz-bank.md", markdown),
      textZipFile("quiz-bank.json", `${JSON.stringify(publicData, null, 2)}\n`),
      ...assetResult.files
    ]
    const zipBlob = createZipBlob(files)
    const filename = `${slugify(state.courseCode || state.quizTitle)}-${slugify(state.quizTitle)}-quiz-bank.zip`
    downloadBlob(zipBlob, filename || "ou-yeah-quiz-bank.zip")
  }

  async function downloadQuestionAssets(questions) {
    const references = []
    const seen = new Set()

    questions.forEach((question, questionIndex) => {
      (question.images || []).forEach((image, imageIndex) => {
        if (!image.sourceUrl || seen.has(image.sourceUrl)) return
        seen.add(image.sourceUrl)
        references.push({ questionIndex, imageIndex, image })
      })
    })

    const files = []
    const assetPaths = {}
    let cursor = 0
    const workerCount = Math.min(3, references.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < references.length) {
        const reference = references[cursor]
        cursor += 1
        try {
          const response = await fetch(reference.image.sourceUrl, { credentials: "include", redirect: "follow" })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase()
          if (!contentType.startsWith("image/")) throw new Error("Phản hồi không phải ảnh")
          const extension = imageExtension(contentType, reference.image.sourceUrl)
          const path = `images/question-${pad(reference.questionIndex + 1)}-${pad(reference.imageIndex + 1)}.${extension}`
          files.push({ name: path, data: new Uint8Array(await response.arrayBuffer()) })
          assetPaths[reference.image.sourceUrl] = path
        } catch (error) {
          assetPaths[reference.image.sourceUrl] = ""
          console.warn(`${APP}: không tải được ảnh câu hỏi`, reference.image.sourceUrl, error)
        }
      }
    })
    await Promise.all(workers)
    return { files, assetPaths }
  }

  function extractReviewedQuestion(question, attemptId) {
    const questionText = extractQuestionText(question)
    const options = extractAnswerOptions(question)
    const correctAnswer = extractCorrectAnswer(question, options)
    const images = extractQuestionImages(question)
    const type = Array.from(question.classList)
      .find((className) => !["que", "deferredfeedback", "correct", "incorrect", "notanswered"].includes(className)) || "unknown"
    const fingerprint = canonicalQuestionId(questionText, options, images)

    return {
      id: fingerprint,
      type,
      question: questionText || `Câu hỏi ${fingerprint}`,
      options,
      correctAnswer,
      images,
      attempts: [attemptId],
      firstSeenAt: new Date().toISOString()
    }
  }

  function extractQuestionText(question) {
    const qtext = question.querySelector(".qtext")
    if (qtext) return cleanText(qtext.textContent)

    const formulation = question.querySelector(".formulation")
    if (!isDomElement(formulation)) return ""
    const clone = formulation.cloneNode(true)
    if (!isDomElement(clone)) return ""
    clone.querySelectorAll(".answer, .outcome, .feedback, .specificfeedback, .rightanswer, h4.accesshide, input, button")
      .forEach((element) => element.remove())
    return cleanText(clone.textContent)
  }

  function extractAnswerOptions(question) {
    const answer = question.querySelector(".answer")
    if (!isDomElement(answer)) return []
    const rows = Array.from(answer.querySelectorAll(":scope > .r0, :scope > .r1, :scope > .form-check"))
    const candidates = rows.length ? rows : Array.from(answer.querySelectorAll("label"))

    return candidates.map((row, index) => {
      const label = row.matches("label") ? row : row.querySelector("label")
      const text = cleanText(label?.textContent || row.textContent)
      const container = row.matches("label") ? row.parentElement : row
      return {
        label: optionLabel(index),
        text: stripOptionPrefix(text),
        correct: Boolean(container?.classList.contains("correct") || container?.querySelector(":scope > .fa-check, :scope > [aria-label='Đúng'], :scope > [aria-label='Correct']"))
      }
    }).filter((option) => option.text)
  }

  function extractCorrectAnswer(question, options) {
    const feedbackBlocks = Array.from(question.querySelectorAll(".rightanswer, .outcome"))
    for (const block of feedbackBlocks) {
      const value = cleanText(block.textContent)
      const match = value.match(/(?:The correct answer is|Đáp án đúng(?: là)?)[\s:：-]*(.+)$/i)
      if (match?.[1]) return cleanText(match[1])
    }

    const correctOptions = options.filter((option) => option.correct).map((option) => `${option.label}. ${option.text}`)
    return correctOptions.join("; ")
  }

  function extractQuestionImages(question) {
    const images = []
    question.querySelectorAll(".qtext img, .formulation img, .answer img").forEach((image) => {
      if (!isTag(image, "IMG")) return
      const alt = cleanText(image.getAttribute("alt"))
      if (image.classList.contains("icon") || /^(?:đúng|sai|correct|incorrect)$/i.test(alt)) return
      const sourceUrl = absoluteUrl(image.getAttribute("src"), image.ownerDocument.baseURI)
      if (!sourceUrl) return
      images.push({ sourceUrl, alt: alt || "Ảnh trong câu hỏi" })
    })
    return dedupeBy(images, (image) => image.sourceUrl)
  }

  function processReviewedQuestions(state, questions, attemptId) {
    if (state.processedAttemptIds.includes(attemptId)) return false

    const extracted = questions.map((question) => extractReviewedQuestion(question, attemptId))
    const previousQuestionCount = state.questions.length
    mergeQuestionBank(state, extracted)
    const newQuestionCount = state.questions.length - previousQuestionCount
    state.processedAttemptIds.push(attemptId)
    state.completedAttempts = state.processedAttemptIds.length
    state.lastAttemptNewQuestions = newQuestionCount
    state.noNewQuestionStreak = newQuestionCount === 0
      ? state.noNewQuestionStreak + 1
      : 0
    return true
  }

  function mergeQuestionBank(state, extractedQuestions) {
    const byId = new Map(state.questions.map((question) => [question.id, question]))

    extractedQuestions.forEach((incoming) => {
      const current = byId.get(incoming.id)
      if (!current) {
        state.questions.push(incoming)
        byId.set(incoming.id, incoming)
        return
      }

      current.correctAnswer = incoming.correctAnswer || current.correctAnswer
      if ((!current.options || !current.options.length) && incoming.options.length) current.options = incoming.options
      current.images = dedupeBy([...(current.images || []), ...incoming.images], (image) => image.sourceUrl)
      current.attempts = [...new Set([...(current.attempts || []), ...incoming.attempts])]
    })
  }

  function canonicalQuestionId(questionText, options = [], images = []) {
    const optionKey = options
      .map((option) => normalizeForKey(option.text))
      .filter(Boolean)
      .sort()
      .join("|")
    const imageKey = images
      .map((image) => stableAssetKey(image.sourceUrl))
      .filter(Boolean)
      .sort()
      .join("|")
    return hashString(`${normalizeForKey(questionText)}|${optionKey}|${imageKey}`)
  }

  function stableAssetKey(value) {
    try {
      const url = new URL(value, location.href)
      return `${url.origin}${url.pathname}`
    } catch {
      return cleanText(value)
    }
  }

  function normalizeQuestionBank(questions) {
    const normalizedState = { questions: [] }
    questions.forEach((question) => {
      const normalizedQuestion = {
        ...question,
        id: canonicalQuestionId(question.question, question.options, question.images)
      }
      mergeQuestionBank(normalizedState, [normalizedQuestion])
    })
    return normalizedState.questions
  }

  function createPublicData(state, assetPaths, exportedAt) {
    const isCompletedReview = state.quizMode === QUIZ_MODE_COMPLETED_REVIEW
    return {
      format: FORMAT_VERSION,
      exportedAt,
      sourceUrl: state.viewUrl,
      quiz: {
        id: state.quizId,
        title: state.quizTitle,
        courseCode: state.courseCode
      },
      collection: {
        mode: state.quizMode || QUIZ_MODE_PRACTICE,
        completedAttempts: state.completedAttempts,
        uniqueQuestions: state.questions.length,
        noNewQuestionStreak: state.noNewQuestionStreak,
        stabilityThreshold: NO_NEW_QUESTION_STREAK_LIMIT,
        safetyLimit: state.maxAttempts,
        stopReason: state.stopReason,
        answerStrategy: isCompletedReview
          ? "Chỉ đọc câu hỏi, lựa chọn và đáp án từ các trang Xem lại của những lượt đã hoàn thành; không tạo, thay đổi hoặc nộp lượt làm bài mới."
          : `Chọn phương án đầu tiên cho mỗi nhóm đáp án; câu không hỗ trợ được để trống và đọc đáp án từ trang xem lại. Dừng khi ${NO_NEW_QUESTION_STREAK_LIMIT} lượt liên tiếp không có câu mới, tối đa ${state.maxAttempts} lượt.`
      },
      warnings: state.warnings || [],
      questions: state.questions.map((question, index) => ({
        number: index + 1,
        id: question.id,
        type: question.type,
        question: question.question,
        options: question.options || [],
        correctAnswer: question.correctAnswer || "Không tìm thấy đáp án đúng trên trang xem lại.",
        seenInAttempts: question.attempts || [],
        images: (question.images || []).map((image) => ({
          alt: image.alt,
          path: assetPaths[image.sourceUrl] || null,
          sourceUrl: image.sourceUrl
        }))
      }))
    }
  }

  function renderQuizMarkdown(data) {
    const isCompletedReview = data.collection.mode === QUIZ_MODE_COMPLETED_REVIEW
    const lines = [
      "---",
      `format: ${JSON.stringify(data.format)}`,
      `exported_at: ${JSON.stringify(data.exportedAt)}`,
      `source_url: ${JSON.stringify(data.sourceUrl)}`,
      `quiz_title: ${JSON.stringify(data.quiz.title)}`,
      `course_code: ${JSON.stringify(data.quiz.courseCode)}`,
      `collection_mode: ${JSON.stringify(data.collection.mode)}`,
      `completed_attempts: ${data.collection.completedAttempts}`,
      `unique_questions: ${data.collection.uniqueQuestions}`,
      `stop_reason: ${JSON.stringify(data.collection.stopReason)}`,
      "---",
      "",
      `# ${data.quiz.title}`,
      "",
      `- Môn học: ${data.quiz.courseCode || "Không rõ"}`,
      `- Lượt đã thu thập: ${data.collection.completedAttempts}`,
      `- Số câu duy nhất: ${data.collection.uniqueQuestions}`,
      isCompletedReview
        ? "- Cách thu thập: chỉ đọc các trang Xem lại của lượt đã hoàn thành; không tạo hoặc nộp lượt mới"
        : `- Điều kiện dừng: ${data.collection.noNewQuestionStreak}/${data.collection.stabilityThreshold} lượt liên tiếp không có câu mới (trần an toàn ${data.collection.safetyLimit} lượt)`,
      `- Nguồn: ${data.sourceUrl}`,
      "",
      "> Gói này được tạo để ôn tập cá nhân. Hãy tự kiểm tra lại đáp án quan trọng trên ELOLMS.",
      ""
    ]

    data.questions.forEach((question) => {
      lines.push(`## Câu ${question.number}`)
      lines.push("")
      lines.push(question.question)
      lines.push("")

      question.images.forEach((image) => {
        const target = image.path || image.sourceUrl
        lines.push(`![${escapeMarkdownText(image.alt)}](${escapeMarkdownUrl(target)})`)
        lines.push("")
      })

      if (question.options.length) {
        lines.push("### Lựa chọn")
        lines.push("")
        question.options.forEach((option) => lines.push(`- ${option.label}. ${option.text}`))
        lines.push("")
      }

      lines.push(`**Đáp án đúng:** ${question.correctAnswer}`)
      lines.push("")
      lines.push(`_Đã gặp trong ${question.seenInAttempts.length} lượt._`)
      lines.push("")
    })

    return `${lines.join("\n").trim()}\n`
  }

  function renderBundleReadme(data) {
    const collectionDescription = data.collection.mode === QUIZ_MODE_COMPLETED_REVIEW
      ? `được đọc từ ${data.collection.completedAttempts} lượt đã hoàn thành và cho phép Xem lại của quiz \`${data.quiz.title}\`; tiện ích không tạo hoặc nộp lượt mới`
      : `được tổng hợp từ ${data.collection.completedAttempts} lượt làm quiz \`${data.quiz.title}\``
    return `# Gói bộ đề OU Yeah!\n\n`
      + `Gói này chứa bộ câu hỏi ${collectionDescription}.\n\n`
      + `- \`quiz-bank.md\`: bản đọc nhanh và phù hợp để đưa vào AI.\n`
      + `- \`quiz-bank.json\`: dữ liệu có cấu trúc gồm câu hỏi, lựa chọn, đáp án đúng và lượt xuất hiện.\n`
      + `- \`images/\`: ảnh gốc xuất hiện trong câu hỏi hoặc lựa chọn; Markdown dùng đường dẫn tương đối đến thư mục này.\n\n`
      + `Dữ liệu chỉ phục vụ học tập cá nhân. Nội dung và đáp án có thể được giảng viên cập nhật; hãy đối chiếu ELOLMS khi cần độ chính xác cao.\n`
  }

  function renderPanel(state) {
    const panel = document.getElementById(PANEL_ID)
    if (!(panel instanceof HTMLElement)) return
    const action = panel.querySelector("[data-ou-quiz-action]")
    const title = panel.querySelector(".ou-yeah-quiz-trainer-title")
    const status = panel.querySelector("[data-ou-quiz-status]")
    const count = panel.querySelector("[data-ou-quiz-count]")
    const exportButton = panel.querySelector("[data-ou-quiz-export]")
    const guard = panel.querySelector("[data-ou-quiz-guard]")
    if (state?.quizMode === QUIZ_MODE_COMPLETED_REVIEW) {
      renderCompletedReviewPanel({ panel, action, title, status, count, exportButton, guard, state })
      return
    }
    const currentStatus = state?.status || "idle"
    const isRunning = currentStatus === "running"
    const isExporting = currentStatus === "exporting"
    const isBusy = isRunning || isExporting
    const completed = state?.completedAttempts || 0
    const questionCount = state?.questions?.length || 0
    const stableStreak = state?.noNewQuestionStreak || 0
    const percent = state?.status === "complete"
      ? 100
      : Math.max(0, Math.min(100, (stableStreak / NO_NEW_QUESTION_STREAK_LIMIT) * 100))

    panel.dataset.status = currentStatus
    panel.dataset.compact = currentStatus === "complete" ? "true" : "false"
    panel.style.setProperty("--ou-quiz-progress", `${percent}%`)
    if (title) {
      title.textContent = currentStatus === "complete"
        ? "Bộ đề đã sẵn sàng"
        : currentStatus === "exporting"
          ? "Đang tạo file bộ đề"
          : currentStatus === "error"
            ? "Quiz Lab cần bạn kiểm tra"
            : currentStatus === "stopped"
              ? "Đã tạm dừng quét bộ đề"
              : "Quét đến khi bộ đề ổn định"
    }
    if (status) status.textContent = state?.message || `Tự dừng sau ${NO_NEW_QUESTION_STREAK_LIMIT} lượt liên tiếp không có câu mới.`
    if (count) count.textContent = `${completed} lượt · ${questionCount} câu · ${stableStreak}/${NO_NEW_QUESTION_STREAK_LIMIT} lượt ổn định`
    if (guard instanceof HTMLElement) {
      guard.hidden = !isBusy
      guard.textContent = isExporting
        ? "Đang tạo và tải file ZIP. Hãy chờ đến khi Chrome nhận file; đừng reload, đóng tab hoặc rời trang."
        : "Đang quét trong nền. Bạn có thể đổi sang tab khác, nhưng hãy giữ tab này mở. Nếu cần reload, đóng tab hoặc rời trang, hãy bấm Tạm dừng trước."
    }
    if (action instanceof HTMLButtonElement) {
      action.textContent = isRunning
        ? "Tạm dừng"
        : isExporting
          ? "Đang đóng gói…"
          : currentStatus === "complete"
            ? "Quét bổ sung"
            : currentStatus === "stopped"
              ? "Tiếp tục quét"
              : currentStatus === "error"
                ? "Thử lại"
                : "Bắt đầu quét bộ đề"
      action.dataset.icon = isRunning
        ? "pause"
        : currentStatus === "stopped"
          ? "play"
          : "scan"
      action.disabled = isExporting
    }
    if (exportButton instanceof HTMLButtonElement) {
      exportButton.hidden = !state?.questions?.length || isBusy
      exportButton.textContent = currentStatus === "complete" ? "Tải bộ đề" : "Tải bộ đề hiện có"
      exportButton.dataset.icon = "download"
    }
    setNavigationGuard(isBusy)
  }

  function renderCompletedReviewPanel({ panel, action, title, status, count, exportButton, guard, state }) {
    const currentStatus = state.status || "locked"
    const isExporting = currentStatus === "exporting"
    const reviewCount = state.availableReviewUrls?.length || 0
    const questionCount = state.questions?.length || 0
    const titleByStatus = {
      locked: "Tải đề sau khi hoàn thành lượt đầu",
      ready: "Bộ đề đã làm sẵn sàng",
      exporting: "Đang đọc đề đã làm",
      complete: "Bộ đề đã sẵn sàng",
      error: "Quiz Lab cần bạn kiểm tra"
    }

    panel.dataset.status = currentStatus
    panel.dataset.compact = "false"
    panel.style.setProperty("--ou-quiz-progress", currentStatus === "complete" ? "100%" : "0%")
    if (title) title.textContent = titleByStatus[currentStatus] || titleByStatus.ready
    if (status) status.textContent = state.message
    if (count) count.textContent = `${reviewCount} lượt xem lại · ${questionCount} câu · chỉ đọc dữ liệu đã nộp`
    if (guard instanceof HTMLElement) {
      guard.hidden = !isExporting
      guard.textContent = "Đang đọc trang Xem lại và tạo file ZIP. Không reload, đóng tab hoặc rời trang cho đến khi Chrome nhận file."
    }
    if (action instanceof HTMLButtonElement) {
      action.textContent = currentStatus === "locked"
        ? "Hoàn thành lượt đầu để tải"
        : isExporting
          ? "Đang tạo bộ đề…"
          : currentStatus === "complete"
            ? "Tải lại bộ đề"
            : currentStatus === "error"
              ? "Thử tải lại"
              : "Tải đề đã làm"
      action.dataset.icon = isExporting ? "scan" : "download"
      action.disabled = currentStatus === "locked" || isExporting
    }
    if (exportButton instanceof HTMLButtonElement) exportButton.hidden = true
    setNavigationGuard(isExporting)
  }

  function setNavigationGuard(enabled) {
    if (navigationGuardEnabled === enabled) return
    navigationGuardEnabled = enabled
    if (enabled) window.addEventListener("beforeunload", warnBeforeLeavingQuiz)
    else window.removeEventListener("beforeunload", warnBeforeLeavingQuiz)
  }

  function warnBeforeLeavingQuiz(event) {
    if (!navigationGuardEnabled || plannedMainNavigation) return
    event.preventDefault()
    event.returnValue = ""
  }

  function navigateMainPage(url) {
    plannedMainNavigation = true
    setNavigationGuard(false)
    location.assign(url)
  }

  async function persistAndRender(state) {
    state.updatedAt = new Date().toISOString()
    await saveState(state)
    latestState = state
    renderPanel(state)
  }

  async function handleAutomationError(error) {
    stopQuizWorker()
    pageAutomationStarted = false
    const quizId = getQuizId()
    const storedState = quizId ? await loadState(quizId) : null
    const state = storedState || latestState
    const message = readableError(error)
    console.error(`${APP}: quiz trainer failed`, error)

    if (state?.status === "stopped") {
      latestState = state
      renderPanel(state)
      return
    }

    if (state) {
      state.status = "error"
      state.message = message
      state.warnings = [...new Set([...(state.warnings || []), message])]
      state.updatedAt = new Date().toISOString()
      await saveState(state)
      latestState = state
      renderPanel(state)
    }
  }

  function handleUnexpectedError(error) {
    handleAutomationError(error).catch((nestedError) => {
      console.error(`${APP}: cannot record quiz trainer error`, nestedError)
    })
  }

  async function waitForQuestions() {
    const result = await waitForElement(() => {
      const questions = Array.from(document.querySelectorAll(".que"))
      return questions.length ? questions : null
    }, 8_000)
    return Array.isArray(result) ? result : []
  }

  async function waitForElement(getter, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = getter()
      if (result) return result
      await delay(100)
    }
    return null
  }

  function findVisibleButton(pattern, root) {
    const elements = root.querySelectorAll("button, input[type='submit'], a.btn")
    return Array.from(elements).find((element) => {
      if (!isDomElement(element) || !isVisible(element)) return false
      const text = cleanText(isTag(element, "INPUT") ? element.value : element.textContent)
      return pattern.test(text)
    }) || null
  }

  function isVisible(element) {
    if (!isDomElement(element) || element.hidden) return false
    const ownerWindow = element.ownerDocument.defaultView
    if (!ownerWindow) return false
    const style = ownerWindow.getComputedStyle(element)
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0
  }

  function isDomElement(value) {
    return Boolean(value && value.nodeType === Node.ELEMENT_NODE && typeof value.tagName === "string")
  }

  function isTag(value, tagName) {
    return isDomElement(value) && value.tagName.toUpperCase() === tagName
  }

  function dispatchFormEvent(element, type) {
    const EventConstructor = element.ownerDocument.defaultView?.Event
    if (!EventConstructor) return
    element.dispatchEvent(new EventConstructor(type, { bubbles: true }))
  }

  function getQuizId() {
    const current = new URL(location.href)
    const direct = current.searchParams.get("id") || current.searchParams.get("cmid")
    if (direct) return direct
    const viewLink = document.querySelector("a[href*='/mod/quiz/view.php?id=']")
    if (!(viewLink instanceof HTMLAnchorElement)) return ""
    return new URL(viewLink.href).searchParams.get("id") || ""
  }

  function isQuizViewPage() {
    return /\/mod\/quiz\/view\.php$/i.test(location.pathname)
  }

  function isQuizAttemptPage() {
    return /\/mod\/quiz\/attempt\.php$/i.test(location.pathname)
  }

  function isQuizSummaryPage() {
    return /\/mod\/quiz\/summary\.php$/i.test(location.pathname)
  }

  function isQuizReviewPage() {
    return /\/mod\/quiz\/review\.php$/i.test(location.pathname)
  }

  function detectQuizMode() {
    if (looksLikePracticeQuiz()) return QUIZ_MODE_PRACTICE
    if (looksLikeCompletedChapterQuiz()) return QUIZ_MODE_COMPLETED_REVIEW
    return ""
  }

  function looksLikePracticeQuiz() {
    const title = cleanText(document.querySelector(".page-header-headings h1, header h1, [role='main'] h1")?.textContent || document.title)
    const summary = cleanText(document.querySelector("[role='main']")?.textContent).slice(0, 4_000)
    return /tự đánh giá|tu danh gia|self[- ]?assessment|practice quiz/i.test(`${title} ${normalizeForKey(title)}`)
      || /0[,.]00\s*\/\s*0[,.]00/.test(summary)
  }

  function looksLikeCompletedChapterQuiz() {
    const title = cleanText(document.querySelector(".page-header-headings h1, header h1, [role='main'] h1")?.textContent || document.title)
    return /bài kiểm tra kết thúc chương|bai kiem tra ket thuc chuong|chapter (?:final|end) quiz/i.test(`${title} ${normalizeForKey(title)}`)
  }

  function getCompletedReviewUrls(quizId) {
    const candidates = Array.from(document.querySelectorAll("a[href*='/mod/quiz/review.php?attempt=']"))
      .map((link) => isTag(link, "A") ? absoluteUrl(link.getAttribute("href")) : "")
    if (isQuizReviewPage()) candidates.push(location.href)
    return [...new Set(candidates.map((url) => validateCompletedReviewUrl(url, quizId)).filter(Boolean))]
  }

  function validateCompletedReviewUrl(value, quizId) {
    try {
      const url = new URL(value, location.href)
      if (url.origin !== location.origin || !/^\/mod\/quiz\/review\.php$/i.test(url.pathname)) return ""
      if (!url.searchParams.get("attempt")) return ""
      const cmid = url.searchParams.get("cmid")
      if (cmid && String(cmid) !== String(quizId)) return ""
      return url.href
    } catch {
      return ""
    }
  }

  function getAttemptIdFromReviewUrl(value) {
    try {
      return new URL(value, location.href).searchParams.get("attempt") || ""
    } catch {
      return ""
    }
  }

  function hasCompletedAttemptEvidence() {
    const mainText = cleanText(document.querySelector("[role='main']")?.textContent).slice(0, 12_000)
    return /(?:Đã xong|Hoàn thành|Finished|Submitted)/i.test(mainText)
  }

  function storageKey(quizId) {
    return `${STORAGE_PREFIX}${quizId}`
  }

  async function loadState(quizId) {
    const key = storageKey(quizId)
    const result = await storageGet(key)
    const state = result?.[key]
    if (!state || ![FORMAT_VERSION, LEGACY_FORMAT_VERSION].includes(state.format)) return null

    const normalized = normalizeState(state)
    const storedQuestionCount = Array.isArray(state.questions) ? state.questions.length : 0
    const questionBankChanged = normalized.questions.length !== storedQuestionCount
      || normalized.questions.some((question, index) => question.id !== state.questions[index]?.id)
    const executionModeChanged = state.executionMode !== normalized.executionMode
    if (questionBankChanged && normalized.status === "complete") {
      normalized.message = `Đã tải bộ ôn tập gồm ${normalized.questions.length} câu.`
    }
    if (state.format === LEGACY_FORMAT_VERSION || questionBankChanged || executionModeChanged) await saveState(normalized)
    return normalized
  }

  function normalizeState(state) {
    const normalized = {
      ...state,
      format: FORMAT_VERSION,
      quizMode: state.quizMode === QUIZ_MODE_COMPLETED_REVIEW ? QUIZ_MODE_COMPLETED_REVIEW : QUIZ_MODE_PRACTICE,
      executionMode: state.quizMode === QUIZ_MODE_COMPLETED_REVIEW ? "review-reader" : "iframe",
      maxAttempts: Number.isInteger(state.maxAttempts) ? state.maxAttempts : MAX_ATTEMPTS,
      completedAttempts: Number.isInteger(state.completedAttempts) ? state.completedAttempts : 0,
      noNewQuestionStreak: Number.isInteger(state.noNewQuestionStreak) ? state.noNewQuestionStreak : 0,
      lastAttemptNewQuestions: Number.isInteger(state.lastAttemptNewQuestions) ? state.lastAttemptNewQuestions : 0,
      stopReason: typeof state.stopReason === "string" ? state.stopReason : "",
      questions: normalizeQuestionBank(Array.isArray(state.questions) ? state.questions : []),
      processedAttemptIds: Array.isArray(state.processedAttemptIds) ? state.processedAttemptIds : [],
      availableReviewUrls: Array.isArray(state.availableReviewUrls) ? state.availableReviewUrls : [],
      warnings: Array.isArray(state.warnings) ? state.warnings : []
    }
    delete normalized.targetAttempts
    return normalized
  }

  function saveState(state) {
    return storageSet({ [storageKey(state.quizId)]: state })
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(key, (result) => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve(result)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(values, () => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function textZipFile(name, text) {
    return { name, data: new TextEncoder().encode(text) }
  }

  function createZipBlob(files) {
    const localParts = []
    const centralParts = []
    let offset = 0
    const { dosDate, dosTime } = dateToDos(new Date())

    files.forEach((file) => {
      const nameBytes = new TextEncoder().encode(file.name.replace(/\\/g, "/"))
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)
      const checksum = crc32(data)
      const localHeader = new Uint8Array(30 + nameBytes.length)
      const localView = new DataView(localHeader.buffer)
      localView.setUint32(0, 0x04034b50, true)
      localView.setUint16(4, 20, true)
      localView.setUint16(6, 0x0800, true)
      localView.setUint16(8, 0, true)
      localView.setUint16(10, dosTime, true)
      localView.setUint16(12, dosDate, true)
      localView.setUint32(14, checksum, true)
      localView.setUint32(18, data.length, true)
      localView.setUint32(22, data.length, true)
      localView.setUint16(26, nameBytes.length, true)
      localView.setUint16(28, 0, true)
      localHeader.set(nameBytes, 30)
      localParts.push(localHeader, data)

      const centralHeader = new Uint8Array(46 + nameBytes.length)
      const centralView = new DataView(centralHeader.buffer)
      centralView.setUint32(0, 0x02014b50, true)
      centralView.setUint16(4, 20, true)
      centralView.setUint16(6, 20, true)
      centralView.setUint16(8, 0x0800, true)
      centralView.setUint16(10, 0, true)
      centralView.setUint16(12, dosTime, true)
      centralView.setUint16(14, dosDate, true)
      centralView.setUint32(16, checksum, true)
      centralView.setUint32(20, data.length, true)
      centralView.setUint32(24, data.length, true)
      centralView.setUint16(28, nameBytes.length, true)
      centralView.setUint16(30, 0, true)
      centralView.setUint16(32, 0, true)
      centralView.setUint16(34, 0, true)
      centralView.setUint16(36, 0, true)
      centralView.setUint32(38, 0, true)
      centralView.setUint32(42, offset, true)
      centralHeader.set(nameBytes, 46)
      centralParts.push(centralHeader)
      offset += localHeader.length + data.length
    })

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(4, 0, true)
    endView.setUint16(6, 0, true)
    endView.setUint16(8, files.length, true)
    endView.setUint16(10, files.length, true)
    endView.setUint32(12, centralSize, true)
    endView.setUint32(16, offset, true)
    endView.setUint16(20, 0, true)
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" })
  }

  function crc32(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
    return (crc ^ 0xffffffff) >>> 0
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1
      table[index] = value >>> 0
    }
    return table
  })()

  function dateToDos(date) {
    const year = Math.max(1980, date.getFullYear())
    return {
      dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.rel = "noopener"
    anchor.hidden = true
    document.documentElement.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function injectTheme() {
    if (document.getElementById(STYLE_ID)) return
    const loadingIcon = chrome.runtime.getURL("src/icons/loading.svg")
    const readyIcon = chrome.runtime.getURL("src/icons/book-alt.svg")
    const doneIcon = chrome.runtime.getURL("src/icons/check-circle.svg")
    const warningIcon = chrome.runtime.getURL("src/icons/exclamation.svg")
    const downloadIcon = chrome.runtime.getURL("src/icons/inbox-in.svg")
    const pauseIcon = chrome.runtime.getURL("src/icons/pause.svg")
    const playIcon = chrome.runtime.getURL("src/icons/play.svg")
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
      .ou-yeah-quiz-trainer {
        --ou-quiz-brand: #5269c7;
        --ou-quiz-progress: 0%;
        margin: 0 0 18px;
        overflow: hidden;
        border: 1px solid #dfe4ef;
        border-radius: 14px;
        background: #fff;
        color: #202638;
        box-shadow: 0 10px 28px rgba(31, 39, 64, 0.07);
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
      }

      .ou-yeah-quiz-trainer-main {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 15px 12px;
      }

      .ou-yeah-quiz-trainer-icon {
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        border-radius: 10px;
        background: var(--ou-quiz-brand);
        -webkit-mask: url("${readyIcon}") center / 18px 18px no-repeat;
        mask: url("${readyIcon}") center / 18px 18px no-repeat;
      }

      .ou-yeah-quiz-trainer[data-status="running"] .ou-yeah-quiz-trainer-icon,
      .ou-yeah-quiz-trainer[data-status="exporting"] .ou-yeah-quiz-trainer-icon {
        -webkit-mask-image: url("${loadingIcon}");
        mask-image: url("${loadingIcon}");
        animation: ouYeahQuizSpin 900ms linear infinite;
      }

      .ou-yeah-quiz-trainer[data-status="complete"] .ou-yeah-quiz-trainer-icon {
        background: #3f9b6d;
        -webkit-mask-image: url("${doneIcon}");
        mask-image: url("${doneIcon}");
      }

      .ou-yeah-quiz-trainer[data-status="stopped"] .ou-yeah-quiz-trainer-icon {
        -webkit-mask-image: url("${pauseIcon}");
        mask-image: url("${pauseIcon}");
      }

      .ou-yeah-quiz-trainer[data-status="error"] .ou-yeah-quiz-trainer-icon {
        background: #c65761;
        -webkit-mask-image: url("${warningIcon}");
        mask-image: url("${warningIcon}");
      }

      .ou-yeah-quiz-trainer-copy { min-width: 0; flex: 1 1 auto; }
      .ou-yeah-quiz-trainer-kicker {
        display: block;
        margin-bottom: 2px;
        color: #5269c7;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .ou-yeah-quiz-trainer-title { display: block; font-size: 14px; line-height: 1.25; }
      .ou-yeah-quiz-trainer-status {
        display: block;
        overflow: hidden;
        margin-top: 3px;
        color: #70788b;
        font-size: 12px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ou-yeah-quiz-trainer-actions {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        gap: 7px;
      }

      .ou-yeah-quiz-trainer-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
        flex: 0 0 auto;
        padding: 0 14px;
        border: 0;
        border-radius: 10px;
        background: #405bb8;
        color: #fff;
        font: 650 12px/1 "Space Grotesk", "Segoe UI", sans-serif;
        cursor: pointer;
        transition: background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
      }
      .ou-yeah-quiz-trainer-action:hover { background: #344da7; transform: translateY(-1px); box-shadow: 0 7px 16px rgba(64, 91, 184, 0.2); }
      .ou-yeah-quiz-trainer[data-status="running"] .ou-yeah-quiz-trainer-action { background: #eef1f7; color: #596176; box-shadow: none; }
      .ou-yeah-quiz-trainer[data-status="exporting"] .ou-yeah-quiz-trainer-action { background: #eef1f7; color: #7a8293; box-shadow: none; cursor: wait; }

      .ou-yeah-quiz-trainer-action::before,
      .ou-yeah-quiz-trainer-export::before {
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
        background: currentColor;
        content: "";
        -webkit-mask: var(--ou-quiz-button-icon) center / contain no-repeat;
        mask: var(--ou-quiz-button-icon) center / contain no-repeat;
      }
      .ou-yeah-quiz-trainer-action[data-icon="pause"] { --ou-quiz-button-icon: url("${pauseIcon}"); }
      .ou-yeah-quiz-trainer-action[data-icon="play"] { --ou-quiz-button-icon: url("${playIcon}"); }
      .ou-yeah-quiz-trainer-action[data-icon="scan"] { --ou-quiz-button-icon: url("${loadingIcon}"); }
      .ou-yeah-quiz-trainer-action[data-icon="download"] { --ou-quiz-button-icon: url("${downloadIcon}"); }
      .ou-yeah-quiz-trainer[data-status="exporting"] .ou-yeah-quiz-trainer-action::before { animation: ouYeahQuizSpin 900ms linear infinite; }
      .ou-yeah-quiz-trainer-export[data-icon="download"] { --ou-quiz-button-icon: url("${downloadIcon}"); }

      .ou-yeah-quiz-trainer-guard {
        position: relative;
        margin: 0 14px 12px;
        padding: 9px 11px 9px 34px;
        border: 1px solid #eadfbd;
        border-radius: 9px;
        background: #fffaf0;
        color: #625a45;
        font-size: 11.5px;
        font-weight: 520;
        line-height: 1.4;
      }
      .ou-yeah-quiz-trainer-guard::before {
        position: absolute;
        top: 9px;
        left: 10px;
        width: 15px;
        height: 15px;
        background: #a67d25;
        content: "";
        -webkit-mask: url("${warningIcon}") center / contain no-repeat;
        mask: url("${warningIcon}") center / contain no-repeat;
      }
      .ou-yeah-quiz-trainer-guard[hidden] { display: none !important; }

      .ou-yeah-quiz-trainer-progress { height: 4px; background: #eef1f6; }
      .ou-yeah-quiz-trainer-progress-fill {
        display: block;
        width: var(--ou-quiz-progress);
        height: 100%;
        background: linear-gradient(90deg, #5269c7, #7b8ddd);
        transition: width 300ms cubic-bezier(.22, .8, .25, 1);
      }
      .ou-yeah-quiz-trainer[data-status="complete"] .ou-yeah-quiz-trainer-progress-fill { background: #4ca97a; }

      .ou-yeah-quiz-trainer-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 31px;
        padding: 0 15px;
        color: #7a8293;
        font-size: 11px;
      }
      .ou-yeah-quiz-trainer-export {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 34px;
        padding: 0 11px;
        border: 1px solid #d9dfef;
        border-radius: 9px;
        background: #fff;
        color: #405bb8;
        font: 650 11px/1 "Space Grotesk", "Segoe UI", sans-serif;
        cursor: pointer;
      }
      .ou-yeah-quiz-trainer-export:hover { border-color: #bdc8e7; background: #f7f8fc; }
      .ou-yeah-quiz-trainer-export[hidden] { display: none !important; }

      .ou-yeah-quiz-trainer[data-compact="true"] {
        margin-bottom: 10px;
        border-color: #d9e8df;
        border-radius: 12px;
        box-shadow: 0 5px 16px rgba(34, 69, 50, 0.05);
      }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-main { padding: 9px 11px; }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-icon {
        width: 28px;
        height: 28px;
        flex-basis: 28px;
        border-radius: 8px;
        -webkit-mask-size: 15px 15px;
        mask-size: 15px 15px;
      }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-kicker,
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-progress,
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-meta { display: none; }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-title { font-size: 13px; }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-status {
        margin-top: 1px;
        font-size: 11px;
      }
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-action,
      .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-export {
        min-height: 32px;
        padding-inline: 10px;
      }

      @keyframes ouYeahQuizSpin { to { transform: rotate(360deg); } }

      @media (max-width: 700px) {
        .ou-yeah-quiz-trainer-main { align-items: stretch; flex-wrap: wrap; }
        .ou-yeah-quiz-trainer-copy { width: calc(100% - 46px); }
        .ou-yeah-quiz-trainer-actions { width: 100%; }
        .ou-yeah-quiz-trainer-action { flex: 1 1 auto; }
        .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-main { align-items: center; flex-wrap: nowrap; }
        .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-copy { width: auto; }
        .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-actions { width: auto; }
        .ou-yeah-quiz-trainer[data-compact="true"] .ou-yeah-quiz-trainer-action { display: none; }
      }
    `
    document.documentElement.appendChild(style)
  }

  function imageExtension(contentType, url) {
    const byType = {
      "image/avif": "avif",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/svg+xml": "svg",
      "image/webp": "webp"
    }
    if (byType[contentType]) return byType[contentType]
    const match = new URL(url, location.href).pathname.match(/\.([a-z0-9]{2,5})$/i)
    const extension = match?.[1]?.toLowerCase()
    return extension === "jpeg" ? "jpg" : (["avif", "gif", "jpg", "png", "svg", "webp"].includes(extension || "") ? extension : "bin")
  }

  function absoluteUrl(value, baseUrl = location.href) {
    if (!value || /^data:|^javascript:/i.test(value)) return ""
    try {
      return new URL(value, baseUrl).href
    } catch {
      return ""
    }
  }

  function hashString(value) {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return `q-${(hash >>> 0).toString(16).padStart(8, "0")}`
  }

  function normalizeForKey(value) {
    return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
  }

  function stripOptionPrefix(value) {
    return cleanText(value).replace(/^[a-z][.:)]\s*/i, "")
  }

  function optionLabel(index) {
    return String.fromCharCode(65 + Math.min(index, 25))
  }

  function pad(value) {
    return String(value).padStart(2, "0")
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ou-yeah"
  }

  function escapeMarkdownText(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
  }

  function escapeMarkdownUrl(value) {
    return String(value || "").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20")
  }

  function dedupeBy(items, getKey) {
    const seen = new Set()
    return items.filter((item) => {
      const key = getKey(item)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  }

  function readableError(error) {
    return error instanceof Error ? error.message : String(error || "Đã có lỗi xảy ra.")
  }

})()
