(() => {
  "use strict";

  const IS_ELOLMS = location.hostname === "elolms.ou.edu.vn";
  const OBSERVED_ATTRIBUTES = ["aria-label", "title", "data-original-title", "data-bs-original-title"];
  const SKIPPED_SELECTOR = [
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "code",
    "pre",
    "kbd",
    "samp",
    "[contenteditable]:not([contenteditable='false'])"
  ].join(",");
  const TIME_RANGE_WITH_END_MERIDIEM_RE = /(^|[^\p{L}\p{N}])((?:0?[1-9]|1[0-2])):([0-5]\d)(?::([0-5]\d))?\s*([–—-])\s*((?:0?[1-9]|1[0-2])):([0-5]\d)(?::([0-5]\d))?\s*([ap])(?:\.\s*m\.|m)(?=$|[^\p{L}\p{N}])/giu;
  const TWELVE_HOUR_TIME_RE = /(^|[^\p{L}\p{N}])((?:0?[1-9]|1[0-2])):([0-5]\d)(?::([0-5]\d))?\s*([ap])(?:\.\s*m\.|m)(?=$|[^\p{L}\p{N}])/giu;

  if (!IS_ELOLMS) return;

  const formatterWindow = /** @type {Window & {
   *   __ouYeah24HourTimeLoaded?: boolean,
   *   __ouYeahFormat24HourText?: (value: string) => string
   * }} */ (window);
  if (formatterWindow.__ouYeah24HourTimeLoaded) return;
  formatterWindow.__ouYeah24HourTimeLoaded = true;
  formatterWindow.__ouYeahFormat24HourText = formatTimeText;

  rewriteSubtree(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        rewriteTextNode(mutation.target);
        continue;
      }

      if (mutation.type === "attributes") {
        if (mutation.target instanceof Element && mutation.attributeName) {
          rewriteAttribute(mutation.target, mutation.attributeName);
        }
        continue;
      }

      for (const addedNode of mutation.addedNodes) {
        rewriteSubtree(addedNode);
      }
    }
  });

  observer.observe(document.documentElement, {
    attributeFilter: OBSERVED_ATTRIBUTES,
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true
  });

  function formatTimeText(value) {
    const text = String(value || "").replace(
      TIME_RANGE_WITH_END_MERIDIEM_RE,
      (match, prefix, startHourText, startMinuteText, startSecondText, separator, endHourText, endMinuteText, endSecondText, meridiem) => {
        const startHour = Number.parseInt(startHourText, 10);
        const endHour = Number.parseInt(endHourText, 10);
        const isPm = String(meridiem).toLowerCase() === "p";
        // Moodle sometimes renders a range as “1:00 – 3:30 PM”. The suffix
        // applies to both endpoints when the range does not cross noon.
        const startIsPm = isPm && startHour <= endHour;
        return `${prefix}${to24Hour(startHour, startIsPm)}:${startMinuteText}${startSecondText ? `:${startSecondText}` : ""} ${separator} ${to24Hour(endHour, isPm)}:${endMinuteText}${endSecondText ? `:${endSecondText}` : ""}`;
      }
    );

    return text.replace(
      TWELVE_HOUR_TIME_RE,
      (match, prefix, hourText, minuteText, secondText, meridiem) => {
        const hour = Number.parseInt(hourText, 10);
        if (!Number.isInteger(hour) || hour < 1 || hour > 12) return match;

        const hour24 = to24Hour(hour, String(meridiem).toLowerCase() === "p");
        const seconds = secondText ? `:${secondText}` : "";
        return `${prefix}${String(hour24).padStart(2, "0")}:${minuteText}${seconds}`;
      }
    );
  }

  function to24Hour(hour, isPm) {
    return String(hour % 12 + (isPm ? 12 : 0)).padStart(2, "0");
  }

  function rewriteSubtree(root) {
    if (root instanceof Text) {
      rewriteTextNode(root);
      return;
    }
    if (!(root instanceof Element) || shouldSkipElement(root)) return;

    rewriteElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node instanceof Element && shouldSkipElement(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) rewriteTextNode(node);
      else if (node instanceof Element) rewriteElementAttributes(node);
      node = walker.nextNode();
    }
  }

  function rewriteTextNode(node) {
    if (!(node instanceof Text) || shouldSkipElement(node.parentElement)) return;
    const formatted = formatTimeText(node.data);
    if (formatted !== node.data) node.data = formatted;
  }

  function rewriteElementAttributes(element) {
    for (const attributeName of OBSERVED_ATTRIBUTES) {
      rewriteAttribute(element, attributeName);
    }
  }

  function rewriteAttribute(element, attributeName) {
    if (!OBSERVED_ATTRIBUTES.includes(attributeName) || shouldSkipElement(element)) return;
    const current = element.getAttribute(attributeName);
    if (!current) return;
    const formatted = formatTimeText(current);
    if (formatted !== current) element.setAttribute(attributeName, formatted);
  }

  function shouldSkipElement(element) {
    return element instanceof Element && Boolean(element.closest(SKIPPED_SELECTOR));
  }
})();
