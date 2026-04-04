/**
 * Masonry layout using @chenglou/pretext for height prediction.
 *
 * This bypasses DOM reflowing entirely -- card heights are predicted
 * from font metrics alone (via OffscreenCanvas), then positions are
 * computed with the greedy shortest-column algorithm from pretext-masonry.
 *
 * Zero reflows. Zero offsetHeight reads. Just math.
 */
import { layout, prepare } from "@chenglou/pretext";

const GAP = 20;
const MOBILE_BREAKPOINT = 601;

// Match the font stack and sizing from iframe-layout.html
const CONTENT_FONT =
  '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif';
const CONTENT_LINE_HEIGHT = 25.6; // 16px * 1.6 (line-height: 1.6 on .review-content)

// Fixed heights for card chrome (header, padding, gaps)
const CARD_PADDING = 20;
const CARD_PADDING_SIDE = 20;
const HEADER_HEIGHT = 48; // .review-header height
const HEADER_MARGIN_BOTTOM = 15;
const BORDER_WIDTH = 1; // 1px solid border on all sides
const CARD_CHROME_HEIGHT =
  CARD_PADDING +
  HEADER_HEIGHT +
  HEADER_MARGIN_BOTTOM +
  CARD_PADDING +
  BORDER_WIDTH * 2; // top + bottom border

/**
 * Predict text height using pretext font metrics.
 * Ported from pretext-masonry/src/heightPredictor.ts
 */
function predictTextHeight(text, contentWidth) {
  const prepared = prepare(text, CONTENT_FONT);
  const result = layout(prepared, contentWidth, CONTENT_LINE_HEIGHT);
  return result.height;
}

/**
 * Predict a single card's height using pretext font metrics.
 */
function predictCardHeight(textContent, availableWidth) {
  const contentWidth = availableWidth - CARD_PADDING_SIDE * 2 - BORDER_WIDTH * 2; // left + right border
  let totalHeight = CARD_CHROME_HEIGHT;

  if (textContent?.trim()) {
    totalHeight += predictTextHeight(textContent, contentWidth);
  }

  return totalHeight;
}

/**
 * Find the index of the shortest column.
 */
function findShortestColumn(columnHeights, columnCount) {
  let shortest = 0;
  for (let c = 1; c < columnCount; c++) {
    if (columnHeights[c] < columnHeights[shortest]) shortest = c;
  }
  return shortest;
}

/**
 * Greedy shortest-column masonry layout.
 * Ported from pretext-masonry/src/layoutEngine.ts
 */
function computeMasonryLayout(heights, columnCount, columnWidth, gap) {
  const columnHeights = new Float64Array(columnCount);
  const positions = new Array(heights.length);

  for (let i = 0; i < heights.length; i++) {
    const shortest = findShortestColumn(columnHeights, columnCount);

    positions[i] = {
      x: shortest * (columnWidth + gap),
      y: columnHeights[shortest],
    };

    columnHeights[shortest] += heights[i] + gap;
  }

  const maxH = Math.max(...columnHeights);
  return {
    positions,
    totalHeight: maxH > 0 ? maxH - gap : 0,
  };
}

function getColumnCount(containerWidth) {
  if (containerWidth < MOBILE_BREAKPOINT) return 1;
  return Math.max(2, Math.floor((containerWidth + GAP) / (280 + GAP)));
}

function layoutMasonry() {
  const container = document.querySelector(".masonry-container");
  if (!container) return;

  const cards = container.children;
  if (!cards.length) return;

  const containerWidth = container.offsetWidth;
  const colCount = getColumnCount(containerWidth);
  const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;

  // Predict all card heights using pretext -- zero DOM measurement
  const heights = Array.from(cards, (card) => {
    const contentEl = card.querySelector(".review-content");
    const text = contentEl ? contentEl.textContent || "" : "";
    return predictCardHeight(text, colWidth);
  });

  const result = computeMasonryLayout(heights, colCount, colWidth, GAP);

  // Batch write: set all positions and widths in one pass (single paint, zero reflow)
  for (let i = 0; i < cards.length; i++) {
    cards[i].style.width = `${colWidth}px`;
    cards[i].style.transform =
      `translate(${result.positions[i].x}px,${result.positions[i].y}px)`;
  }
  container.style.height = `${result.totalHeight}px`;
  container.classList.add("masonry-ready");
}

// Run layout once DOM is ready
layoutMasonry();

// Debounced re-layout on resize
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layoutMasonry, 100);
});
