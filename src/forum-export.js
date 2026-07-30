(() => {
  "use strict";

  const APP = "ou-yeah";
  const STYLE_ID = "ou-yeah-forum-export-style";
  const TOOLBAR_ID = "ou-yeah-forum-export-toolbar";
  const FORMAT_VERSION = "ou-yeah-forum-export-v2";
  const MAX_LIST_PAGES = 100;
  const MAX_DISCUSSION_PAGES = 100;
  const ASSET_DOWNLOAD_WORKERS = 3;
  const IS_TOP_FRAME = window.top === window.self;
  const IS_ELOLMS_FORUM = location.hostname === "elolms.ou.edu.vn"
    && /^\/mod\/forum\/(?:view|discuss)\.php$/i.test(location.pathname);
  const IS_FORUM_VIEW = /\/mod\/forum\/view\.php$/i.test(location.pathname);
  const IS_DISCUSSION_VIEW = /\/mod\/forum\/discuss\.php$/i.test(location.pathname);

  if (!IS_TOP_FRAME || !IS_ELOLMS_FORUM) return;

  let mountTimer = 0;
  let exportRunning = false;
  let statusResetTimer = 0;
  let mountObserver = null;

  injectForumExportTheme();
  mountForumExportControls();

  if (!mountObserver) {
    mountObserver = new MutationObserver(scheduleMount);
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleMount() {
    if (mountTimer) return;

    mountTimer = window.setTimeout(() => {
      mountTimer = 0;
      mountForumExportControls();
    }, 80);
  }

  function mountForumExportControls() {
    const main = document.querySelector("[role='main']");
    if (!(main instanceof HTMLElement)) return;

    if (IS_FORUM_VIEW) {
      mountForumToolbar(main);
      mountDiscussionRowButtons(main);
    } else if (IS_DISCUSSION_VIEW) {
      mountDiscussionToolbar(main);
    }
  }

  function mountForumToolbar(main) {
    if (document.getElementById(TOOLBAR_ID)) return;

    const navigationRow = main.querySelector(".tertiary-navigation .row");
    const discussionList = main.querySelector("table.discussion-list")?.closest("[id^='discussion-list-']")
      || main.querySelector("table.discussion-list");
    if (!navigationRow && !discussionList) return;

    const toolbar = createToolbar("Xuất toàn bộ", "forum");
    if (navigationRow instanceof HTMLElement) {
      const navItem = document.createElement("div");
      navItem.className = "navitem ou-yeah-forum-export-navitem";
      navItem.appendChild(toolbar);
      navigationRow.appendChild(navItem);
    } else {
      discussionList?.parentElement?.insertBefore(toolbar, discussionList);
    }
  }

  function mountDiscussionToolbar(main) {
    if (document.getElementById(TOOLBAR_ID)) return;

    const discussionContainer = main.querySelector("[id^='discussion-container-']")
      || main.querySelector("article")?.parentElement;
    if (!(discussionContainer instanceof HTMLElement)) return;

    const toolbar = createToolbar("Xuất chủ đề", "topic");
    discussionContainer.parentElement?.insertBefore(toolbar, discussionContainer);
  }

  function createToolbar(label, scope) {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "ou-yeah-forum-export-toolbar";
    toolbar.innerHTML = `
      <button type="button" class="ou-yeah-forum-export-primary" data-ou-forum-export="${scope}">
        <span class="ou-yeah-forum-export-icon" aria-hidden="true"></span>
        <span>${label}</span>
      </button>
      <div class="ou-yeah-forum-export-progress" data-ou-forum-export-progress hidden aria-live="polite">
        <span class="ou-yeah-forum-export-progress-label">Sẵn sàng</span>
        <span class="ou-yeah-forum-export-progress-track" aria-hidden="true">
          <span class="ou-yeah-forum-export-progress-fill"></span>
        </span>
      </div>
    `;

    const button = toolbar.querySelector("[data-ou-forum-export]");
    button?.addEventListener("click", () => {
      startForumExport(scope, location.href, button).catch(handleUnexpectedExportError);
    });
    return toolbar;
  }

  function mountDiscussionRowButtons(main) {
    const links = main.querySelectorAll("table.discussion-list a[href*='/mod/forum/discuss.php?d=']");
    const seenRows = new WeakSet();

    links.forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const row = link.closest("tr");
      if (!(row instanceof HTMLTableRowElement) || seenRows.has(row)) return;
      seenRows.add(row);
      if (row.querySelector("[data-ou-forum-export='row']")) return;

      const topicLink = row.querySelector("th.topic a[href*='/mod/forum/discuss.php?d='], th[scope='row'] a[href*='/mod/forum/discuss.php?d=']")
        || link;
      if (!(topicLink instanceof HTMLAnchorElement)) return;

      const host = topicLink.parentElement;
      if (!(host instanceof HTMLElement)) return;
      host.classList.add("ou-yeah-forum-export-topic-host");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ou-yeah-forum-export-row";
      button.dataset.ouForumExport = "row";
      button.dataset.discussionUrl = canonicalDiscussionUrl(topicLink.href);
      button.title = `Xuất riêng chủ đề “${cleanText(topicLink.textContent)}”`;
      button.setAttribute("aria-label", button.title);
      button.innerHTML = `
        <span class="ou-yeah-forum-export-icon" aria-hidden="true"></span>
        <span>Xuất</span>
      `;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startForumExport("topic", button.dataset.discussionUrl || topicLink.href, button)
          .catch(handleUnexpectedExportError);
      });
      host.appendChild(button);
    });
  }

  async function startForumExport(scope, sourceUrl, trigger) {
    if (exportRunning) return;
    exportRunning = true;
    window.clearTimeout(statusResetTimer);
    setExportButtonsDisabled(true);
    trigger?.classList.add("is-active");

    try {
      updateExportStatus("Đang đọc cấu trúc…", 3, "working");
      const exported = scope === "forum"
        ? await exportWholeForum(sourceUrl)
        : await exportSingleTopic(sourceUrl);

      updateExportStatus("Đang đóng gói ZIP…", 94, "working");
      const bundle = buildExportBundle(exported);
      const zipBlob = createZipBlob(bundle.files);
      downloadBlob(zipBlob, bundle.filename);
      updateExportStatus(`Đã xuất ${exported.topics.length} chủ đề`, 100, "complete");
      statusResetTimer = window.setTimeout(resetExportStatus, 6500);
    } catch (error) {
      console.error(`${APP}: forum export failed`, error);
      updateExportStatus(readableError(error), 100, "error");
      statusResetTimer = window.setTimeout(resetExportStatus, 9000);
    } finally {
      exportRunning = false;
      setExportButtonsDisabled(false);
      trigger?.classList.remove("is-active");
    }
  }

  async function exportWholeForum(sourceUrl) {
    const source = canonicalForumUrl(sourceUrl);
    const listing = await collectForumListing(source, (label, percent) => {
      updateExportStatus(label, percent, "working");
    });

    if (!listing.topics.length) {
      throw new Error("Không tìm thấy chủ đề nào trong diễn đàn này.");
    }

    const topics = [];
    const warnings = [...listing.warnings];
    for (let index = 0; index < listing.topics.length; index += 1) {
      const item = listing.topics[index];
      const percent = 12 + Math.round(((index + 1) / listing.topics.length) * 53);
      updateExportStatus(`Đọc chủ đề ${index + 1}/${listing.topics.length}`, percent, "working");
      try {
        const topic = await collectTopic(item.url);
        if (!topic.subject && item.title) topic.subject = item.title;
        topics.push(topic);
      } catch (error) {
        warnings.push(`Không thể xuất ${item.url}: ${readableError(error)}`);
      }
    }

    if (!topics.length) {
      throw new Error("Không thể đọc nội dung của các chủ đề trong diễn đàn.");
    }

    const exported = {
      format: FORMAT_VERSION,
      scope: "forum",
      exportedAt: new Date().toISOString(),
      sourceUrl: source,
      courseName: listing.courseName || topics[0]?.courseName || "",
      courseCode: listing.courseCode || topics[0]?.courseCode || "",
      forumTitle: listing.forumTitle || topics[0]?.forumTitle || "Diễn đàn thảo luận",
      topics,
      warnings
    };
    await attachExportAssets(exported);
    return exported;
  }

  async function exportSingleTopic(sourceUrl) {
    updateExportStatus("Đang đọc chủ đề…", 24, "working");
    const topic = await collectTopic(sourceUrl);
    const exported = {
      format: FORMAT_VERSION,
      scope: "topic",
      exportedAt: new Date().toISOString(),
      sourceUrl: topic.sourceUrl,
      courseName: topic.courseName,
      courseCode: topic.courseCode,
      forumTitle: topic.forumTitle,
      topics: [topic],
      warnings: []
    };
    await attachExportAssets(exported);
    return exported;
  }

  async function collectForumListing(sourceUrl, onProgress) {
    const forumId = new URL(sourceUrl).searchParams.get("id") || "";
    const queue = [sourceUrl];
    const visited = new Set();
    const topics = new Map();
    const warnings = [];
    let metadata = null;

    while (queue.length && visited.size < MAX_LIST_PAGES) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      onProgress?.(`Đọc danh sách trang ${visited.size}`, Math.min(11, 4 + visited.size));

      let doc;
      try {
        doc = canUseCurrentDocument(pageUrl) ? document : await fetchHtmlDocument(pageUrl);
      } catch (error) {
        warnings.push(`Không thể đọc trang danh sách ${pageUrl}: ${readableError(error)}`);
        continue;
      }

      metadata ||= extractForumMetadata(doc, sourceUrl);
      extractDiscussionLinks(doc).forEach((topic) => {
        if (!topics.has(topic.url)) topics.set(topic.url, topic);
      });

      extractPaginationLinks(doc, "/mod/forum/view.php", "id", forumId).forEach((url) => {
        if (!visited.has(url) && !queue.includes(url)) queue.push(url);
      });
    }

    if (queue.length) warnings.push(`Đã dừng sau ${MAX_LIST_PAGES} trang danh sách để bảo vệ bộ nhớ.`);
    return { ...metadata, topics: Array.from(topics.values()), warnings };
  }

  function extractDiscussionLinks(doc) {
    const table = doc.querySelector("table.discussion-list");
    const root = table || doc.querySelector("[role='main']") || doc;
    const topics = new Map();

    root.querySelectorAll("a[href*='/mod/forum/discuss.php?d=']").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = canonicalDiscussionUrl(link.href);
      const id = new URL(url).searchParams.get("d");
      if (!id || topics.has(url)) return;

      const row = link.closest("tr");
      const preferred = row?.querySelector("th.topic a[href*='/mod/forum/discuss.php?d='], th[scope='row'] a[href*='/mod/forum/discuss.php?d=']");
      const title = cleanText(preferred?.textContent || link.textContent) || `Chủ đề ${id}`;
      topics.set(url, { id, title, url });
    });
    return Array.from(topics.values());
  }

  async function collectTopic(sourceUrl) {
    const canonicalUrl = canonicalDiscussionUrl(sourceUrl);
    const discussionId = new URL(canonicalUrl).searchParams.get("d") || "";
    const queue = [canonicalUrl];
    const visited = new Set();
    const posts = new Map();
    let topic = null;

    while (queue.length && visited.size < MAX_DISCUSSION_PAGES) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      const doc = canUseCurrentDiscussionDocument(pageUrl)
        ? document
        : await fetchHtmlDocument(pageUrl);
      const parsed = extractTopicDocument(doc, canonicalUrl);
      topic ||= parsed;
      parsed.posts.forEach((post) => {
        if (!posts.has(post.id)) posts.set(post.id, post);
      });

      extractPaginationLinks(doc, "/mod/forum/discuss.php", "d", discussionId).forEach((url) => {
        if (!visited.has(url) && !queue.includes(url)) queue.push(url);
      });
    }

    if (!topic || !posts.size) {
      throw new Error("Trang chủ đề không có bài viết có thể xuất.");
    }

    topic.posts = Array.from(posts.values());
    topic.replyCount = Math.max(0, topic.posts.length - 1);
    computeReplyDepths(topic.posts);
    return topic;
  }

  function extractTopicDocument(doc, sourceUrl) {
    const metadata = extractForumMetadata(doc, sourceUrl);
    const discussionId = new URL(sourceUrl).searchParams.get("d") || "";
    const articles = Array.from(doc.querySelectorAll("article"));
    const posts = articles.map((article, index) => extractPost(article, sourceUrl, index)).filter(Boolean);
    const subject = cleanText(
      doc.querySelector("h3.discussionname")?.textContent
      || posts[0]?.subject
      || doc.title.replace(/\s*\|\s*ELOLMS\s*$/i, "")
    );

    return {
      id: discussionId,
      sourceUrl,
      subject,
      slug: slugify(`${discussionId}-${subject}`) || `topic-${discussionId || "export"}`,
      forumTitle: metadata.forumTitle,
      forumUrl: metadata.forumUrl,
      courseName: metadata.courseName,
      courseCode: metadata.courseCode,
      posts,
      replyCount: Math.max(0, posts.length - 1)
    };
  }

  function extractPost(article, sourceUrl, index) {
    const owned = (selector) => Array.from(article.querySelectorAll(selector))
      .filter((node) => node.closest("article") === article);
    const body = owned(".post-content-container")[0];
    if (!(body instanceof HTMLElement)) return null;

    const postId = article.id || `post-${index + 1}`;
    const subject = cleanText(owned("h3")[0]?.textContent) || `Bài viết ${index + 1}`;
    const authorLink = owned("a[href*='/user/view.php']")[0];
    const time = owned("time")[0];
    const postLinks = owned("a[href*='#p']");
    const permalinkLink = postLinks.find((link) => new URL(link.href, sourceUrl).hash === `#${postId}`);
    const parentLink = postLinks.find((link) => {
      const hash = new URL(link.href, sourceUrl).hash;
      return /^#p\d+$/i.test(hash) && hash !== `#${postId}`;
    });
    const images = extractPostImages(body, article, sourceUrl);
    const attachments = extractPostAttachments(article, body, sourceUrl, images);

    return {
      id: postId,
      subject,
      author: cleanText(authorLink?.textContent) || "Không rõ tác giả",
      authorUrl: authorLink?.href || "",
      timeText: cleanText(time?.textContent),
      timeIso: time?.getAttribute("datetime") || "",
      permalink: permalinkLink?.href || `${sourceUrl}#${postId}`,
      replyToPostId: parentLink ? new URL(parentLink.href, sourceUrl).hash.slice(1) : "",
      depth: 0,
      bodyHtml: body.innerHTML,
      contentMarkdown: "",
      images,
      attachments
    };
  }

  function extractPostImages(body, article, sourceUrl) {
    const images = [];
    body.querySelectorAll("img").forEach((img) => {
      if (img.closest("article") !== article) return;
      const rawUrl = img.currentSrc || img.getAttribute("src") || "";
      const url = absoluteUrl(rawUrl, sourceUrl);
      if (!url) return;
      images.push({ sourceUrl: url, alt: cleanText(img.alt) || "Ảnh trong bài viết", assetPath: "", inline: true });
    });
    return dedupeBy(images, (image) => image.sourceUrl);
  }

  function extractPostAttachments(article, body, sourceUrl, images) {
    const imageUrls = new Set(images.map((image) => image.sourceUrl));
    const attachments = [];
    article.querySelectorAll("a[href]").forEach((link) => {
      if (link.closest("article") !== article) return;
      if (body.contains(link) && !/pluginfile\.php/i.test(link.href)) return;
      const url = absoluteUrl(link.getAttribute("href") || "", sourceUrl);
      if (!url || !/pluginfile\.php|draftfile\.php/i.test(url)) return;
      if (/\/user\/icon\//i.test(url) || imageUrls.has(url)) return;

      const name = cleanText(link.textContent) || decodePathFilename(url) || "Tệp đính kèm";
      if (looksLikeImageUrl(url)) {
        images.push({ sourceUrl: url, alt: name, assetPath: "", inline: false });
      } else {
        attachments.push({ name, url, assetPath: "", contentType: "", size: 0 });
      }
    });
    return dedupeBy(attachments, (attachment) => attachment.url);
  }

  function computeReplyDepths(posts) {
    const byId = new Map(posts.map((post) => [post.id, post]));
    posts.forEach((post) => {
      let depth = 0;
      let parentId = post.replyToPostId;
      const seen = new Set([post.id]);
      while (parentId && byId.has(parentId) && !seen.has(parentId) && depth < 12) {
        seen.add(parentId);
        depth += 1;
        parentId = byId.get(parentId)?.replyToPostId || "";
      }
      post.depth = depth;
    });
  }

  async function attachExportAssets(exported) {
    const imagePathMap = await attachImageAssets(exported);
    await attachAttachmentAssets(exported);
    finalizePostMarkdown(exported.topics, imagePathMap);
  }

  async function attachImageAssets(exported) {
    const references = [];
    exported.topics.forEach((topic) => {
      topic.posts.forEach((post) => {
        post.images.forEach((image, index) => references.push({ topic, post, image, index }));
      });
    });

    if (!references.length) {
      exported.imageFiles = [];
      updateExportStatus("Không có ảnh trong bài viết", 79, "working");
      return new Map();
    }

    const unique = new Map();
    references.forEach((reference) => {
      if (unique.has(reference.image.sourceUrl)) return;
      const baseName = `${reference.post.id || "post"}-${reference.index + 1}`;
      unique.set(reference.image.sourceUrl, {
        sourceUrl: reference.image.sourceUrl,
        alt: reference.image.alt,
        desiredPath: `images/${reference.topic.slug}/${sanitizePathSegment(baseName)}`,
        assetPath: "",
        data: null,
        contentType: ""
      });
    });

    const entries = Array.from(unique.values());
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const index = cursor;
        cursor += 1;
        const entry = entries[index];
        try {
          const response = await fetch(entry.sourceUrl, { credentials: "include", redirect: "follow" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          const extension = imageExtension(contentType, entry.sourceUrl);
          entry.assetPath = `${entry.desiredPath}.${extension}`;
          entry.contentType = contentType || `image/${extension}`;
          entry.data = new Uint8Array(await response.arrayBuffer());
        } catch (error) {
          exported.warnings.push(`Không thể tải ảnh ${entry.sourceUrl}: ${readableError(error)}`);
        } finally {
          completed += 1;
          const percent = 66 + Math.round((completed / entries.length) * 13);
          updateExportStatus(`Tải ảnh ${completed}/${entries.length}`, percent, "working");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ASSET_DOWNLOAD_WORKERS, entries.length) }, worker));

    references.forEach(({ image }) => {
      image.assetPath = unique.get(image.sourceUrl)?.assetPath || "";
    });
    exported.imageFiles = entries.filter((entry) => entry.data && entry.assetPath);
    return new Map(entries.map((entry) => [entry.sourceUrl, entry.assetPath]));
  }

  async function attachAttachmentAssets(exported) {
    const references = [];
    exported.topics.forEach((topic) => {
      topic.posts.forEach((post) => {
        post.attachments.forEach((attachment, index) => references.push({ topic, post, attachment, index }));
      });
    });

    if (!references.length) {
      exported.attachmentFiles = [];
      updateExportStatus("Không có tài liệu đính kèm", 92, "working");
      return;
    }

    const unique = new Map();
    references.forEach((reference) => {
      if (unique.has(reference.attachment.url)) return;
      const sourceName = reference.attachment.name || decodePathFilename(reference.attachment.url) || "tep-dinh-kem";
      const filename = sanitizeAttachmentFilename(`${reference.post.id || "post"}-${reference.index + 1}-${sourceName}`);
      unique.set(reference.attachment.url, {
        sourceUrl: reference.attachment.url,
        desiredPath: `attachments/${reference.topic.slug}/${filename}`,
        assetPath: "",
        data: null,
        contentType: "",
        size: 0
      });
    });

    const entries = Array.from(unique.values());
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const index = cursor;
        cursor += 1;
        const entry = entries[index];
        try {
          const response = await fetch(entry.sourceUrl, { credentials: "include", redirect: "follow" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          entry.contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
          entry.data = new Uint8Array(await response.arrayBuffer());
          entry.size = entry.data.length;
          entry.assetPath = entry.desiredPath;
        } catch (error) {
          exported.warnings.push(`Không thể tải tệp ${entry.sourceUrl}: ${readableError(error)}`);
        } finally {
          completed += 1;
          const percent = 79 + Math.round((completed / entries.length) * 13);
          updateExportStatus(`Tải tệp ${completed}/${entries.length}`, percent, "working");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ASSET_DOWNLOAD_WORKERS, entries.length) }, worker));

    references.forEach(({ attachment }) => {
      const downloaded = unique.get(attachment.url);
      attachment.assetPath = downloaded?.assetPath || "";
      attachment.contentType = downloaded?.contentType || "";
      attachment.size = downloaded?.size || 0;
    });
    exported.attachmentFiles = entries.filter((entry) => entry.data && entry.assetPath);
  }

  function finalizePostMarkdown(topics, imagePathMap) {
    topics.forEach((topic) => {
      topic.posts.forEach((post) => {
        post.contentMarkdown = htmlToMarkdown(post.bodyHtml, topic.sourceUrl, imagePathMap);
        delete post.bodyHtml;
      });
    });
  }

  function htmlToMarkdown(html, baseUrl, imagePathMap) {
    const doc = new DOMParser().parseFromString(`<div data-ou-root>${html}</div>`, "text/html");
    const root = doc.querySelector("[data-ou-root]");
    if (!root) return cleanText(doc.body?.textContent);

    const renderChildren = (element, context = {}) => Array.from(element.childNodes)
      .map((node) => renderNode(node, context))
      .join("");

    const renderNode = (node, context = {}) => {
      if (node.nodeType === Node.TEXT_NODE) return normalizeInlineWhitespace(node.textContent || "");
      if (!(node instanceof Element)) return "";

      const tag = node.tagName.toLowerCase();
      if (["script", "style", "noscript", "button", "form"].includes(tag)) return "";
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        return `\n\n${"#".repeat(level)} ${renderChildren(node, context).trim()}\n\n`;
      }
      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";
      if (["strong", "b"].includes(tag)) return wrapMarkdown("**", renderChildren(node, context));
      if (["em", "i"].includes(tag)) return wrapMarkdown("_", renderChildren(node, context));
      if (["s", "del", "strike"].includes(tag)) return wrapMarkdown("~~", renderChildren(node, context));
      if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") {
        return `\`${(node.textContent || "").replace(/`/g, "\\`")}\``;
      }
      if (tag === "pre") return `\n\n\`\`\`\n${(node.textContent || "").trim()}\n\`\`\`\n\n`;
      if (tag === "blockquote") {
        const text = renderChildren(node, context).trim().split("\n").map((line) => `> ${line}`).join("\n");
        return `\n\n${text}\n\n`;
      }
      if (tag === "a") {
        const href = absoluteUrl(node.getAttribute("href") || "", baseUrl);
        const text = renderChildren(node, context).trim() || href;
        if (!href) return text;
        return `[${escapeLinkText(text)}](${escapeLinkUrl(href)})`;
      }
      if (tag === "img") {
        const source = absoluteUrl(node.getAttribute("src") || "", baseUrl);
        const target = imagePathMap.get(source) || source;
        if (!target) return "";
        const alt = cleanText(node.getAttribute("alt")) || "Ảnh trong bài viết";
        return `![${escapeLinkText(alt)}](${escapeLinkUrl(target)})`;
      }
      if (tag === "table") return renderMarkdownTable(node);
      if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        const items = Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li");
        const lines = items.map((item, index) => {
          const marker = ordered ? `${index + 1}.` : "-";
          const content = renderChildren(item, { ...context, inList: true }).trim().replace(/\n+/g, " ");
          return `${marker} ${content}`;
        });
        return `\n\n${lines.join("\n")}\n\n`;
      }
      if (tag === "li") return renderChildren(node, context);
      if (["p", "div", "section", "article", "figure", "figcaption"].includes(tag)) {
        const content = renderChildren(node, context).trim();
        if (!content) return "";
        return context.inList ? `${content} ` : `\n\n${content}\n\n`;
      }
      return renderChildren(node, context);
    };

    return cleanupMarkdown(renderChildren(root));
  }

  function renderMarkdownTable(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.children)
      .filter((cell) => ["th", "td"].includes(cell.tagName.toLowerCase()))
      .map((cell) => cleanText(cell.textContent).replace(/\|/g, "\\|")));
    const width = Math.max(0, ...rows.map((row) => row.length));
    if (!width || !rows.length) return "";

    const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
    const header = normalized[0];
    const body = normalized.slice(1);
    return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |${body.length ? `\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}` : ""}\n\n`;
  }

  function buildExportBundle(exported) {
    const markdown = renderForumMarkdown(exported);
    const publicData = publicExportData(exported);
    const readme = renderBundleReadme(exported);
    const files = [
      textZipFile("README.md", readme),
      textZipFile("forum.md", markdown),
      textZipFile("forum.json", `${JSON.stringify(publicData, null, 2)}\n`)
    ];

    exported.imageFiles.forEach((image) => {
      files.push({ name: image.assetPath, data: image.data });
    });
    exported.attachmentFiles.forEach((attachment) => {
      files.push({ name: attachment.assetPath, data: attachment.data });
    });

    const scopeLabel = exported.scope === "forum"
      ? `${exported.forumTitle}-${new URL(exported.sourceUrl).searchParams.get("id") || "forum"}`
      : `${exported.topics[0]?.subject || "chu-de"}-${exported.topics[0]?.id || "topic"}`;
    const date = new Date().toISOString().slice(0, 10);
    return {
      filename: `OU-Yeah-${slugify(scopeLabel) || "forum"}-${date}.zip`,
      files
    };
  }

  function renderForumMarkdown(exported) {
    const totalPosts = exported.topics.reduce((sum, topic) => sum + topic.posts.length, 0);
    const lines = [
      "---",
      `format: ${FORMAT_VERSION}`,
      `title: ${yamlString(exported.scope === "forum" ? exported.forumTitle : exported.topics[0]?.subject)}`,
      `course: ${yamlString([exported.courseCode, exported.courseName].filter(Boolean).join(" — "))}`,
      `source: ${yamlString(exported.sourceUrl)}`,
      `exported_at: ${yamlString(exported.exportedAt)}`,
      `topics: ${exported.topics.length}`,
      `posts: ${totalPosts}`,
      `images: ${exported.imageFiles.length}`,
      `attachments: ${exported.attachmentFiles.length}`,
      "---",
      "",
      `# ${exported.scope === "forum" ? exported.forumTitle : exported.topics[0]?.subject}`,
      "",
      `> Nguồn: [ELOLMS](${exported.sourceUrl})  `,
      `> Khóa học: ${[exported.courseCode, exported.courseName].filter(Boolean).join(" — ") || "Không rõ"}  `,
      `> Xuất bởi OU Yeah! lúc ${exported.exportedAt}.`,
      "",
      "## Mục lục",
      ""
    ];

    exported.topics.forEach((topic, index) => {
      lines.push(`${index + 1}. [${topic.subject}](#chu-de-${index + 1}) — ${topic.posts.length} bài viết`);
    });

    exported.topics.forEach((topic, topicIndex) => {
      lines.push("", "---", "", `<a id="chu-de-${topicIndex + 1}"></a>`, "", `## Chủ đề ${topicIndex + 1}: ${topic.subject}`, "");
      lines.push(`- Link gốc: ${topic.sourceUrl}`);
      lines.push(`- Số bài viết: ${topic.posts.length} (${topic.replyCount} phản hồi)`);
      lines.push("");

      topic.posts.forEach((post, postIndex) => {
        const headingLevel = Math.min(6, 3 + post.depth);
        const kind = postIndex === 0 ? "Bài mở đầu" : `Phản hồi ${postIndex}`;
        lines.push(`${"#".repeat(headingLevel)} ${kind} — ${post.author}`, "");
        lines.push(`- Post ID: \`${post.id}\``);
        lines.push(`- Thời gian: ${post.timeIso || post.timeText || "Không rõ"}`);
        if (post.replyToPostId) lines.push(`- Phản hồi cho: \`${post.replyToPostId}\``);
        lines.push(`- Permalink: ${post.permalink}`);
        lines.push("", post.contentMarkdown || "_Bài viết không có nội dung văn bản._", "");
        const detachedImages = post.images.filter((image) => !image.inline);
        if (detachedImages.length) {
          lines.push("**Ảnh đính kèm**", "");
          detachedImages.forEach((image) => {
            lines.push(`![${escapeLinkText(image.alt)}](${escapeLinkUrl(image.assetPath || image.sourceUrl)})`);
          });
          lines.push("");
        }
        if (post.attachments.length) {
          lines.push("**Tệp đính kèm**", "");
          post.attachments.forEach((attachment) => {
            const target = attachment.assetPath || attachment.url;
            const details = [attachment.contentType, attachment.size ? formatFileSize(attachment.size) : ""].filter(Boolean).join(" · ");
            lines.push(`- [${attachment.name}](${escapeLinkUrl(target)})${details ? ` — ${details}` : ""}`);
          });
          lines.push("");
        }
      });
    });

    if (exported.warnings.length) {
      lines.push("", "---", "", "## Cảnh báo khi xuất", "");
      exported.warnings.forEach((warning) => lines.push(`- ${warning}`));
    }
    return `${cleanupMarkdown(lines.join("\n"))}\n`;
  }

  function renderBundleReadme(exported) {
    return `# Gói xuất diễn đàn ELOLMS\n\nGói này được tạo bởi OU Yeah! theo định dạng \`${FORMAT_VERSION}\`.\n\n- \`forum.md\`: bản đọc ưu tiên cho AI và con người, giữ cấu trúc chủ đề, phản hồi, bảng, liên kết và đường dẫn tệp tương đối.\n- \`forum.json\`: dữ liệu có cấu trúc để AI hoặc chương trình xử lý chính xác quan hệ phản hồi.\n- \`images/\`: ảnh gốc xuất hiện trong nội dung bài viết; không bao gồm ảnh đại diện người dùng.\n- \`attachments/\`: bản gốc các tài liệu Moodle đính kèm như PDF, Word, Excel, PowerPoint hoặc tệp nén.\n\nNguồn: ${exported.sourceUrl}\n\n> Lưu ý riêng tư: nội dung diễn đàn và tệp đính kèm có thể chứa thông tin cá nhân hoặc nội dung chỉ dành cho lớp học. Hãy kiểm tra trước khi tải lên dịch vụ AI hoặc chia sẻ cho người khác.\n`;
  }

  function publicExportData(exported) {
    return {
      format: exported.format,
      scope: exported.scope,
      exportedAt: exported.exportedAt,
      sourceUrl: exported.sourceUrl,
      course: { name: exported.courseName, code: exported.courseCode },
      forum: { title: exported.forumTitle },
      topicCount: exported.topics.length,
      postCount: exported.topics.reduce((sum, topic) => sum + topic.posts.length, 0),
      imageCount: exported.imageFiles.length,
      attachmentCount: exported.attachmentFiles.length,
      warnings: exported.warnings,
      topics: exported.topics.map((topic) => ({
        id: topic.id,
        subject: topic.subject,
        sourceUrl: topic.sourceUrl,
        replyCount: topic.replyCount,
        posts: topic.posts.map((post) => ({
          id: post.id,
          subject: post.subject,
          author: post.author,
          authorUrl: post.authorUrl,
          timeText: post.timeText,
          timeIso: post.timeIso,
          permalink: post.permalink,
          replyToPostId: post.replyToPostId || null,
          depth: post.depth,
          contentMarkdown: post.contentMarkdown,
          images: post.images.map((image) => ({
            alt: image.alt,
            inline: image.inline,
            path: image.assetPath || null,
            sourceUrl: image.sourceUrl
          })),
          attachments: post.attachments.map((attachment) => ({
            name: attachment.name,
            path: attachment.assetPath || null,
            sourceUrl: attachment.url,
            contentType: attachment.contentType || null,
            size: attachment.size || null
          }))
        }))
      }))
    };
  }

  function createZipBlob(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = dateToDos(new Date());

    files.forEach((file) => {
      const nameBytes = new TextEncoder().encode(file.name.replace(/\\/g, "/"));
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function dateToDos(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  async function fetchHtmlDocument(url) {
    const response = await fetch(url, { credentials: "include", redirect: "follow" });
    if (!response.ok) throw new Error(`ELOLMS trả về HTTP ${response.status}.`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.querySelector("#login, form[action*='/login/index.php']")) {
      throw new Error("Phiên đăng nhập ELOLMS đã hết hạn.");
    }
    return doc;
  }

  function extractForumMetadata(doc, fallbackUrl) {
    const breadcrumbCourse = doc.querySelector("nav[aria-label] a[href*='/course/view.php?id='], .breadcrumb a[href*='/course/view.php?id=']");
    const forumLink = doc.querySelector("nav[aria-label] a[href*='/mod/forum/view.php?id='], .breadcrumb a[href*='/mod/forum/view.php?id=']");
    const forumHeading = doc.querySelector(".page-header-headings h1, header h1");
    const courseCode = doc.querySelector(".page-header-headings h6, header h6");
    const isFallbackDiscussion = /\/mod\/forum\/discuss\.php$/i.test(new URL(fallbackUrl).pathname);
    return {
      courseName: cleanText(breadcrumbCourse?.textContent),
      courseCode: cleanText(courseCode?.textContent),
      forumTitle: cleanText(forumHeading?.textContent || forumLink?.textContent) || "Diễn đàn thảo luận",
      forumUrl: forumLink?.href || (isFallbackDiscussion ? "" : canonicalForumUrl(fallbackUrl))
    };
  }

  function extractPaginationLinks(doc, pathname, key, value) {
    const links = [];
    doc.querySelectorAll(".pagination a[href], .paging a[href], [data-region='paging'] a[href]").forEach((link) => {
      const url = new URL(link.getAttribute("href") || link.href, location.origin);
      if (url.origin !== location.origin || url.pathname.toLowerCase() !== pathname.toLowerCase()) return;
      if (url.searchParams.get(key) !== value) return;
      url.hash = "";
      links.push(url.href);
    });
    return [...new Set(links)];
  }

  function canonicalDiscussionUrl(url) {
    const parsed = new URL(url, location.href);
    const id = parsed.searchParams.get("d") || "";
    parsed.pathname = "/mod/forum/discuss.php";
    parsed.search = "";
    parsed.searchParams.set("d", id);
    parsed.hash = "";
    return parsed.href;
  }

  function canonicalForumUrl(url) {
    const parsed = new URL(url, location.href);
    const id = parsed.searchParams.get("id") || "";
    parsed.pathname = "/mod/forum/view.php";
    parsed.search = "";
    parsed.searchParams.set("id", id);
    parsed.hash = "";
    return parsed.href;
  }

  function canUseCurrentDocument(url) {
    const current = new URL(location.href);
    const target = new URL(url);
    return IS_FORUM_VIEW
      && target.pathname === current.pathname
      && target.searchParams.get("id") === current.searchParams.get("id")
      && !target.searchParams.has("p")
      && !target.searchParams.has("page");
  }

  function canUseCurrentDiscussionDocument(url) {
    const current = new URL(location.href);
    const target = new URL(url);
    return IS_DISCUSSION_VIEW
      && target.searchParams.get("d") === current.searchParams.get("d")
      && !current.searchParams.has("parent")
      && !current.searchParams.has("page")
      && !target.searchParams.has("page");
  }

  function textZipFile(name, text) {
    return { name, data: new TextEncoder().encode(text) };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.hidden = true;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function updateExportStatus(label, percent, state) {
    const status = document.querySelector("[data-ou-forum-export-progress]");
    if (!(status instanceof HTMLElement)) return;
    status.hidden = false;
    status.dataset.state = state;
    status.style.setProperty("--ou-export-progress", `${Math.max(0, Math.min(100, Number(percent) || 0))}%`);
    const labelNode = status.querySelector(".ou-yeah-forum-export-progress-label");
    if (labelNode) labelNode.textContent = label;
  }

  function resetExportStatus() {
    const status = document.querySelector("[data-ou-forum-export-progress]");
    if (!(status instanceof HTMLElement)) return;
    status.hidden = true;
    status.dataset.state = "idle";
    status.style.setProperty("--ou-export-progress", "0%");
  }

  function setExportButtonsDisabled(disabled) {
    document.querySelectorAll("[data-ou-forum-export]").forEach((button) => {
      if (button instanceof HTMLButtonElement) button.disabled = disabled;
    });
  }

  function injectForumExportTheme() {
    if (document.getElementById(STYLE_ID)) return;
    const iconUrl = chrome.runtime.getURL("src/icons/inbox-in.svg");
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ou-yeah-forum-export-toolbar {
        --ou-export-brand: #5269c7;
        --ou-export-ink: #1f2740;
        --ou-export-muted: #6f778c;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        margin: 0 0 14px auto;
        min-height: 38px;
      }

      .ou-yeah-forum-export-navitem .ou-yeah-forum-export-toolbar {
        margin: 0;
      }

      .ou-yeah-forum-export-primary,
      .ou-yeah-forum-export-row {
        appearance: none;
        border: 1px solid rgba(82, 105, 199, 0.28);
        border-radius: 10px;
        background: #fff;
        color: #4057b9;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        font: 600 13px/1 "Space Grotesk", "Segoe UI", sans-serif;
        letter-spacing: 0;
        cursor: pointer;
        transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
      }

      .ou-yeah-forum-export-primary {
        min-height: 38px;
        padding: 0 14px;
        box-shadow: 0 5px 14px rgba(31, 39, 64, 0.06);
      }

      .ou-yeah-forum-export-primary:hover,
      .ou-yeah-forum-export-row:hover {
        background: #f3f5ff;
        border-color: rgba(82, 105, 199, 0.52);
        color: #3049af;
        transform: translateY(-1px);
      }

      .ou-yeah-forum-export-primary:focus-visible,
      .ou-yeah-forum-export-row:focus-visible {
        outline: 3px solid rgba(82, 105, 199, 0.2);
        outline-offset: 2px;
      }

      .ou-yeah-forum-export-primary:disabled,
      .ou-yeah-forum-export-row:disabled {
        cursor: wait;
        opacity: 0.62;
        transform: none;
      }

      .ou-yeah-forum-export-icon {
        width: 17px;
        height: 17px;
        flex: 0 0 17px;
        display: inline-block;
        background: currentColor;
        -webkit-mask: url("${iconUrl}") center / contain no-repeat;
        mask: url("${iconUrl}") center / contain no-repeat;
      }

      .ou-yeah-forum-export-primary.is-active .ou-yeah-forum-export-icon {
        animation: ouYeahForumExportPulse 900ms ease-in-out infinite;
      }

      .ou-yeah-forum-export-progress {
        --ou-export-progress: 0%;
        width: min(250px, 34vw);
        min-width: 170px;
        padding: 7px 10px 8px;
        border: 1px solid #e1e5f0;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.96);
        color: var(--ou-export-muted);
        box-shadow: 0 5px 14px rgba(31, 39, 64, 0.05);
      }

      .ou-yeah-forum-export-progress[hidden] { display: none !important; }

      .ou-yeah-forum-export-progress-label {
        display: block;
        overflow: hidden;
        margin-bottom: 5px;
        color: inherit;
        font: 600 11px/1.15 "Space Grotesk", "Segoe UI", sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ou-yeah-forum-export-progress-track {
        display: block;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: #edf0f6;
      }

      .ou-yeah-forum-export-progress-fill {
        display: block;
        width: var(--ou-export-progress);
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #5269c7, #7186dc);
        transition: width 260ms cubic-bezier(.22, .8, .25, 1), background-color 160ms ease;
      }

      .ou-yeah-forum-export-progress[data-state="complete"] {
        color: #277a52;
        border-color: rgba(39, 122, 82, 0.22);
      }

      .ou-yeah-forum-export-progress[data-state="complete"] .ou-yeah-forum-export-progress-fill {
        background: #4fb47e;
      }

      .ou-yeah-forum-export-progress[data-state="error"] {
        color: #a33d47;
        border-color: rgba(163, 61, 71, 0.24);
      }

      .ou-yeah-forum-export-progress[data-state="error"] .ou-yeah-forum-export-progress-fill {
        background: #d76b74;
      }

      .ou-yeah-forum-export-topic-host {
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .ou-yeah-forum-export-topic-host > a {
        min-width: 0;
      }

      .ou-yeah-forum-export-topic-host .ou-yeah-forum-export-row {
        flex: 0 0 auto;
        min-height: 27px;
        margin: 0;
        padding: 0 9px;
        border-radius: 8px;
        font-size: 11px;
      }

      .ou-yeah-forum-export-topic-host .ou-yeah-forum-export-row .ou-yeah-forum-export-icon {
        width: 13px;
        height: 13px;
        flex-basis: 13px;
      }

      @keyframes ouYeahForumExportPulse {
        0%, 100% { transform: translateY(0); opacity: 1; }
        50% { transform: translateY(2px); opacity: 0.65; }
      }

      @media (max-width: 720px) {
        .ou-yeah-forum-export-toolbar {
          align-items: stretch;
          flex-direction: column;
        }
        .ou-yeah-forum-export-primary,
        .ou-yeah-forum-export-progress { width: 100%; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function imageExtension(contentType, url) {
    const byType = {
      "image/avif": "avif",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/svg+xml": "svg",
      "image/webp": "webp"
    };
    if (byType[contentType]) return byType[contentType];
    const match = new URL(url, location.href).pathname.match(/\.([a-z0-9]{2,5})$/i);
    const extension = match?.[1]?.toLowerCase();
    if (extension === "jpeg") return "jpg";
    if (["avif", "gif", "jpg", "png", "svg", "webp"].includes(extension || "")) return extension;
    return "bin";
  }

  function looksLikeImageUrl(url) {
    return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url)
      || /\/mod_forum\/post\//i.test(url);
  }

  function absoluteUrl(value, baseUrl) {
    if (!value || /^javascript:/i.test(value)) return "";
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return "";
    }
  }

  function decodePathFilename(url) {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
      return "";
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeInlineWhitespace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[\t\r\f ]+/g, " ");
  }

  function cleanupMarkdown(value) {
    return String(value || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function wrapMarkdown(marker, value) {
    const text = value.trim();
    return text ? `${marker}${text}${marker}` : "";
  }

  function escapeLinkText(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  function escapeLinkUrl(value) {
    return String(value || "").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
  }

  function yamlString(value) {
    return JSON.stringify(String(value || ""));
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
  }

  function sanitizePathSegment(value) {
    return slugify(value) || "file";
  }

  function sanitizeAttachmentFilename(value) {
    const withoutControls = Array.from(String(value || "").normalize("NFC"))
      .map((character) => character.charCodeAt(0) < 32 ? "_" : character)
      .join("");
    const safe = withoutControls
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 180);
    return safe || "tep-dinh-kem";
  }

  function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
    return `${(value / (1024 ** 3)).toFixed(1)} GB`;
  }

  function dedupeBy(items, getKey) {
    const seen = new Set();
    return items.filter((item) => {
      const key = getKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function readableError(error) {
    if (error instanceof Error) return error.message;
    return String(error || "Đã có lỗi xảy ra.");
  }

  function handleUnexpectedExportError(error) {
    console.error(`${APP}: unexpected forum export error`, error);
  }
})();
