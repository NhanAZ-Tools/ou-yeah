import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const INVALIDATED = "Extension context invalidated.";

test("HLS download initializes its worker cursor before workers run", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const messages = [];
  const playlist = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXTINF:5,",
    "segment-1.ts",
    "#EXTINF:5,",
    "segment-2.ts",
    "#EXT-X-ENDLIST"
  ].join("\n");
  const context = vm.createContext({
    Blob,
    Headers,
    URL,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve();
        }
      }
    },
    fetch: async (url) => {
      if (String(url).endsWith(".m3u8")) {
        return { ok: true, status: 200, text: async () => playlist };
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      };
    }
  });

  vm.runInContext(source, context, { filename: "src/offscreen.js" });
  await vm.runInContext(`downloadHls({
    jobId: "hls-job",
    url: "https://cdn.example.test/video.m3u8",
    filename: "lecture"
  })`, context);

  const ready = messages.find((message) => message.type === "ou-yeah-hls-ready");
  assert.ok(ready);
  assert.equal(ready.filename, "lecture.ts");
  assert.equal(messages.filter((message) => message.type === "ou-yeah-hls-progress").length, 4);
  URL.revokeObjectURL(ready.blobUrl);
});

test("offscreen notifications consume invalidated-context rejections", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage() {
          return Promise.reject(new Error(INVALIDATED));
        }
      }
    }
  });
  const unhandled = [];
  const recordUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", recordUnhandled);

  try {
    vm.runInContext(source, context, { filename: "src/offscreen.js" });
    vm.runInContext(`
      sendProgress("job", "downloading", "progress", 25, 1, 4);
      sendError("job", "failed");
      sendBookProgress("book", "downloading", "progress", 25, 1, 4);
      sendBookError("book", "failed");
      sendRuntimeMessageSafely({ type: "ready" });
    `, context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", recordUnhandled);
  }
});

test("background async responses turn rejected jobs into error responses", async () => {
  const source = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    chrome: {
      action: { onClicked: event() },
      runtime: { onMessage: event() },
      tabs: { onRemoved: event() },
      webRequest: {
        onBeforeRequest: event(),
        onHeadersReceived: event()
      }
    },
    capturedResponse: null
  });
  const unhandled = [];
  const recordUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", recordUnhandled);

  try {
    vm.runInContext(source, context, { filename: "src/background.js" });
    vm.runInContext(`
      respondToAsyncRequest(
        Promise.reject(new Error("${INVALIDATED}")),
        (response) => { capturedResponse = response; }
      );
    `, context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.capturedResponse.ok, false);
    assert.equal(context.capturedResponse.error, INVALIDATED);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", recordUnhandled);
  }
});

