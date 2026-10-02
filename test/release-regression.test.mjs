import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const elolmsSender = {
  url: "https://elolms.ou.edu.vn/mod/quiz/view.php?id=448615",
  tab: { id: 1, url: "https://elolms.ou.edu.vn/mod/quiz/view.php?id=448615" }
}
const sourceFile = (name) => readFile(new URL("../src/" + name, import.meta.url), "utf8")

function createEvent() {
  const listeners = new Set()
  return {
    addListener(listener) { listeners.add(listener) },
    removeListener(listener) { listeners.delete(listener) },
    emit(value) { for (const listener of listeners) listener(value) },
    get size() { return listeners.size }
  }
}

function exposeIife(source, functions) {
  const end = source.lastIndexOf("})()")
  assert.ok(end > 0)
  return source.slice(0, end) + "globalThis.hooks = { " + functions.join(", ") + " }\n" + source.slice(end)
}

async function createDownloadHarness({ stateForDownload = () => "complete", now = () => Date.now() } = {}) {
  let offscreenListener
  const offscreen = vm.createContext({
    URL, Blob, Uint8Array, atob,
    chrome: { runtime: { onMessage: { addListener(listener) { offscreenListener = listener } } } }
  })
  vm.runInContext(await sourceFile("offscreen.js"), offscreen)

  let runtimeListener
  const downloads = []
  const notifications = []
  const revokedUrls = []
  const states = new Map()
  const storage = {}
  const downloadEvents = createEvent()
  const chrome = {
    action: { onClicked: createEvent() },
    alarms: { get: async () => undefined, create: async () => {} },
    downloads: {
      onChanged: downloadEvents,
      async download(options) {
        const id = downloads.length + 1
        const bytes = Buffer.from(await (await fetch(options.url)).arrayBuffer())
        downloads.push({ ...options, id, bytes })
        states.set(id, { id, state: stateForDownload(id), error: "FILE_FAILED" })
        return id
      },
      search: async ({ id }) => states.has(id) ? [states.get(id)] : [],
      cancel: async (id) => downloadEvents.emit({ id, state: { current: "interrupted" } })
    },
    notifications: {
      create(id, options, callback) {
        notifications.push({ id, ...options })
        callback(id)
      }
    },
    offscreen: { hasDocument: async () => true },
    runtime: {
      getURL: (path) => "chrome-extension://ou-yeah/" + path,
      onMessage: { addListener(listener) { runtimeListener = listener } },
      sendMessage(message) {
        let response
        offscreenListener(message, {}, (value) => { response = value })
        if (message.type === "ou-yeah-revoke-object-url") revokedUrls.push(message.blobUrl)
        return Promise.resolve(response)
      }
    },
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (values) => { Object.assign(storage, values) }
    } },
    tabs: { onRemoved: createEvent() },
    webRequest: { onBeforeRequest: createEvent(), onHeadersReceived: createEvent() }
  }
  class Clock extends Date {
    static now() { return now() }
  }
  const background = vm.createContext({ URL, Date: Clock, setTimeout, clearTimeout, chrome })
  vm.runInContext(await sourceFile("background.js"), background)
  return {
    background, downloads, notifications, revokedUrls, states, storage, downloadEvents,
    request(message, sender = elolmsSender) {
      return new Promise((resolve) => runtimeListener(message, sender, resolve))
    }
  }
}

async function createQuizExporter(harness, imageBytes) {
  const window = { addEventListener() {} }
  window.top = window.self = window
  const document = {
    getElementById: (id) => id === "ou-yeah-quiz-trainer-style" ? {} : null,
    querySelector: () => null
  }
  const context = vm.createContext({
    window, document, URL, Date, Uint8Array, TextEncoder, btoa,
    HTMLElement: class {}, HTMLAnchorElement: class {},
    location: new URL("https://elolms.ou.edu.vn/mod/quiz/view.php"),
    chrome: {
      runtime: { sendMessage: (message) => harness.request(message) },
      storage: { local: { set(_values, callback) { callback() } } }
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => imageBytes.buffer
    })
  })
  vm.runInContext(exposeIife(await sourceFile("quiz-trainer.js"), ["exportQuizBank"]), context)
  return context.hooks.exportQuizBank
}

function quizState() {
  return {
    quizId: "448615", quizTitle: "Bài tập tự đánh giá Chương 4",
    courseCode: "COSC04052-2531", viewUrl: elolmsSender.url,
    status: "exporting", completedAttempts: 2, noNewQuestionStreak: 3,
    maxAttempts: 50, stopReason: "stable", questions: [{
      id: "q-1", question: "Ảnh minh họa có nội dung gì?", correctAnswer: "Tiếng Việt",
      options: [{ label: "A", text: "Tiếng Việt", correct: true }],
      attempts: ["101", "102"],
      images: [{ sourceUrl: "https://elolms.ou.edu.vn/question/image.png", alt: "Ảnh câu hỏi" }]
    }]
  }
}

