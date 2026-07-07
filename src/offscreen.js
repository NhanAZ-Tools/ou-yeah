const HLS_VARIANT_RE = /^#EXT-X-STREAM-INF:(.*)$/i;
const HLS_KEY_RE = /^#EXT-X-KEY:(.*)$/i;
const HLS_MAP_RE = /^#EXT-X-MAP:(.*)$/i;
const HLS_BYTERANGE_RE = /^#EXT-X-BYTERANGE:(.*)$/i;

const objectUrls = new Set();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "elolms-download-hls") {
    downloadHls(message).catch((error) => {
      sendError(message.jobId, readableError(error));
    });
  }

  if (message?.type === "elolms-revoke-object-url" && message.blobUrl) {
    URL.revokeObjectURL(message.blobUrl);
    objectUrls.delete(message.blobUrl);
  }
});

async function downloadHls({ jobId, url, filename }) {
  sendProgress(jobId, "preparing", "Đang đọc playlist HLS...", 0);

  const playlist = await loadPlaylist(url, 0);
  if (playlist.encrypted) {
    throw new Error("Playlist HLS đang mã hóa, extension không thể giải mã an toàn.");
  }

  if (!playlist.segments.length) {
    throw new Error("Không tìm thấy segment video trong playlist.");
  }

  const buffers = new Array(playlist.segments.length);
  let completed = 0;
  let loadedBytes = 0;
  const workers = Array.from(
    { length: Math.min(4, playlist.segments.length) },
    () => worker()
  );
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < playlist.segments.length) {
      const index = nextIndex;
      nextIndex += 1;

      const segment = playlist.segments[index];
      const buffer = await fetchSegment(segment);
      buffers[index] = buffer;
      completed += 1;
      loadedBytes += buffer.byteLength;
      sendProgress(
        jobId,
        "downloading",
        `Đang gom video ${completed}/${playlist.segments.length} đoạn...`,
        Math.round((completed / playlist.segments.length) * 100),
        loadedBytes,
        playlist.segments.length
      );
    }
  }

  await Promise.all(workers);

  sendProgress(jobId, "building", "Đang tạo tệp video...", 99, loadedBytes, playlist.segments.length);

  const blob = new Blob(buffers, { type: playlist.mime });
  const blobUrl = URL.createObjectURL(blob);
  objectUrls.add(blobUrl);

  chrome.runtime.sendMessage({
    type: "elolms-hls-ready",
    jobId,
    blobUrl,
    filename: ensureExtension(filename, playlist.extension)
  });
}

async function loadPlaylist(url, depth) {
  if (depth > 4) throw new Error("Playlist HLS lồng quá sâu.");

  const text = await fetchText(url);
  if (!/^#EXTM3U/m.test(text)) {
    throw new Error("Dữ liệu nhận được không phải playlist HLS.");
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = HLS_VARIANT_RE.exec(lines[index]);
    if (!match) continue;

    const attrs = parseAttributes(match[1]);
    const nextUri = findNextUri(lines, index + 1);
    if (nextUri) {
      variants.push({
        url: resolveUrl(nextUri, url),
        bandwidth: Number(attrs.BANDWIDTH || 0),
        resolution: attrs.RESOLUTION || ""
      });
    }
  }

  if (variants.length) {
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return loadPlaylist(variants[0].url, depth + 1);
  }

  return parseMediaPlaylist(lines, url);
}

function parseMediaPlaylist(lines, playlistUrl) {
  const segments = [];
  let encrypted = false;
  let pendingRange = null;
  let rangeOffset = 0;
  let sawMap = false;
  let mime = "video/mp2t";
  let extension = ".ts";

  for (const line of lines) {
    const keyMatch = HLS_KEY_RE.exec(line);
    if (keyMatch) {
      const attrs = parseAttributes(keyMatch[1]);
      const method = String(attrs.METHOD || "NONE").toUpperCase();
      if (method && method !== "NONE") encrypted = true;
      continue;
    }

    const mapMatch = HLS_MAP_RE.exec(line);
    if (mapMatch) {
      const attrs = parseAttributes(mapMatch[1]);
      if (attrs.URI && !sawMap) {
        const range = parseRange(attrs.BYTERANGE, 0);
        segments.push({
          url: resolveUrl(attrs.URI, playlistUrl),
          range
        });
        sawMap = true;
        mime = "video/mp4";
        extension = ".mp4";
      }
      continue;
    }

    const rangeMatch = HLS_BYTERANGE_RE.exec(line);
    if (rangeMatch) {
      pendingRange = parseRange(rangeMatch[1], rangeOffset);
      rangeOffset = pendingRange.end + 1;
      continue;
    }

    if (!line.startsWith("#")) {
      const segmentUrl = resolveUrl(line, playlistUrl);
      if (/\.(m4s|mp4)(?:[?#]|$)/i.test(segmentUrl)) {
        mime = "video/mp4";
        extension = ".mp4";
      }
      segments.push({
        url: segmentUrl,
        range: pendingRange
      });
      pendingRange = null;
    }
  }

  return { segments, encrypted, mime, extension };
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Không đọc được playlist (${response.status}).`);
  return response.text();
}

async function fetchSegment(segment) {
  const headers = {};
  if (segment.range) {
    headers.Range = `bytes=${segment.range.start}-${segment.range.end}`;
  }

  const response = await fetch(segment.url, {
    credentials: "include",
    cache: "no-store",
    headers
  });

  if (!response.ok) {
    throw new Error(`Không tải được segment (${response.status}).`);
  }

  return response.arrayBuffer();
}

function findNextUri(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#")) return lines[index];
  }
  return "";
}

function parseAttributes(value) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = re.exec(value))) {
    attrs[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return attrs;
}

function parseRange(value, fallbackOffset) {
  if (!value) return null;

  const [lengthText, offsetText] = String(value).split("@");
  const length = Number(lengthText);
  const start = offsetText == null ? fallbackOffset : Number(offsetText);
  return {
    start,
    end: start + length - 1
  };
}

function resolveUrl(value, baseUrl) {
  return new URL(value, baseUrl).href;
}

function ensureExtension(filename, extension) {
  const cleaned = String(filename || "elolms-video").replace(/\.(m3u8|mpd)$/i, "");
  if (/\.(mp4|m4v|webm|mov|mkv|ts)$/i.test(cleaned)) return cleaned;
  return `${cleaned}${extension || ".ts"}`;
}

function sendProgress(jobId, status, label, percent, loaded, total) {
  chrome.runtime.sendMessage({
    type: "elolms-hls-progress",
    jobId,
    status,
    label,
    percent,
    loaded,
    total
  });
}

function sendError(jobId, error) {
  chrome.runtime.sendMessage({
    type: "elolms-hls-error",
    jobId,
    error
  });
}

function readableError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Đã có lỗi xảy ra.");
}
