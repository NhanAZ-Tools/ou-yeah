const ALLOWED_HOSTS = new Set(["elolms.ou.edu.vn", "player.vimeo.com"])
const OFFSCREEN_DOCUMENT = "src/offscreen.html"
const MEDIA_URL_RE = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)(?:[?#]|$)/i
const MEDIA_MIME_RE = /(?:video|mpegurl|dash\+xml|mp2t)/i

const tabMedia = new Map()
const downloadJobs = new Map()
const trackedDownloads = new Map()
const pendingCanceledJobs = new Set()

function isFromSupportedPage(details) {
  return [details.initiator, details.documentUrl, details.originUrl, details.url]
    .filter(Boolean)
    .some((value) => {
      try {
        return ALLOWED_HOSTS.has(new URL(value).hostname)
      } catch {
        return String(value).includes("elolms.ou.edu.vn") || String(value).includes("player.vimeo.com")
      }
    })
}

function rememberMedia(tabId, url, source) {
  if (tabId < 0 || !url) return

  const current = tabMedia.get(tabId) || []
  const next = current.filter((item) => item.url !== url)
  next.unshift({
    url,
    source,
    seenAt: Date.now()
  })
  tabMedia.set(tabId, next.slice(0, 40))
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isFromSupportedPage(details)) return {}
    if (MEDIA_URL_RE.test(details.url)) {
      rememberMedia(details.tabId, details.url, `network:${details.type}`)
    }
    return {}
  },
  { urls: ["<all_urls>"] }
)

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isFromSupportedPage(details)) return {}

    const contentType = (details.responseHeaders || [])
      .find((header) => header.name.toLowerCase() === "content-type")
      ?.value || ""

    if (MEDIA_URL_RE.test(details.url) || MEDIA_MIME_RE.test(contentType)) {
      rememberMedia(details.tabId, details.url, `headers:${contentType || details.type}`)
    }
    return {}
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
)

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId)
})

chrome.downloads.onChanged.addListener((delta) => {
  const jobId = trackedDownloads.get(delta.id)
  if (!jobId) return

  if (delta.state?.current === "complete") {
    forwardProgress({
      jobId,
      status: "complete",
      label: "Đã tải xong.",
      percent: 100,
      downloadId: delta.id
    })
    trackedDownloads.delete(delta.id)
    downloadJobs.delete(jobId)
    return
  }

  if (delta.state?.current === "interrupted" || delta.error?.current) {
    if (retryHlsSave(jobId, delta.id, delta.error?.current || "")) return
    forwardProgress({
      jobId,
      status: "error",
      label: delta.error?.current || "Tệp tải xuống đã bị gián đoạn.",
      downloadId: delta.id
    })
    trackedDownloads.delete(delta.id)
    downloadJobs.delete(jobId)
  }
})

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab).catch(() => {})
})