test("quiz folder export preserves Unicode, JSON, Markdown image links and a large binary image", async () => {
  const harness = await createDownloadHarness()
  const imageBytes = new Uint8Array(1024 * 1024).fill(171)
  const exportQuizBank = await createQuizExporter(harness, imageBytes)
  const result = await exportQuizBank(quizState())

  assert.equal(result.downloaded, 4)
  const prefix = "OU Yeah!/Quiz Banks/" + result.folderName + "/"
  assert.deepEqual(harness.downloads.map((file) => file.filename), [
    prefix + "README.md", prefix + "quiz-bank.md", prefix + "quiz-bank.json",
    prefix + "images/question-01-01.png"
  ])
  const markdown = harness.downloads[1].bytes.toString("utf8")
  assert.ok(markdown.includes("Ảnh minh họa có nội dung gì?"))
  assert.ok(markdown.includes("![Ảnh câu hỏi](images/question-01-01.png)"))
  const bank = JSON.parse(harness.downloads[2].bytes.toString("utf8"))
  assert.equal(bank.questions[0].correctAnswer, "Tiếng Việt")
  assert.equal(bank.questions[0].images[0].path, "images/question-01-01.png")
  assert.deepEqual(harness.downloads[3].bytes, Buffer.from(imageBytes))
  assert.ok(harness.downloads.every((file) => file.saveAs === false && !file.filename.endsWith(".zip")))
  assert.equal(harness.revokedUrls.length, 4)
  assert.equal(harness.downloadEvents.size, 1)
})

test("quiz export stops the file queue when Chrome has already interrupted a download", async () => {
  const harness = await createDownloadHarness({ stateForDownload: (id) => id === 2 ? "interrupted" : "complete" })
  const exportQuizBank = await createQuizExporter(harness, new Uint8Array([1, 2, 3]))
  await assert.rejects(exportQuizBank(quizState()), /FILE_FAILED/)
  assert.equal(harness.downloads.length, 2)
  assert.equal(harness.revokedUrls.length, 2)
  assert.equal(harness.downloadEvents.size, 1)
})

