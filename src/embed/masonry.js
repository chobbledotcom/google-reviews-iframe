/**
 * Masonry layout using @chenglou/pretext for height prediction.
 *
 * Card heights are predicted from font metrics (via canvas), so cards can be
 * positioned without waiting for the browser to lay them out. A
 * ResizeObserver then reports each card's real height, and any card whose
 * prediction was wrong is re-placed before the frame paints, so cards can
 * never overlap even when the prediction misses (emoji fallback fonts,
 * unusual markup, browser quirks).
 *
 * Ideas borrowed from schalkneethling/masonry-gridlanes-wc:
 * - font, line-height and card chrome are read from computed styles rather
 *   than hardcoded, so CSS changes and media queries cannot drift
 * - prepare() results are cached per card; a resize only re-runs layout()
 * - placement follows the CSS Grid Lanes rule, with a flow tolerance that
 *   keeps cards in reading order when columns are nearly level
 * - real DOM measurement is the fallback for anything pretext cannot model
 */
import { layout, prepare } from "@chenglou/pretext";

const GAP = 20;
const MOBILE_BREAKPOINT = 601;
const MIN_COLUMN_WIDTH = 280;
// Columns within this many px of the shortest count as level (CSS
// `flow-tolerance` defaults to 1em).
const FLOW_TOLERANCE = 16;
// Width differences smaller than this are rounding noise.
const EPSILON = 0.5;
// A card is only re-placed when its rendered height is at least this far
// from the height it was placed with; smaller differences are invisible.
const HEIGHT_TOLERANCE = 1;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCK_TAGS =
  /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|SECTION|ARTICLE|H[1-6]|TABLE|TR)$/;

const px = (value) => Number.parseFloat(value) || 0;
const near = (a, b) => Math.abs(a - b) <= EPSILON;

/** A block boundary only starts a new line if the current one has content. */
function endBlock(paragraphs) {
  if (paragraphs[paragraphs.length - 1].trim()) paragraphs.push("");
}

