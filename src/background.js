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
    if (!isFromSupportedPage(details)) return;
    if (MEDIA_URL_RE.test(details.url)) {
      rememberMedia(details.tabId, details.url, `network:${details.type}`);
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isFromSupportedPage(details)) return;

    const contentType = (details.responseHeaders || [])
      .find((header) => header.name.toLowerCase() === "content-type")
      ?.value || "";

    if (MEDIA_URL_RE.test(details.url) || MEDIA_MIME_RE.test(contentType)) {
      rememberMedia(details.tabId, details.url, `headers:${contentType || details.type}`);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "elolms-pulse-hud" });
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
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "elolms-get-media-candidates") {
    const tabId = sender.tab?.id;
    sendResponse({
      ok: true,
      candidates: tabId == null ? [] : tabMedia.get(tabId) || []
    });
    return false;
  }

  if (message.type === "elolms-download-media") {
    handleDownloadRequest(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "elolms-hls-progress") {
    forwardProgress(message);
    return false;
  }

  if (message.type === "elolms-hls-ready") {
    handleHlsReady(message);
    return false;
  }

  if (message.type === "elolms-hls-error") {
    forwardProgress({
      type: "elolms-hls-progress",
      jobId: message.jobId,
      status: "error",
      label: message.error || "Không thể tải luồng video."
    });
    downloadJobs.delete(message.jobId);
    return false;
  }

  return false;
});

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
        type: "elolms-download-hls",
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
    const clientsList = await clients.matchAll();
    if (clientsList.some((client) => client.url === offscreenUrl)) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["BLOBS", "DOM_PARSER"],
    justification: "Gom các segment HLS thành một tệp video có thể tải về."
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
          type: "elolms-hls-progress",
          jobId: message.jobId,
          status: "error",
          label: error
        });
      } else {
        forwardProgress({
          type: "elolms-hls-progress",
          jobId: message.jobId,
          status: "complete",
          label: "Đã gửi video sang Downloads.",
          downloadId
        });
      }

      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "elolms-revoke-object-url",
          blobUrl: message.blobUrl
        }).catch(() => {});
      }, 60_000);

      downloadJobs.delete(message.jobId);
    }
  );
}

function forwardProgress(message) {
  const job = downloadJobs.get(message.jobId);
  if (!job?.tabId) return;

  chrome.tabs.sendMessage(
    job.tabId,
    {
      type: "elolms-download-progress",
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

function filenameFromUrl(url, pageTitle = "elolms-video") {
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
  const cleaned = String(filename || "elolms-video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 170) || "elolms-video.mp4";
}

function readableError(error) {
  if (chrome.runtime.lastError?.message) return chrome.runtime.lastError.message;
  if (error instanceof Error) return error.message;
  return String(error || "Đã có lỗi xảy ra.");
}
