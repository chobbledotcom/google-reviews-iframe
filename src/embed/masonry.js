/**
 * Masonry layout using real card measurements.
 *
 * Cards are given their final width first, then their actual height is
 * measured. Fixed "chrome height" predictions drift when the card layout
 * changes (source links, extra badges, imported testimonials), leaving
 * small gaps between cards in a column.
 */

const GAP = 20;
const MOBILE_BREAKPOINT = 601;

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

  // Set widths before measuring so text wraps at the final column width.
  for (const card of cards) card.style.width = `${colWidth}px`;

  // Measure the real card height. This is one read pass and avoids the
  // prediction drift that left columns slightly out of alignment.
  const heights = Array.from(cards, (card) => card.getBoundingClientRect().height);

  const result = computeMasonryLayout(heights, colCount, colWidth, GAP);

  // Batch write positions after measuring.
  for (let i = 0; i < cards.length; i++) {
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