function appendNode(paragraphs, node) {
  if (node.nodeType === TEXT_NODE) {
    paragraphs[paragraphs.length - 1] += node.data;
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  if (node.tagName === "BR") {
    paragraphs.push("");
    return;
  }
  const isBlock = BLOCK_TAGS.test(node.tagName);
  if (isBlock) endBlock(paragraphs);
  for (const child of node.childNodes) appendNode(paragraphs, child);
  if (isBlock) endBlock(paragraphs);
}

/**
 * Split an element's content into the runs of text ("paragraphs") the
 * browser wraps independently: text separated by <br> or block boundaries.
 * Inline elements (<a>, <b>, ...) are flattened to their text.
 */
function readParagraphs(root) {
  const paragraphs = [""];
  for (const child of root.childNodes) appendNode(paragraphs, child);
  // A trailing break does not open a new line box.
  if (!paragraphs[paragraphs.length - 1].trim()) paragraphs.pop();
  return paragraphs;
}

/** Canvas font shorthand (no line-height) rebuilt from computed styles. */
function canvasFont(styles) {
  const parts = [];
  if (styles.fontStyle && styles.fontStyle !== "normal") {
    parts.push(styles.fontStyle);
  }
  if (styles.fontWeight && !/^(400|normal)$/.test(styles.fontWeight)) {
    parts.push(styles.fontWeight);
  }
  parts.push(styles.fontSize || "16px", styles.fontFamily || "sans-serif");
  return parts.join(" ");
}

/**
 * Read everything the prediction needs from live styles. Reading computed
 * styles does not force layout; the chrome measurement reads one card, and
 * runs when layout is already clean.
 */
function readMetrics(sample) {
  const cardStyles = getComputedStyle(sample.el);
  const textStyles = getComputedStyle(sample.content);
  const fontSize = px(textStyles.fontSize) || 16;
  return {
    font: canvasFont(textStyles),
    lineHeight: px(textStyles.lineHeight) || fontSize * 1.2,
    // Horizontal space the card takes from the text (padding + border).
    inlineChrome:
      px(cardStyles.paddingLeft) +
      px(cardStyles.paddingRight) +
      px(cardStyles.borderLeftWidth) +
      px(cardStyles.borderRightWidth),
    // Everything in the card that is not review text: header, padding,
    // border. Independent of card width because the header is fixed-height.
    blockChrome: sample.el.offsetHeight - sample.content.offsetHeight,
  };
}

/** Predict a card's height at the given column width. Pure arithmetic. */
function predictHeight(card, columnWidth, metrics) {
  if (card.font !== metrics.font) {
    card.font = metrics.font;
    card.prepared = card.paragraphs.map((text) =>
      text.trim() ? prepare(text, metrics.font) : null,
    );
  }
  const textWidth = Math.max(0, columnWidth - metrics.inlineChrome);
  let height = metrics.blockChrome;
  for (const prepared of card.prepared) {
    // An empty paragraph (consecutive <br>) is still one line tall.
    height += prepared
      ? layout(prepared, textWidth, metrics.lineHeight).height
      : metrics.lineHeight;
  }
  return height;
}

/**
 * Grid Lanes placement: each item goes in the first column that is within
 * `tolerance` of the shortest one.
 */
function placeItems(heights, columnCount, columnWidth, gap, tolerance) {
  const columnEnds = new Float64Array(columnCount);
  const positions = new Array(heights.length);

  for (let i = 0; i < heights.length; i++) {
    const threshold = Math.min(...columnEnds) + tolerance;
    const column = columnEnds.findIndex((end) => end <= threshold);
    positions[i] = { x: column * (columnWidth + gap), y: columnEnds[column] };
    columnEnds[column] += heights[i] + gap;
  }

  const tallest = Math.max(...columnEnds);
  return { positions, totalHeight: tallest > 0 ? tallest - gap : 0 };
}

function getColumnCount(containerWidth) {
  if (containerWidth < MOBILE_BREAKPOINT) return 1;
  return Math.max(
    2,
    Math.floor((containerWidth + GAP) / (MIN_COLUMN_WIDTH + GAP)),
  );
}

function createCard(el) {
  const content = el.querySelector(".review-content");
  return {
    el,
    content,
    paragraphs: content ? readParagraphs(content) : [],
    font: null,
    prepared: [],
    // Height the card is currently placed with, and its real rendered size
    // once the browser has reported it.
    height: 0,
    measured: null,
  };
}

/** Best known height for a card at this column width. */
function resolveHeight(card, columnWidth, metrics) {
  if (card.measured && near(card.measured.width, columnWidth)) {
    return card.measured.height;
  }
  if (!metrics || !card.content) return card.height;
  try {
    return predictHeight(card, columnWidth, metrics);
  } catch {
    // Prediction is an optimisation; measurement will supply the truth.
    return card.height;
  }
}

/** Border-box size from a ResizeObserver entry (layout is clean here). */
function entrySize(entry) {
  const box = entry.borderBoxSize?.[0];
  if (box) return { width: box.inlineSize, height: box.blockSize };
  const rect = entry.target.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/**
 * Record a card's real size. Returns true when it differs from the height
 * the card was placed with, i.e. the cards below it need to move.
 */
function recordMeasurement(card, size, columnWidth) {
  // Ignore sizes reported for a column width we have since left.
  if (!near(size.width, columnWidth)) return false;
  card.measured = size;
  if (Math.abs(size.height - card.height) < HEIGHT_TOLERANCE) return false;
  card.height = size.height;
  return true;
}

function initMasonry(container) {
  const cards = Array.from(container.children, createCard);
  if (!cards.length) return;

  const sample = cards.find((card) => card.content);
  let containerWidth = 0;
  let columnWidth = 0;
  let columnCount = 1;

  const place = () => {
    const result = placeItems(
      cards.map((card) => card.height),
      columnCount,
      columnWidth,
      GAP,
      FLOW_TOLERANCE,
    );
    for (let i = 0; i < cards.length; i++) {
      const { x, y } = result.positions[i];
      cards[i].el.style.transform = `translate(${x}px,${y}px)`;
    }
    container.style.height = `${result.totalHeight}px`;
  };

  const relayout = (width) => {
    containerWidth = width;
    columnCount = getColumnCount(width);
    columnWidth = (width - GAP * (columnCount - 1)) / columnCount;

    const metrics = sample ? readMetrics(sample) : null;
    for (const card of cards) {
      card.height = resolveHeight(card, columnWidth, metrics);
      card.el.style.width = `${columnWidth}px`;
    }
    place();
    container.classList.add("masonry-ready");
  };

  // First layout runs synchronously so the page has its height before the
  // iframe-resizer script reads it.
  relayout(container.offsetWidth);

  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", () => relayout(container.offsetWidth));
    return;
  }

  // Width is watched on a zero-height sentinel rather than the container:
  // the container's height is written by this script, and observing it
  // would feed our own writes back into the observer.
  const sentinel = document.createElement("div");
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.style.height = "0";
  container.before(sentinel);

  new ResizeObserver((entries) => {
    const width = entries[entries.length - 1].contentRect.width;
    if (width > 0 && !near(width, containerWidth)) relayout(width);
  }).observe(sentinel);

  // Real card sizes arrive after layout and before paint. Only a card whose
  // rendered height differs from the height it was placed with triggers a
  // re-placement, which touches transforms only (no further layout).
  const cardByElement = new Map(cards.map((card) => [card.el, card]));
  const cardObserver = new ResizeObserver((entries) => {
    const moved = entries.filter((entry) =>
      recordMeasurement(
        cardByElement.get(entry.target),
        entrySize(entry),
        columnWidth,
      ),
    );
    if (moved.length) place();
  });
  for (const card of cards) cardObserver.observe(card.el);
}

const container = document.querySelector(".masonry-container");
if (container) initMasonry(container);
