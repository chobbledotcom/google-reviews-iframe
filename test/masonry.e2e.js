import { expect, test } from "@playwright/test";

/**
 * Masonry layout tests.
 *
 * Whatever the review content looks like (line breaks, inline or block
 * markup, emoji, content pretext cannot predict), stacked cards must sit
 * exactly one gap apart: never overlapping, never drifting apart.
 */

const GAP = 20;
// The layout ignores height differences under 1px, plus sub-pixel rounding.
const TOLERANCE = 1.25;

// Measure the rendered layout: the vertical gap between each pair of
// neighbouring cards in a column, plus container bounds.
const measureLayout = (page) =>
  page.evaluate(() => {
    const container = document.querySelector(".masonry-container");
    const bounds = container.getBoundingClientRect();
    const cards = [...container.children].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        name: el.dataset.case || el.textContent.trim().slice(0, 30),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        visible: getComputedStyle(el).visibility === "visible",
      };
    });

    const columns = new Map();
    for (const card of cards) {
      const key = Math.round(card.left);
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(card);
    }

    const gaps = [];
    for (const column of columns.values()) {
      column.sort((a, b) => a.top - b.top);
      for (let i = 1; i < column.length; i++) {
        gaps.push({
          above: column[i - 1].name,
          below: column[i].name,
          gap: column[i].top - column[i - 1].bottom,
        });
      }
    }

    return {
      cardCount: cards.length,
      columnCount: columns.size,
      gaps,
      allVisible: cards.every((card) => card.visible),
      containerBottom: bounds.bottom,
      containerRight: bounds.right,
      lowestCard: Math.max(...cards.map((card) => card.bottom)),
      rightmostCard: Math.max(...cards.map((card) => card.right)),
    };
  });

const expectTidyLayout = (layout, label) => {
  expect(layout.allVisible, `${label}: cards revealed`).toBe(true);
  for (const { above, below, gap } of layout.gaps) {
    expect(
      Math.abs(gap - GAP),
      `${label}: gap between "${above}" and "${below}" is ${gap.toFixed(1)}px`,
    ).toBeLessThanOrEqual(TOLERANCE);
  }
  expect(
    Math.abs(layout.containerBottom - layout.lowestCard),
    `${label}: container height matches the lowest card`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    layout.rightmostCard,
    `${label}: cards stay inside the container`,
  ).toBeLessThanOrEqual(layout.containerRight + TOLERANCE);
};

const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

// Load the mixed-content fixture; returns the list page errors collect in.
const openFixture = async (page, width) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/test/fixtures/masonry-content.html");
  await settle(page);
  return errors;
};

const VIEWPORTS = [
  { width: 1280, columns: 4 },
  { width: 900, columns: 3 },
  { width: 640, columns: 2 },
  { width: 390, columns: 1 },
];

test.describe("masonry layout", () => {
  for (const { width, columns } of VIEWPORTS) {
    test(`mixed content never overlaps at ${width}px`, async ({ page }) => {
      const errors = await openFixture(page, width);

      const layout = await measureLayout(page);
      expect(layout.cardCount).toBe(11);
      expect(layout.columnCount).toBe(columns);
      expectTidyLayout(layout, `${width}px`);
      expect(errors).toEqual([]);
    });
  }

  test("stays tidy while the viewport is resized", async ({ page }) => {
    const errors = await openFixture(page, 1280);

    for (const width of [1000, 700, 600, 420, 1400, 1281]) {
      await page.setViewportSize({ width, height: 800 });
      await settle(page);
      expectTidyLayout(await measureLayout(page), `resized to ${width}px`);
    }
    expect(errors).toEqual([]);
  });

  test("re-places cards when content changes height after load", async ({
    page,
  }) => {
    await openFixture(page, 1280);

    await page.evaluate(() => {
      const content = document.querySelector(
        '[data-case="plain"] .review-content',
      );
      content.style.fontSize = "30px";
    });
    await settle(page);

    expectTidyLayout(await measureLayout(page), "after content grew");
  });

  test("real review pages never overlap", async ({ page }) => {
    for (const width of [1280, 700, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/db-entertainment");
      await settle(page);
      expectTidyLayout(await measureLayout(page), `db-entertainment ${width}px`);
    }
  });
});
