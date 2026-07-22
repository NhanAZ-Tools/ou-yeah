const HLS_VARIANT_RE = /^#EXT-X-STREAM-INF:(.*)$/i;
const HLS_KEY_RE = /^#EXT-X-KEY:(.*)$/i;
const HLS_MAP_RE = /^#EXT-X-MAP:(.*)$/i;
const HLS_BYTERANGE_RE = /^#EXT-X-BYTERANGE:(.*)$/i;

const objectUrls = new Set();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ou-yeah-download-hls") {
    downloadHls(message).catch((error) => {
      sendError(message.jobId, readableError(error));
    });
  }

  if (message?.type === "ou-yeah-build-book-pdf") {
    buildBookPdf(message).catch((error) => {
      sendBookError(message.jobId, readableError(error));
    });
  }

  if (message?.type === "ou-yeah-revoke-object-url" && message.blobUrl) {
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
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(4, playlist.segments.length) },
    () => worker()
  );

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

  sendRuntimeMessageSafely({
    type: "ou-yeah-hls-ready",
    jobId,
    blobUrl,
    filename: ensureExtension(filename, playlist.extension)
  });
}

async function buildBookPdf({ jobId, book, filename }) {
  const totalPages = Number(book?.totalPages || 0);
  if (!Number.isInteger(totalPages) || totalPages <= 0) {
    throw new Error("Số trang sách không hợp lệ.");
  }

  sendBookProgress(jobId, "preparing", `Đang chuẩn bị ${totalPages} trang...`, 0, 0, totalPages);

  const pages = new Array(totalPages);
  const workerCount = Math.min(4, totalPages);
  let nextIndex = 0;
  let completed = 0;
  let loadedBytes = 0;
  let lastPercent = -1;

  async function worker() {
    while (nextIndex < totalPages) {
      const index = nextIndex;
      nextIndex += 1;
      const pageNumber = index + 1;
      const buffer = await fetchBookPage(book, pageNumber);
      const bytes = new Uint8Array(buffer);
      const jpeg = readJpegInfo(bytes, pageNumber);

      pages[index] = { bytes, ...jpeg };
      completed += 1;
      loadedBytes += bytes.byteLength;

      const percent = Math.min(92, Math.round((completed / totalPages) * 92));
      if (percent !== lastPercent || completed === totalPages) {
        lastPercent = percent;
        sendBookProgress(
          jobId,
          "downloading",
          `Đang tải trang ${completed}/${totalPages}...`,
          percent,
          completed,
          totalPages
        );
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  sendBookProgress(
    jobId,
    "building",
    "Đang đóng gói các trang thành PDF...",
    96,
    loadedBytes,
    totalPages
  );

  const blob = createImagePdf(pages);
  const blobUrl = URL.createObjectURL(blob);
  objectUrls.add(blobUrl);

  sendBookProgress(jobId, "building", "Đang chuyển PDF sang Downloads...", 99, loadedBytes, totalPages);
  sendRuntimeMessageSafely({
    type: "ou-yeah-book-pdf-ready",
    jobId,
    blobUrl,
    filename
  });
}

async function fetchBookPage(book, pageNumber) {
  const url = new URL("https://thuquan.ou.edu.vn/readonline/page.ashx");
  url.searchParams.set("id", String(book.documentId));
  url.searchParams.set("p", String(pageNumber));
  url.searchParams.set("z", String(book.zoom));
  url.searchParams.set("sig", String(book.signature));

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url.href, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Máy chủ trả về lỗi ${response.status}.`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!/image\/jpeg/i.test(contentType)) {
        throw new Error("Máy chủ không trả về ảnh JPEG.");
      }

      return response.arrayBuffer();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(250 * attempt);
    }
  }

  throw new Error(`Không tải được trang ${pageNumber}: ${readableError(lastError)}`);
}

function readJpegInfo(bytes, pageNumber) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Trang ${pageNumber} không phải ảnh JPEG hợp lệ.`);
  }

  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf
  ]);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.length) break;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    if (sofMarkers.has(marker)) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!width || !height || !components) break;
      return { width, height, components };
    }

    offset += segmentLength;
  }

  throw new Error(`Không đọc được kích thước ảnh ở trang ${pageNumber}.`);
}