async function handleActionClick(tab) {
  if (!tab?.id) return

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ou-yeah-pulse-hud" })
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["src/content.js"]
      })
    } catch {
      // The active page may not allow script injection. Nothing useful to do here.
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false

  if (message.type === "ou-yeah-get-media-candidates") {
    const tabId = sender.tab?.id
    sendResponse({
      ok: true,
      candidates: tabId == null ? [] : tabMedia.get(tabId) || []
    })
    return false
  }

  if (message.type === "ou-yeah-register-media-candidates") {
    const tabId = sender.tab?.id
    if (tabId == null || !isVimeoSender(sender)) {
      sendResponse({ ok: false, accepted: 0 })
      return false
    }

    let accepted = 0
    const candidates = Array.isArray(message.candidates) ? message.candidates.slice(0, 24) : []
    candidates.forEach((candidate) => {
      const url = normalizeUrl(candidate?.url)
      if (!url || !MEDIA_URL_RE.test(url)) return
      rememberMedia(tabId, url, String(candidate?.source || "vimeo-config").slice(0, 80))
      accepted += 1
    })
    sendResponse({ ok: true, accepted })
    return false
  }

  if (message.type === "ou-yeah-clear-media-candidates") {
    const tabId = sender.tab?.id
    if (tabId != null) tabMedia.set(tabId, [])
    sendResponse({ ok: true })
    return false
  }

  if (message.type === "ou-yeah-cancel-download-job") {
    sendResponse(cancelDownloadJob(message.jobId, sender))
    return false
  }

  if (message.type === "ou-yeah-download-media") {
    respondToAsyncRequest(handleDownloadRequest(message, sender), sendResponse)
    return true
  }

  if (message.type === "ou-yeah-download-course-resource") {
    respondToAsyncRequest(handleCourseResourceRequest(message, sender), sendResponse)
    return true
  }

  if (message.type === "ou-yeah-download-course-manifest") {
    respondToAsyncRequest(handleCourseManifestRequest(message, sender), sendResponse)
    return true
  }

  if (message.type === "ou-yeah-download-course-file") {
    respondToAsyncRequest(handleCourseFileRequest(message, sender), sendResponse)
    return true
  }

  if (message.type === "ou-yeah-download-book-pdf") {
    respondToAsyncRequest(handleBookPdfRequest(message, sender), sendResponse)
    return true
  }

  if (message.type === "ou-yeah-hls-progress") {
    forwardProgress(message)
    return false
  }

  if (message.type === "ou-yeah-hls-ready") {
    handleHlsReady(message)
    return false
  }

  if (message.type === "ou-yeah-hls-error") {
    forwardProgress({
      type: "ou-yeah-hls-progress",
      jobId: message.jobId,
      status: "error",
      label: message.error || "Không thể tải luồng video."
    })
    downloadJobs.delete(message.jobId)
    return false
  }

  if (message.type === "ou-yeah-book-progress") {
    forwardBookProgress(message)
    return false
  }

  if (message.type === "ou-yeah-book-pdf-ready") {
    handleBookPdfReady(message)
    return false
  }

  if (message.type === "ou-yeah-book-pdf-error") {
    forwardBookProgress({
      jobId: message.jobId,
      status: "error",
      label: message.error || "Không thể tạo tệp PDF."
    })
    downloadJobs.delete(message.jobId)
    return false
  }

  return false
})

function respondToAsyncRequest(pending, sendResponse) {
  pending
    .then((response) => {
      try {
        sendResponse(response)
      } catch {
        // The sender can disappear while the async job is starting.
      }
    })
    .catch((error) => {
      try {
        sendResponse({ ok: false, error: readableError(error) })
      } catch {
        // The message channel was already closed.
      }
    })
}

function cancelDownloadJob(jobId, sender) {
  const job = downloadJobs.get(jobId)
  if (!job || (job.tabId != null && job.tabId !== sender.tab?.id)) {
    return { ok: false, error: "Không tìm thấy tác vụ tải đang chạy." }
  }

  if (job.downloadId != null) {
    trackedDownloads.delete(job.downloadId)
    chrome.downloads.cancel(job.downloadId).catch(() => {})
  } else if (job.mode !== "hls") {
    pendingCanceledJobs.add(jobId)
  }
  if (job.mode === "hls") {
    chrome.runtime.sendMessage({ type: "ou-yeah-cancel-download-hls", jobId }).catch(() => {})
  }

  forwardProgress({
    jobId,
    status: "canceled",
    label: "Đã hủy ngay.",
    downloadId: job.downloadId
  })
  downloadJobs.delete(jobId)
  return { ok: true }
}

async function handleDownloadRequest(message, sender) {
  const url = normalizeUrl(message.url)
  if (!url) {
    return { ok: false, error: "Không tìm thấy link video hợp lệ." }
  }

  const preservePath = message.courseBatch === true
  const filename = preservePath
    ? sanitizeDownloadPath(message.filename || filenameFromUrl(url, message.pageTitle))
    : sanitizeFilename(message.filename || filenameFromUrl(url, message.pageTitle))
  rememberMedia(sender.tab?.id ?? -1, url, "download-click")

  if (isHlsUrl(url)) {
    const jobId = crypto.randomUUID()
    downloadJobs.set(jobId, {
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      filename,
      kind: preservePath ? "course-media" : "video",
      preservePath,
      mode: "hls"
    })

    try {
      await ensureOffscreenDocument()
      await chrome.runtime.sendMessage({
        type: "ou-yeah-download-hls",
        jobId,
        url,
        filename
      })
      return { ok: true, mode: "hls", jobId }
    } catch (error) {
      downloadJobs.delete(jobId)
      return { ok: false, error: readableError(error) }
    }
  }

  if (preservePath) {
    return trackedDirectDownload(url, filename, sender, "course-media", "overwrite")
  }

  return directDownload(url, filename)
}