test("notification wheel fallback scrolls the document before Moodle handlers", async () => {
  const source = await readFile(new URL("../src/notifications.js", import.meta.url), "utf8");

  assert.match(source, /document\.addEventListener\("wheel"/);
  assert.match(source, /\{ capture: true, passive: false \}/);
  assert.match(source, /document\.scrollingElement/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test("notification course dropdown separates course names from codes", async () => {
  const source = await readFile(new URL("../src/notifications.js", import.meta.url), "utf8");

  assert.match(source, /COSC04052: "Lập trình hướng đối tượng"/);
  assert.match(source, /COSC04032: "Toán rời rạc"/);
  assert.match(source, /COSC04042: "Cấu trúc dữ liệu và thuật giải"/);
  assert.match(source, /EDUC02062: "Kỹ năng học tập"/);
  assert.match(source, /courseDisplayName\(course\)/);
  assert.match(source, /dataset\.courseMeta/);
});

test("notifications register Space Grotesk as real extension fonts", async () => {
  const source = await readFile(new URL("../src/notifications.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/notifications.css", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const webResources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);

  assert.match(source, /new FontFace\(/);
  assert.match(source, /runtime\.getURL\(`src\/fonts\/\$\{file\}`\)/);
  assert.match(source, /document\.fonts\.add\(face\)/);
  assert.match(css, /--ou-font: "Space Grotesk", "Segoe UI", sans-serif;/);
  assert.match(css, /#ou-yeah-notification-toolbar/);
  assert.match(css, /:not\(\.icon\)/);
  assert.ok(webResources.includes("src/fonts/*.ttf"));
});

test("ELOLMS pages get a global Space Grotesk font layer", async () => {
  const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

  assert.match(source, /ELOLMS_FONT_STYLE_ID = "ou-yeah-elolms-font-theme"/);
  assert.match(source, /if \(IS_ELOLMS\) initElolmsFontTheme\(\)/);
  assert.match(source, /function initElolmsFontTheme/);
  assert.match(source, /function injectElolmsFontTheme/);
  assert.match(source, /function elolmsFontCss/);
  assert.match(source, /body\.ou-yeah-elolms-font/);
  assert.match(source, /--ou-global-font: "Space Grotesk", "Segoe UI", Arial, sans-serif;/);
  assert.match(source, /font-family: var\(--ou-global-font\) !important;/);
  assert.match(source, /:not\(\.fa\):not\(\.fas\):not\(\.far\):not\(\.fab\)/);
  assert.match(source, /:not\(\.icon\):not\(\.material-icons\):not\(\.material-symbols-outlined\)/);
});

test("notifications render list items as compact single-line rows", async () => {
  const css = await readFile(new URL("../src/notifications.css", import.meta.url), "utf8");

  assert.match(css, /Compact notification rows/);
  assert.match(css, /grid-template-columns: 28px minmax\(0, 1fr\) max-content;/);
  assert.match(css, /display: contents !important;/);
  assert.match(css, /grid-column: 3;/);
  assert.match(css, /white-space: nowrap;/);
  assert.match(css, /text-overflow: ellipsis;/);
});

test("notifications use the requested SVG icon set", async () => {
  const source = await readFile(new URL("../src/notifications.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/notifications.css", import.meta.url), "utf8");
  const iconFiles = [
    "envelope-dot.svg",
    "book-alt.svg",
    "bubble-discussion.svg",
    "daily-calendar.svg",
    "bell-notification-social-media.svg"
  ];

  for (const iconFile of iconFiles) {
    assert.match(source, new RegExp(iconFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const icon = await readFile(new URL(`../src/icons/${iconFile}`, import.meta.url), "utf8");
    assert.match(icon, /<svg\b/);
  }

  assert.match(source, /applyNotificationIcon\(item, type, isUnread\)/);
  assert.match(source, /runtime\.getURL\(`src\/icons\/\$\{file\}`\)/);
  assert.match(css, /mask: var\(--ou-notification-icon\) center \/ contain no-repeat;/);
  assert.match(css, /\[data-ou-icon="envelope-dot"\]::after/);
});

test("notification classification keeps exam guidance as announcement", async () => {
  const source = await readFile(new URL("../src/notifications.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /assignment\|quiz\|kiem tra/);
  assert.match(source, /bai tap lon\|assignment\|quiz/);
  assert.match(source, /thong bao\|announcement\|giang vien\|thay\|co \|kiem tra\|de lam tot/);
});

test("notification detail go-to action is compact and right aligned", async () => {
  const css = await readFile(new URL("../src/notifications.css", import.meta.url), "utf8");

  assert.match(css, /\[data-region="content-area"\] > \[data-region="footer"\] \{\s+display: flex !important;/);
  assert.match(css, /justify-content: flex-end;/);
  assert.match(css, /max-width: min\(520px, 100%\);/);
  assert.match(css, /text-overflow: ellipsis;/);
  assert.match(css, /white-space: nowrap;/);
});

test("notification detail content height follows short messages", async () => {
  const css = await readFile(new URL("../src/notifications.css", import.meta.url), "utf8");

  assert.match(css, /\[data-region="content-area"\] > \[data-region="content"\] \{\s+flex: 0 1 auto;/);
  assert.match(css, /\.ou-yeah-has-detail > \[data-region="content"\]/);
  assert.match(css, /height: auto !important;/);
  assert.match(css, /min-height: 0 !important;/);
  assert.match(css, /flex: 0 1 auto !important;/);
});

test("ELOLMS notification popover matches OU Yeah notification styling", async () => {
  const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  const popoverUniversalBlock = source.match(/#nav-notification-popover-container\.ou-yeah-popover-themed \*,\s+#nav-notification-popover-container\.ou-yeah-popover-themed \*::before,\s+#nav-notification-popover-container\.ou-yeah-popover-themed \*::after \{([\s\S]*?)\n      \}/)?.[1] || "";

  assert.match(source, /initNotificationPopoverPolish\(\)/);
  assert.match(source, /NOTIFICATION_POPOVER_STYLE_ID = "ou-yeah-notification-popover-theme"/);
  assert.match(source, /#nav-notification-popover-container\.ou-yeah-popover-themed/);
  assert.match(source, /seeAll\.textContent = "Xem tất cả"/);
  assert.match(source, /link\.textContent = "Chi tiết"/);
  assert.match(source, /mask: var\(--ou-popup-icon\) center \/ contain no-repeat;/);
  assert.match(source, /\.see-all-link::after/);
  assert.match(source, /#nav-notification-popover-container\.ou-yeah-popover-themed \*,\s+#nav-notification-popover-container\.ou-yeah-popover-themed \*::before,\s+#nav-notification-popover-container\.ou-yeah-popover-themed \*::after \{\s+box-sizing: border-box;\s+letter-spacing: 0;/);
  assert.match(source, /#nav-notification-popover-container\.ou-yeah-popover-themed :where\(/);
  assert.match(source, /:not\(\.icon\):not\(\.material-icons\):not\(\.material-symbols-outlined\):not\(\[class\^="fa-"\]\)/);
  assert.doesNotMatch(popoverUniversalBlock, /font-family/);
  assert.doesNotMatch(source, /assignment\|quiz\|kiem tra/);
  assert.match(source, /thong bao\|announcement\|giang vien\|thay\|co \|kiem tra\|de lam tot/);
});

test("ELOLMS course view gets a compact Course Map", async () => {
  const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

  assert.match(source, /IS_ELOLMS_COURSE_VIEW/);
  assert.match(source, /initCourseMapPolish\(\)/);
  assert.match(source, /startCourseMapBootstrap\(\)/);
  assert.match(source, /runCourseMapBootstrap/);
  assert.match(source, /window\.addEventListener\("pageshow", startCourseMapBootstrap/);
  assert.match(source, /document\.addEventListener\("readystatechange", startCourseMapBootstrap\)/);
  assert.match(source, /COURSE_MAP_STYLE_ID = "ou-yeah-course-map-theme"/);
  assert.match(source, /COURSE_MAP_TOOLS_ID = "ou-yeah-course-map-tools"/);
  assert.match(source, /COURSE_MAP_RESIZE_HANDLE_CLASS = "ou-course-map-resize-handle"/);
  assert.match(source, /COURSE_MAP_WIDTH_STORAGE_KEY = "ouYeahCourseMapWidth"/);
  assert.match(source, /COURSE_MAP_MIN_WIDTH = 320/);
  assert.match(source, /COURSE_MAP_MAX_WIDTH = 620/);
  assert.match(source, /Course Map/);
  assert.match(source, /input\.addEventListener\("input", \(\) => applyCourseMapFilter\(courseIndex, input\.value\)\)/);
  assert.match(source, /ou-yeah-current-section/);
  assert.match(source, /classifyCourseMapModule/);
  assert.match(source, /applyDefaultCollapsedCourseSections\(\)/);
  assert.match(source, /getCourseSectionCollapseToggles/);
  assert.match(source, /annotateOpenCourseSections\(\)/);
  assert.match(source, /isCourseSectionExpanded/);
  assert.match(source, /isCollapseContentOpen/);
  assert.match(source, /attributeFilter: \["aria-expanded", "class", "hidden", "style"\]/);
  assert.match(source, /ou-yeah-section-open/);
  assert.match(source, /section-collapsemenu/);
  assert.match(source, /courseMapDefaultCollapseApplied/);
  assert.match(source, /courseMapUserToggledSections/);
  assert.match(source, /globalToggle\.click\(\)/);
  assert.match(source, /function handleCourseSectionToggleEvent/);
  assert.match(source, /document\.addEventListener\("click", handleCourseSectionToggleEvent, true\)/);
  assert.match(source, /document\.addEventListener\("transitionend", handleCourseSectionToggleEvent, true\)/);
  assert.match(source, /document\.addEventListener\("click", handleCourseMapDrawerToggleEvent, true\)/);
  assert.match(source, /event\.isTrusted/);
  assert.match(source, /courseMapUserToggledDrawer = true;/);
  assert.match(source, /function closeCourseMapDrawerByDefault\(drawer\)/);
  assert.match(source, /if \(courseMapDefaultDrawerCloseApplied \|\| courseMapUserToggledDrawer\) return;/);
  assert.match(source, /if \(now > courseMapDefaultDrawerCloseDeadline\) \{\s+courseMapDefaultDrawerCloseApplied = true;/);
  assert.match(source, /if \(!isCourseMapDrawerOpen\(drawer\)\) return;/);
  assert.match(source, /document\.body\?\.classList\.remove\("drawer-open-index", "drawer-open-left"\);/);
  assert.match(source, /drawer\.classList\.remove\("show"\);/);
  assert.match(source, /ensureCourseMapResizeHandle\(drawer\)/);
  assert.match(source, /function startCourseMapResize\(event, drawer\)/);
  assert.match(source, /handle\.addEventListener\("pointerdown", \(event\) => startCourseMapResize\(event, drawer\)\)/);
  assert.match(source, /handle\.addEventListener\("dblclick", \(\) => \{/);
  assert.match(source, /persistCourseMapWidthPreference\(COURSE_MAP_DEFAULT_WIDTH\)/);
  assert.match(source, /document\.body\?\.style\.setProperty\("--ou-course-map-width", `\$\{normalizedWidth\}px`\)/);
  assert.match(source, /document\.body\?\.style\.setProperty\("--drawer-left-width", `\$\{normalizedWidth\}px`\)/);
  assert.match(source, /chrome\.storage\.sync\.get\(\[COURSE_MAP_WIDTH_STORAGE_KEY\]/);
  assert.match(source, /chrome\.storage\.sync\.set\(\{ \[COURSE_MAP_WIDTH_STORAGE_KEY\]: normalizedWidth \}/);
  assert.match(source, /clamp\(Math\.round\(Number\(width\) \|\| COURSE_MAP_DEFAULT_WIDTH\), COURSE_MAP_MIN_WIDTH, maxWidth\)/);
  assert.match(source, /window\.setTimeout\(refreshCourseMap, 80\)/);
  assert.match(source, /window\.setTimeout\(refreshCourseMap, 260\)/);
  assert.match(source, /window\.setTimeout\(refreshCourseMap, 620\)/);
  assert.match(source, /window\.setTimeout\(refreshCourseMap, 1100\)/);
  assert.match(source, /if \(collapse\.classList\.contains\("collapse"\)\) return false;/);
  assert.match(source, /content: "Mở";/);
  assert.doesNotMatch(source, /:has\(> \.course-section-header \.sectionname\):has/);
  assert.match(source, /box-shadow: inset 4px 0 0 var\(--ou-course-brand\);/);
  assert.match(source, /border-left: 3px solid rgba\(82, 105, 199, 0\.35\);/);
  assert.match(source, /body\.ou-yeah-course-view \.course-content \.sectionname/);
  assert.match(source, /font-size: clamp\(13\.25px, 0\.88vw, 15\.5px\) !important;/);
  assert.match(source, /font-size: clamp\(14px, 0\.98vw, 16\.5px\) !important;/);
  assert.match(source, /white-space: nowrap !important;/);
  assert.match(source, /text-overflow: ellipsis !important;/);
  assert.match(source, /min-height: 36px !important;/);
  assert.match(source, /data-ou-course-map-kind-label/);
  assert.match(source, /width: min\(var\(--ou-course-map-width\), calc\(100vw - 24px\)\) !important;/);
  assert.match(source, /\.\$\{COURSE_MAP_RESIZE_HANDLE_CLASS\}/);
  assert.match(source, /cursor: ew-resize !important;/);
  assert.match(source, /grid-template-columns: 24px 22px minmax\(0, 1fr\);/);
  assert.match(source, /grid-template-columns: 34px minmax\(0, 1fr\);/);
  assert.match(source, /#courseindex\.ou-yeah-course-map \[data-for="cm"\] \.courseindex-link \{\s+grid-column: 2;/);
  assert.match(source, /#courseindex\.ou-yeah-course-map \[data-for="cm"\] \.courseindex-link \{[\s\S]*?display: block !important;[\s\S]*?white-space: nowrap !important;/);
  assert.doesNotMatch(source, /#courseindex\.ou-yeah-course-map \.courseindex-section-title \.courseindex-link \{[^}]*white-space: normal/);
  assert.doesNotMatch(source, /#courseindex\.ou-yeah-course-map \[data-for="cm"\] \.courseindex-link \{[^}]*-webkit-line-clamp/);
  assert.match(source, /#courseindex\.ou-yeah-course-map \[data-for="cm"\] \.completioninfo \{\s+display: none !important;/);
  assert.match(source, /\.courseindex-locked,\s+#courseindex\.ou-yeah-course-map \[data-for="cm"\] \.dragicon \{\s+display: none !important;/);
  assert.match(source, /body\.ou-yeah-course-view \.course-content \.activity-item/);
  assert.match(source, /width: 30px !important;/);
  assert.match(source, /font-size: clamp\(13\.25px, 0\.86vw, 15px\) !important;/);
  assert.match(source, /body\.ou-yeah-course-view \.course-content \.completion-info/);
});

test("release metadata and packaging script are version aligned", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const releaseScript = await readFile(new URL("../scripts/release.ps1", import.meta.url), "utf8");

  assert.equal(packageJson.name, "ou-yeah");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageJson.scripts["pack:extension"], "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1");
  assert.equal(packageJson.scripts.release, "npm run check && npm run pack:extension");
  assert.match(releaseScript, /OU-Yeah-v\$version/);
  assert.match(releaseScript, /Get-FileHash -LiteralPath \$zipPath -Algorithm SHA256/);
  assert.match(releaseScript, /Release archive is missing/);
});
