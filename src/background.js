const ALLOWED_HOSTS = new Set(["elolms.ou.edu.vn", "player.vimeo.com"]);
const OFFSCREEN_DOCUMENT = "src/offscreen.html";
const MEDIA_URL_RE = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)(?:[?#]|$)/i;
const MEDIA_MIME_RE = /(?:video|mpegurl|dash\+xml|mp2t)/i;

const tabMedia = new Map();
const downloadJobs = new Map();

function isFromSupportedPage(details) {
  return [details.initiator, details.documentUrl, details.originUrl, details.url]
    .filter(Boolean)
    .some((value) => {
      try {
        return ALLOWED_HOSTS.has(new URL(value).hostname);
      } catch {
        return String(value).includes("elolms.ou.edu.vn") || String(value).includes("player.vimeo.com");
      }
    });
}

function rememberMedia(tabId, url, source) {
  if (tabId < 0 || !url) return;

  const current = tabMedia.get(tabId) || [];
  const next = current.filter((item) => item.url !== url);
  next.unshift({
    url,
    source,
    seenAt: Date.now()
  });
  tabMedia.set(tabId, next.slice(0, 40));
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isFromSupportedPage(details)) return {};
    if (MEDIA_URL_RE.test(details.url)) {
      rememberMedia(details.tabId, details.url, `network:${details.type}`);
    }
    return {};
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isFromSupportedPage(details)) return {};

    const contentType = (details.responseHeaders || [])
      .find((header) => header.name.toLowerCase() === "content-type")
      ?.value || "";

    if (MEDIA_URL_RE.test(details.url) || MEDIA_MIME_RE.test(contentType)) {
      rememberMedia(details.tabId, details.url, `headers:${contentType || details.type}`);
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab).catch(() => {});
});

async function handleActionClick(tab) {
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ou-yeah-pulse-hud" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["src/content.js"]
      });
    } catch {
      // The active page may not allow script injection. Nothing useful to do here.
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "ou-yeah-get-media-candidates") {
    const tabId = sender.tab?.id;
    sendResponse({
      ok: true,
      candidates: tabId == null ? [] : tabMedia.get(tabId) || []
    });
    return false;
  }

  if (message.type === "ou-yeah-download-media") {
    respondToAsyncRequest(handleDownloadRequest(message, sender), sendResponse);
    return true;
  }

  if (message.type === "ou-yeah-download-book-pdf") {
    respondToAsyncRequest(handleBookPdfRequest(message, sender), sendResponse);
    return true;
  }

  if (message.type === "ou-yeah-hls-progress") {
    forwardProgress(message);
    return false;
  }

  if (message.type === "ou-yeah-hls-ready") {
    handleHlsReady(message);
    return false;
  }

  if (message.type === "ou-yeah-hls-error") {
    forwardProgress({
      type: "ou-yeah-hls-progress",
      jobId: message.jobId,
      status: "error",
      label: message.error || "Không thể tải luồng video."
    });
    downloadJobs.delete(message.jobId);
    return false;
  }

  if (message.type === "ou-yeah-book-progress") {
    forwardBookProgress(message);
    return false;
  }

  if (message.type === "ou-yeah-book-pdf-ready") {
    handleBookPdfReady(message);
    return false;
  }

  if (message.type === "ou-yeah-book-pdf-error") {
    forwardBookProgress({
      jobId: message.jobId,
      status: "error",
      label: message.error || "Không thể tạo tệp PDF."
    });
    downloadJobs.delete(message.jobId);
    return false;
  }

  return false;
});

function respondToAsyncRequest(pending, sendResponse) {
  pending
    .then((response) => {
      try {
        sendResponse(response);
      } catch {
        // The sender can disappear while the async job is starting.
      }
    })
    .catch((error) => {
      try {
        sendResponse({ ok: false, error: readableError(error) });
      } catch {
        // The message channel was already closed.
      }
    });
}

async function handleDownloadRequest(message, sender) {
  const url = normalizeUrl(message.url);
  if (!url) {
    return { ok: false, error: "Không tìm thấy link video hợp lệ." };
  }

  const filename = sanitizeFilename(message.filename || filenameFromUrl(url, message.pageTitle));
  rememberMedia(sender.tab?.id ?? -1, url, "download-click");

  if (isHlsUrl(url)) {
    const jobId = crypto.randomUUID();
    downloadJobs.set(jobId, {
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      filename
    });

    try {
      await ensureOffscreenDocument();
      await chrome.runtime.sendMessage({
        type: "ou-yeah-download-hls",
        jobId,
        url,
        filename
      });
      return { ok: true, mode: "hls", jobId };
    } catch (error) {
      downloadJobs.delete(jobId);
      return { ok: false, error: readableError(error) };
    }
  }

  return directDownload(url, filename);
}

async function handleBookPdfRequest(message, sender) {
  const book = normalizeBookConfig(message.book);
  if (!book) {
    return { ok: false, error: "Cấu hình sách không hợp lệ." };
  }

  const senderUrl = normalizeUrl(sender.url || sender.tab?.url);
  if (!senderUrl || new URL(senderUrl).hostname !== "thuquan.ou.edu.vn") {
    return { ok: false, error: "Yêu cầu tải sách không đến từ Thư Quán OU." };
  }

  const jobId = crypto.randomUUID();
  const filename = ensurePdfFilename(message.filename || book.title);
  downloadJobs.set(jobId, {
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    filename,
    kind: "book"
  });

  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: "ou-yeah-build-book-pdf",
      jobId,
      book,
      filename
    });
    return { ok: true, mode: "book-pdf", jobId };
  } catch (error) {
    downloadJobs.delete(jobId);
    return { ok: false, error: readableError(error) };
  }
}