async function handleCourseResourceRequest(message, sender) {
  if (!isElolmsSender(sender)) {
    return { ok: false, error: "Yêu cầu tải học liệu không đến từ ELOLMS." }
  }

  const url = normalizeUrl(message.url)
  if (!isHttpsElolmsUrl(url)) {
    return { ok: false, error: "Link học liệu ELOLMS không hợp lệ." }
  }

  const filename = sanitizeDownloadPath(message.filename || "OU Yeah!/hoc-lieu")
  return trackedDirectDownload(url, filename, sender, "course-resource", "overwrite")
}

async function handleCourseManifestRequest(message, sender) {
  if (!isElolmsSender(sender)) {
    return { ok: false, error: "Yêu cầu tạo manifest không đến từ ELOLMS." }
  }

  const content = String(message.content || "")
  if (!content || content.length > 2_000_000) {
    return { ok: false, error: "Nội dung manifest trống hoặc quá lớn." }
  }

  const filename = sanitizeDownloadPath(message.filename || "OU Yeah!/ou-yeah-course-manifest.json")
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`
  return trackedDirectDownload(url, filename, sender, "course-manifest", "overwrite")
}

async function handleCourseFileRequest(message, sender) {
  if (!isElolmsSender(sender)) {
    return { ok: false, error: "Yêu cầu tải tệp AI không đến từ ELOLMS." }
  }

  const blobUrl = String(message.blobUrl || "")
  if (!/^blob:/i.test(blobUrl)) {
    return { ok: false, error: "Tệp AI không có Blob URL hợp lệ." }
  }

  const filename = sanitizeDownloadPath(message.filename || "OU Yeah!/00-AI/ai-file")
  return trackedDirectDownload(blobUrl, filename, sender, "course-ai-file", "overwrite")
}

function isElolmsSender(sender) {
  const senderUrl = normalizeUrl(sender.url || sender.tab?.url)
  return Boolean(senderUrl && new URL(senderUrl).hostname === "elolms.ou.edu.vn")
}

function isHttpsElolmsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "elolms.ou.edu.vn"
  } catch {
    return false
  }
}

function isVimeoSender(sender) {
  const senderUrl = normalizeUrl(sender.url || sender.tab?.url)
  return Boolean(senderUrl && new URL(senderUrl).hostname === "player.vimeo.com")
}

/**
 * @param {"uniquify"|"overwrite"|"prompt"} [conflictAction]
 */
async function trackedDirectDownload(url, filename, sender, kind, conflictAction = "uniquify") {
  const jobId = crypto.randomUUID()
  downloadJobs.set(jobId, {
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    filename,
    kind
  })

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction,
      saveAs: false
    })
    const job = downloadJobs.get(jobId)
    if (pendingCanceledJobs.delete(jobId)) {
      chrome.downloads.cancel(downloadId).catch(() => {})
      trackedDownloads.delete(downloadId)
      downloadJobs.delete(jobId)
      return { ok: true, mode: "tracked-direct", jobId, downloadId }
    }
    if (job) job.downloadId = downloadId
    trackedDownloads.set(downloadId, jobId)

    // Very small downloads (especially the JSON manifest) can finish between
    // chrome.downloads.download() resolving and the onChanged listener seeing
    // the job mapping. Reconcile the current state once so the queue never
    // waits forever for an event that already happened.
    const [download] = await chrome.downloads.search({ id: downloadId }).catch(() => [])
    if (trackedDownloads.get(downloadId) === jobId && download?.state === "complete") {
      forwardProgress({
        jobId,
        status: "complete",
        label: "Đã tải xong.",
        percent: 100,
        downloadId
      })
      trackedDownloads.delete(downloadId)
      downloadJobs.delete(jobId)
      return { ok: true, mode: "tracked-direct", jobId, downloadId }
    }

    if (trackedDownloads.get(downloadId) === jobId && download?.state === "interrupted") {
      forwardProgress({
        jobId,
        status: "error",
        label: download.error || "Tệp tải xuống đã bị gián đoạn.",
        downloadId
      })
      trackedDownloads.delete(downloadId)
      downloadJobs.delete(jobId)
      return { ok: false, error: download.error || "Tệp tải xuống đã bị gián đoạn." }
    }

    if (trackedDownloads.get(downloadId) !== jobId) {
      return { ok: true, mode: "tracked-direct", jobId, downloadId }
    }

    forwardProgress({
      jobId,
      status: "downloading",
      label: "Đang tải tệp...",
      percent: 0,
      downloadId
    })
    return { ok: true, mode: "tracked-direct", jobId, downloadId }
  } catch (error) {
    pendingCanceledJobs.delete(jobId)
    downloadJobs.delete(jobId)
    return { ok: false, error: readableError(error) }
  }
}

async function handleBookPdfRequest(message, sender) {
  const book = normalizeBookConfig(message.book)
  if (!book) {
    return { ok: false, error: "Cấu hình sách không hợp lệ." }
  }

  const senderUrl = normalizeUrl(sender.url || sender.tab?.url)
  if (!senderUrl || new URL(senderUrl).hostname !== "thuquan.ou.edu.vn") {
    return { ok: false, error: "Yêu cầu tải sách không đến từ Thư Quán OU." }
  }

  const jobId = crypto.randomUUID()
  const filename = ensurePdfFilename(message.filename || book.title)
  downloadJobs.set(jobId, {
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    filename,
    kind: "book"
  })

  try {
    await ensureOffscreenDocument()
    await chrome.runtime.sendMessage({
      type: "ou-yeah-build-book-pdf",
      jobId,
      book,
      filename
    })
    return { ok: true, mode: "book-pdf", jobId }
  } catch (error) {
    downloadJobs.delete(jobId)
    return { ok: false, error: readableError(error) }
  }
}

function normalizeBookConfig(rawBook) {
  if (!rawBook || typeof rawBook !== "object") return null

  const documentId = Number(rawBook.documentId)
  const totalPages = Number(rawBook.totalPages)
  const zoom = Number(rawBook.zoom)
  const signature = String(rawBook.signature || "")
  const title = String(rawBook.title || `thu-quan-${documentId}`).trim()

  if (!Number.isInteger(documentId) || documentId <= 0) return null
  if (!Number.isInteger(totalPages) || totalPages <= 0 || totalPages > 2000) return null
  if (!Number.isInteger(zoom) || zoom <= 0 || zoom > 20) return null
  if (!signature || signature.length > 256) return null

  return {
    documentId,
    totalPages,
    zoom,
    signature,
    title: title.slice(0, 160) || `thu-quan-${documentId}`
  }
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : ""
  } catch {
    return ""
  }
}

function isHlsUrl(url) {
  return /\.m3u8(?:[?#]|$)/i.test(url)
}

async function directDownload(url, filename) {
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    })
    return { ok: true, mode: "direct", downloadId }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  }
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
    return
  }

  if (!chrome.offscreen?.hasDocument) {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT)
    const serviceWorkerGlobal = /** @type {ServiceWorkerGlobalScope} */ (
      /** @type {unknown} */ (globalThis)
    )
    const clientsList = await serviceWorkerGlobal.clients.matchAll()
    if (clientsList.some((client) => client.url === offscreenUrl)) return
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["BLOBS", "DOM_PARSER"],
    justification: "Tạo tệp có thể tải về từ nội dung video hoặc các trang sách người dùng đang xem."
  })
}

function handleHlsReady(message) {
  const job = downloadJobs.get(message.jobId)
  if (!job) return
  job.blobUrl = message.blobUrl
  job.hlsFilename = message.filename || job.filename

  chrome.downloads.download(
    {
      url: message.blobUrl,
      filename: job.preservePath
        ? sanitizeDownloadPath(message.filename || job.filename)
        : sanitizeFilename(message.filename || job.filename),
      conflictAction: job.preservePath ? "overwrite" : "uniquify",
      saveAs: false
    },
    (downloadId) => {
      job.downloadId = downloadId
      const error = chrome.runtime.lastError?.message
      if (error) {
        if (retryHlsSave(message.jobId, downloadId, error)) return
        forwardProgress({
          type: "ou-yeah-hls-progress",
          jobId: message.jobId,
          status: "error",
          label: /FILE_TRANSIENT_ERROR/i.test(error)
            ? "Chrome vẫn gián đoạn khi lưu video sau nhiều lần thử. Hãy thử lại mục này."
            : error
        })
        downloadJobs.delete(message.jobId)
      } else if (job.preservePath) {
        trackedDownloads.set(downloadId, message.jobId)
        chrome.downloads.search({ id: downloadId })
          .catch(() => [])
          .then(([download]) => {
            if (trackedDownloads.get(downloadId) !== message.jobId) return

            if (download?.state === "complete") {
              forwardProgress({
                jobId: message.jobId,
                status: "complete",
                label: "Đã tải xong.",
                percent: 100,
                downloadId
              })
              trackedDownloads.delete(downloadId)
              downloadJobs.delete(message.jobId)
              return
            }

            if (download?.state === "interrupted") {
              if (retryHlsSave(message.jobId, downloadId, download.error || "")) return
              forwardProgress({
                jobId: message.jobId,
                status: "error",
                label: download.error || "Tệp video đã bị gián đoạn.",
                downloadId
              })
              trackedDownloads.delete(downloadId)
              downloadJobs.delete(message.jobId)
              return
            }

            forwardProgress({
              jobId: message.jobId,
              status: "downloading",
              label: "Đang lưu video vào Downloads...",
              percent: 99,
              downloadId
            })
          })
          .catch((searchError) => {
            forwardProgress({
              jobId: message.jobId,
              status: "error",
              label: readableError(searchError),
              downloadId
            })
            trackedDownloads.delete(downloadId)
            downloadJobs.delete(message.jobId)
          })
      } else {
        forwardProgress({
          type: "ou-yeah-hls-progress",
          jobId: message.jobId,
          status: "complete",
          label: "Đã gửi video sang Downloads.",
          downloadId
        })
        downloadJobs.delete(message.jobId)
      }

      setTimeout(() => {
        revokeOffscreenObjectUrl(message.blobUrl)
      }, 60_000)
    }
  )
}

function retryHlsSave(jobId, downloadId, error) {
  const job = downloadJobs.get(jobId)
  if (!job?.blobUrl || job.mode !== "hls" || !/FILE_TRANSIENT_ERROR/i.test(error) || (job.hlsSaveRetries || 0) >= 2) {
    return false
  }

  job.hlsSaveRetries = (job.hlsSaveRetries || 0) + 1
  if (downloadId != null) trackedDownloads.delete(downloadId)
  forwardProgress({
    type: "ou-yeah-hls-progress",
    jobId,
    status: "building",
    label: `Chrome gián đoạn khi lưu video. Đang thử lại lần ${job.hlsSaveRetries}/2...`,
    percent: 99
  })
  setTimeout(() => handleHlsReady({
    jobId,
    blobUrl: job.blobUrl,
    filename: job.hlsFilename || job.filename
  }), 1200 * job.hlsSaveRetries)
  return true
}

function handleBookPdfReady(message) {
  const job = downloadJobs.get(message.jobId)
  if (!job || job.kind !== "book") return

  chrome.downloads.download(
    {
      url: message.blobUrl,
      filename: ensurePdfFilename(message.filename || job.filename),
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      const error = chrome.runtime.lastError?.message
      if (error) {
        forwardBookProgress({
          jobId: message.jobId,
          status: "error",
          label: error
        })
      } else {
        forwardBookProgress({
          jobId: message.jobId,
          status: "complete",
          label: "Đã gửi sách PDF sang Downloads.",
          percent: 100,
          downloadId
        })
      }

      setTimeout(() => {
        revokeOffscreenObjectUrl(message.blobUrl)
      }, 60_000)

      downloadJobs.delete(message.jobId)
    }
  )
}

function revokeOffscreenObjectUrl(blobUrl) {
  chrome.runtime.sendMessage({
    type: "ou-yeah-revoke-object-url",
    blobUrl
  }).catch(() => {})
}

function forwardProgress(message) {
  const job = downloadJobs.get(message.jobId)
  if (!job?.tabId) return

  chrome.tabs.sendMessage(
    job.tabId,
    {
      type: "ou-yeah-download-progress",
      jobId: message.jobId,
      status: message.status,
      label: message.label,
      loaded: message.loaded,
      total: message.total,
      percent: message.percent
    },
    job.frameId == null ? undefined : { frameId: job.frameId }
  ).catch(() => {})
}

function forwardBookProgress(message) {
  const job = downloadJobs.get(message.jobId)
  if (!job?.tabId || job.kind !== "book") return

  chrome.tabs.sendMessage(
    job.tabId,
    {
      type: "ou-yeah-book-progress",
      jobId: message.jobId,
      status: message.status,
      label: message.label,
      loaded: message.loaded,
      total: message.total,
      percent: message.percent
    },
    job.frameId == null ? undefined : { frameId: job.frameId }
  ).catch(() => {})
}

function filenameFromUrl(url, pageTitle = "ou-yeah-video") {
  const parsed = new URL(url)
  const pathName = decodeURIComponent(parsed.pathname.split("/").pop() || "")
  const baseFromPath = pathName.replace(/\.(m3u8|mpd)(?:[?#].*)?$/i, "") || pageTitle
  const extension = isHlsUrl(url)
    ? ".ts"
    : extensionFromPath(pathName) || ".mp4"
  return `${baseFromPath}${extensionFromPath(baseFromPath) ? "" : extension}`
}

function extensionFromPath(pathName) {
  const match = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(pathName)
  return match ? `.${match[1].toLowerCase()}` : ""
}

function sanitizeFilename(filename) {
  const cleaned = String(filename || "ou-yeah-video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.slice(0, 170) || "ou-yeah-video.mp4"
}

function sanitizeDownloadPath(filename) {
  const segments = String(filename || "OU Yeah!/hoc-lieu")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .slice(0, 12)

  return compactDownloadPath(segments, 180) || "OU Yeah!/hoc-lieu"
}

function compactDownloadPath(segments, maxLength) {
  const compacted = segments.map((segment) => String(segment))
  let joined = compacted.join("/")
  while (joined.length > maxLength) {
    const directoryIndexes = compacted
      .slice(1, -1)
      .map((segment, offset) => ({ index: offset + 1, length: segment.length }))
      .filter((entry) => entry.length > 10)
      .sort((a, b) => b.length - a.length)
    const target = directoryIndexes[0]
    if (!target) break
    const excess = joined.length - maxLength
    compacted[target.index] = truncateDownloadSegment(
      compacted[target.index],
      Math.max(10, compacted[target.index].length - excess),
      false
    )
    joined = compacted.join("/")
  }

  if (joined.length > maxLength && compacted.length) {
    const leafIndex = compacted.length - 1
    const excess = joined.length - maxLength
    compacted[leafIndex] = truncateDownloadSegment(
      compacted[leafIndex],
      Math.max(16, compacted[leafIndex].length - excess),
      true
    )
  }
  return compacted.join("/")
}

function truncateDownloadSegment(segment, maxLength, preserveExtension) {
  if (segment.length <= maxLength) return segment
  const extension = preserveExtension ? /\.[a-z0-9]{1,8}$/i.exec(segment)?.[0] || "" : ""
  const available = Math.max(1, maxLength - extension.length)
  return `${segment.slice(0, available).trimEnd()}${extension}`
}

function sanitizePathSegment(segment) {
  return String(segment || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120)
}

function ensurePdfFilename(filename) {
  const cleaned = sanitizeFilename(String(filename || "thu-quan-ou").replace(/\.pdf$/i, ""))
  return `${cleaned || "thu-quan-ou"}.pdf`
}

function readableError(error) {
  if (chrome.runtime.lastError?.message) return chrome.runtime.lastError.message
  if (error instanceof Error) return error.message
  return String(error || "Đã có lỗi xảy ra.")
}