test("quiz file response waits for Chrome completion and reports a later interruption", async () => {
  const harness = await createDownloadHarness({ stateForDownload: () => "in_progress" })
  const message = {
    type: "ou-yeah-download-quiz-bank-file", folderName: "course-quiz-bank",
    relativePath: "quiz-bank.md", mimeType: "text/markdown;charset=utf-8",
    data: Buffer.from("Nội dung bộ đề").toString("base64")
  }
  let settled = false
  const pending = harness.request(message).then((response) => { settled = true; return response })
  for (let index = 0; index < 20 && harness.downloadEvents.size < 2; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(harness.downloadEvents.size, 2)
  assert.equal(settled, false)
  assert.equal(harness.revokedUrls.length, 0)
  harness.downloadEvents.emit({ id: 1, state: { current: "complete" } })
  assert.equal((await pending).ok, true)

  const interrupted = harness.request(message)
  for (let index = 0; index < 20 && harness.downloadEvents.size < 2; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  harness.downloadEvents.emit({ id: 2, state: { current: "interrupted" }, error: { current: "FILE_ACCESS_DENIED" } })
  const response = await interrupted
  assert.equal(response.ok, false)
  assert.ok(response.error.includes("FILE_ACCESS_DENIED"))
  assert.equal(harness.revokedUrls.length, 2)
  assert.equal(harness.downloadEvents.size, 1)
})

test("quiz folder downloads reject traversal, invalid data and requests outside ELOLMS", async () => {
  const harness = await createDownloadHarness()
  const message = {
    type: "ou-yeah-download-quiz-bank-file", folderName: "course-quiz-bank",
    relativePath: "quiz-bank.json", mimeType: "application/json;charset=utf-8",
    data: Buffer.from("{}").toString("base64")
  }
  for (const invalid of [
    { ...message, folderName: "../other" },
    { ...message, relativePath: "../quiz-bank.json" },
    { ...message, data: "invalid===" },
    { ...message, mimeType: "text/html" }
  ]) {
    assert.equal((await harness.request(invalid)).ok, false)
  }
  assert.equal((await harness.request(message, { url: "https://example.test/" })).ok, false)
  assert.equal(harness.downloads.length, 0)
})

test("daily reminders use Vietnam calendar days, the requested hours and no duplicate deliveries", async () => {
  let now = Date.parse("2026-10-02T20:00:00+07:00")
  const harness = await createDownloadHarness({ now: () => now })
  harness.storage.ouYeahDeadlineReminderEventsV1 = [
    { title: "Còn 3 ngày", course: "Môn A", date: Date.parse("2026-10-05T23:55:00+07:00"), kind: "deadline" },
    { title: "Còn 1 ngày", course: "Môn B", date: Date.parse("2026-10-03T23:55:00+07:00"), kind: "deadline" },
    { title: "VC ngày mai", course: "Môn C", date: Date.parse("2026-10-03T19:00:00+07:00"), kind: "meeting" },
    { title: "Đã nộp", course: "Môn D", date: Date.parse("2026-10-03T23:55:00+07:00"), kind: "deadline", completed: true },
    { title: "Trễ hạn", course: "Môn E", date: Date.parse("2026-10-01T23:55:00+07:00"), kind: "deadline" }
  ]
  await harness.background.handleDeadlineDailyAlarm(20, now)
  assert.deepEqual(harness.notifications.map((item) => item.title), [
    "Deadline còn 3 ngày", "Deadline còn 1 ngày", "VC diễn ra ngày mai"
  ])
  await harness.background.handleDeadlineDailyAlarm(20, now)
  assert.equal(harness.notifications.length, 3)
  for (const hour of [21, 22, 23]) {
    now = Date.parse("2026-10-02T" + hour + ":00:00+07:00")
    await harness.background.handleDeadlineDailyAlarm(hour, now)
  }
  assert.equal(harness.notifications.length, 6)
  assert.ok(harness.notifications.slice(3).every((item) => item.title === "Deadline còn 1 ngày"))
  assert.ok(harness.notifications.every((item) => !item.message.includes("Đã nộp") && !item.message.includes("Trễ hạn")))
})

test("exact reminders cover 72/24 hours and meeting 3/2/1 hours without repeating the daily reminder", async () => {
  let now = Date.parse("2026-10-02T20:00:00+07:00")
  const harness = await createDownloadHarness({ now: () => now })
  const events = [
    { title: "Bài A", course: "Môn A", date: now + 72 * 3600000, kind: "deadline" },
    { title: "Bài B", course: "Môn B", date: now + 24 * 3600000, kind: "deadline" },
    { title: "Video conference 3", course: "Môn C", date: now + 3 * 3600000, kind: "meeting" }
  ]
  harness.storage.ouYeahDeadlineReminderEventsV1 = events
  await harness.background.deliverExactDeadlineReminders(events, now)
  assert.deepEqual(harness.notifications.map((item) => item.title), [
    "Deadline còn 72 giờ", "Deadline còn 24 giờ", "VC bắt đầu trong 3 giờ"
  ])
  await harness.background.handleDeadlineDailyAlarm(20, now)
  assert.equal(harness.notifications.length, 3)
  for (const hours of [1, 2]) {
    now += 3600000
    await harness.background.deliverExactDeadlineReminders(events, now)
    assert.equal(harness.notifications.at(-1).title, "VC bắt đầu trong " + (3 - hours) + " giờ")
  }
})

test("deadline filters keep extensions beside their original deadline and deduplicate VC sources", async () => {
  const window = { addEventListener() {}, clearTimeout() {}, setTimeout() { return 0 } }
  window.top = window.self = window
  const context = vm.createContext({
    window, Date, URL, URLSearchParams,
    location: new URL("https://elolms.ou.edu.vn/course/view.php"),
    document: { getElementById: () => ({}), addEventListener() {} }
  })
  vm.runInContext(exposeIife(await sourceFile("deadlines.js"), [
    "mergeEvents", "buildDeadlineEntries", "filterCompletedDeadlineEntry", "isEventVisibleForCompletionFilter"
  ]), context)
  const now = Date.parse("2026-09-28T20:00:00+07:00")
  const base = { title: "Bài kiểm tra Chương 3", course: "Môn A", date: new Date("2026-09-28T23:55:00+07:00") }
  const extension = { ...base, title: "Bài kiểm tra Chương 3 - Gia hạn", date: new Date("2026-10-05T23:55:00+07:00") }
  const all = [base, extension]
  const [entry] = context.hooks.buildDeadlineEntries(all)
  assert.equal(context.hooks.filterCompletedDeadlineEntry(entry, all, "due-today", now).events.length, 2)
  base.completed = true
  assert.equal(context.hooks.filterCompletedDeadlineEntry(entry, all, "hide-completed", now), null)
  base.completed = false
  base.date = new Date("2026-09-21T23:55:00+07:00")
  assert.equal(context.hooks.filterCompletedDeadlineEntry(entry, all, "overdue-unsubmitted", now).events.length, 2)
  const afterMidnight = { ...base, date: new Date("2026-09-29T00:05:00+07:00") }
  assert.equal(context.hooks.isEventVisibleForCompletionFilter(afterMidnight, "due-today", [afterMidnight], now), false)

  const meeting = { title: "Video conference 3", course: "Môn B", kind: "meeting", date: new Date("2026-09-26T19:00:00+07:00"), href: "https://elolms.ou.edu.vn/mod/forum/view.php?id=1" }
  const duplicate = { ...meeting, href: "https://elolms.ou.edu.vn/mod/forum/discuss.php?d=2", completed: true }
  const merged = context.hooks.mergeEvents([meeting], [duplicate])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].completed, true)
})