function createImagePdf(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const objectCount = 2 + pages.length * 3;
  const offsets = new Array(objectCount + 1).fill(0);
  let byteOffset = 0;

  function append(value) {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
  }

  function beginObject(objectNumber) {
    offsets[objectNumber] = byteOffset;
    append(`${objectNumber} 0 obj\n`);
  }

  append("%PDF-1.4\n%");
  append(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObject(1);
  append("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageReferences = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  beginObject(2);
  append(`<< /Type /Pages /Count ${pages.length} /Kids [${pageReferences}] >>\nendobj\n`);

  pages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const pageSize = fitPdfPage(page.width, page.height);
    const pageWidth = formatPdfNumber(pageSize.width);
    const pageHeight = formatPdfNumber(pageSize.height);
    const content = encoder.encode(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);

    beginObject(pageObject);
    append(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
      + `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> `
      + `/Contents ${contentObject} 0 R >>\nendobj\n`
    );

    beginObject(imageObject);
    append(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} `
      + `${pdfColorSpace(page.components)} /BitsPerComponent 8 /Filter /DCTDecode `
      + `/Length ${page.bytes.byteLength} >>\nstream\n`
    );
    append(page.bytes);
    append("\nendstream\nendobj\n");

    beginObject(contentObject);
    append(`<< /Length ${content.byteLength} >>\nstream\n`);
    append(content);
    append("endstream\nendobj\n");
  });

  const xrefOffset = byteOffset;
  append(`xref\n0 ${objectCount + 1}\n`);
  append("0000000000 65535 f \n");
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    append(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
  }
  append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`);
  append(`startxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

function fitPdfPage(imageWidth, imageHeight) {
  const landscape = imageWidth > imageHeight;
  const maxWidth = landscape ? 841.89 : 595.28;
  const maxHeight = landscape ? 595.28 : 841.89;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  return {
    width: imageWidth * scale,
    height: imageHeight * scale
  };
}

function pdfColorSpace(components) {
  if (components === 1) return "/ColorSpace /DeviceGray";
  if (components === 4) {
    return "/ColorSpace /DeviceCMYK /Decode [1 0 1 0 1 0 1 0]";
  }
  return "/ColorSpace /DeviceRGB";
}

function formatPdfNumber(value) {
  return Number(value.toFixed(2)).toString();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const headers = new Headers();
  if (segment.range) {
    headers.set("Range", `bytes=${segment.range.start}-${segment.range.end}`);
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
  const cleaned = String(filename || "ou-yeah-video").replace(/\.(m3u8|mpd)$/i, "");
  if (/\.(mp4|m4v|webm|mov|mkv|ts)$/i.test(cleaned)) return cleaned;
  return `${cleaned}${extension || ".ts"}`;
}

function sendProgress(jobId, status, label, percent, loaded, total) {
  sendRuntimeMessageSafely({
    type: "ou-yeah-hls-progress",
    jobId,
    status,
    label,
    percent,
    loaded,
    total
  });
}

function sendError(jobId, error) {
  sendRuntimeMessageSafely({
    type: "ou-yeah-hls-error",
    jobId,
    error
  });
}

function sendBookProgress(jobId, status, label, percent, loaded, total) {
  sendRuntimeMessageSafely({
    type: "ou-yeah-book-progress",
    jobId,
    status,
    label,
    percent,
    loaded,
    total
  });
}

function sendBookError(jobId, error) {
  sendRuntimeMessageSafely({
    type: "ou-yeah-book-pdf-error",
    jobId,
    error
  });
}

function sendRuntimeMessageSafely(message) {
  try {
    const pending = chrome.runtime.sendMessage(message);
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  } catch {
    // Reloading/disabling the extension invalidates this offscreen context.
  }
}

function readableError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Đã có lỗi xảy ra.");
}