function normalizeBookConfig(rawBook) {
  if (!rawBook || typeof rawBook !== "object") return null;

  const documentId = Number(rawBook.documentId);
  const totalPages = Number(rawBook.totalPages);
  const zoom = Number(rawBook.zoom);
  const signature = String(rawBook.signature || "");
  const title = String(rawBook.title || `thu-quan-${documentId}`).trim();

  if (!Number.isInteger(documentId) || documentId <= 0) return null;
  if (!Number.isInteger(totalPages) || totalPages <= 0 || totalPages > 2000) return null;
  if (!Number.isInteger(zoom) || zoom <= 0 || zoom > 20) return null;
  if (!signature || signature.length > 256) return null;

  return {
    documentId,
    totalPages,
    zoom,
    signature,
    title: title.slice(0, 160) || `thu-quan-${documentId}`
  };
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function isHlsUrl(url) {
  return /\.m3u8(?:[?#]|$)/i.test(url);
}

async function directDownload(url, filename) {
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    return { ok: true, mode: "direct", downloadId };
  } catch (error) {
    return { ok: false, error: readableError(error) };
  }
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  if (!chrome.offscreen?.hasDocument) {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
    const serviceWorkerGlobal = /** @type {ServiceWorkerGlobalScope} */ (
      /** @type {unknown} */ (globalThis)
    );
    const clientsList = await serviceWorkerGlobal.clients.matchAll();
    if (clientsList.some((client) => client.url === offscreenUrl)) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["BLOBS", "DOM_PARSER"],
    justification: "Tạo tệp có thể tải về từ nội dung video hoặc các trang sách người dùng đang xem."
  });
}

function handleHlsReady(message) {
  const job = downloadJobs.get(message.jobId);
  if (!job) return;

  chrome.downloads.download(
    {
      url: message.blobUrl,
      filename: sanitizeFilename(message.filename || job.filename),
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        forwardProgress({
          type: "ou-yeah-hls-progress",
          jobId: message.jobId,
          status: "error",
          label: error
        });
      } else {
        forwardProgress({
          type: "ou-yeah-hls-progress",
          jobId: message.jobId,
          status: "complete",
          label: "Đã gửi video sang Downloads.",
          downloadId
        });
      }

      setTimeout(() => {
        revokeOffscreenObjectUrl(message.blobUrl);
      }, 60_000);

      downloadJobs.delete(message.jobId);
    }
  );
}

function handleBookPdfReady(message) {
  const job = downloadJobs.get(message.jobId);
  if (!job || job.kind !== "book") return;

  chrome.downloads.download(
    {
      url: message.blobUrl,
      filename: ensurePdfFilename(message.filename || job.filename),
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        forwardBookProgress({
          jobId: message.jobId,
          status: "error",
          label: error
        });
      } else {
        forwardBookProgress({
          jobId: message.jobId,
          status: "complete",
          label: "Đã gửi sách PDF sang Downloads.",
          percent: 100,
          downloadId
        });
      }

      setTimeout(() => {
        revokeOffscreenObjectUrl(message.blobUrl);
      }, 60_000);

      downloadJobs.delete(message.jobId);
    }
  );
}

function revokeOffscreenObjectUrl(blobUrl) {
  chrome.runtime.sendMessage({
    type: "ou-yeah-revoke-object-url",
    blobUrl
  }).catch(() => {});
}

function forwardProgress(message) {
  const job = downloadJobs.get(message.jobId);
  if (!job?.tabId) return;

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
  ).catch(() => {});
}

function forwardBookProgress(message) {
  const job = downloadJobs.get(message.jobId);
  if (!job?.tabId || job.kind !== "book") return;

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
  ).catch(() => {});
}

function filenameFromUrl(url, pageTitle = "ou-yeah-video") {
  const parsed = new URL(url);
  const pathName = decodeURIComponent(parsed.pathname.split("/").pop() || "");
  const baseFromPath = pathName.replace(/\.(m3u8|mpd)(?:[?#].*)?$/i, "") || pageTitle;
  const extension = isHlsUrl(url)
    ? ".ts"
    : extensionFromPath(pathName) || ".mp4";
  return `${baseFromPath}${extensionFromPath(baseFromPath) ? "" : extension}`;
}

function extensionFromPath(pathName) {
  const match = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(pathName);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function sanitizeFilename(filename) {
  const cleaned = String(filename || "ou-yeah-video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 170) || "ou-yeah-video.mp4";
}

function ensurePdfFilename(filename) {
  const cleaned = sanitizeFilename(String(filename || "thu-quan-ou").replace(/\.pdf$/i, ""));
  return `${cleaned || "thu-quan-ou"}.pdf`;
}

function readableError(error) {
  if (chrome.runtime.lastError?.message) return chrome.runtime.lastError.message;
  if (error instanceof Error) return error.message;
  return String(error || "Đã có lỗi xảy ra.");
}
