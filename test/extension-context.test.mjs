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
