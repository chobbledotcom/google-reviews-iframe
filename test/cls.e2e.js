import { expect, test } from "@playwright/test";

/**
 * CLS (Cumulative Layout Shift) measurement tests
 *
 * These tests measure layout shift in the iframe content using the
 * PerformanceObserver API to capture layout-shift entries.
 *
 * With the new CSS-only two-column layout (no JavaScript masonry),
 * CLS should be zero or near-zero since layout is determined at
 * render time without any JavaScript manipulation.
 */

// Helper to wait for iframe to resize above minimum height
const waitForIframeResize = (page, minHeight = 200, timeout = 10000) =>
  page.waitForFunction(
    (min) => {
      const iframe = document.getElementById("test-iframe");
      const height = parseInt(iframe.style.height, 10);
      return height > min;
    },
    minHeight,
    { timeout },
  );

// Helper to measure CLS in a page or frame
async function measureCLS(locator, waitTime = 3000) {
  // Inject CLS observer with buffered: true to capture past shifts
  await locator.evaluate(() => {
    window.__clsValue = 0;
    window.__clsEntries = [];

    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__clsValue += entry.value;
          window.__clsEntries.push({
            value: entry.value,
            time: performance.now(),
            sources: entry.sources?.map((s) => ({
              node: s.node?.nodeName || "unknown",
              previousRect: s.previousRect,
              currentRect: s.currentRect,
            })),
          });
        }
      }
    });

    observer.observe({ type: "layout-shift", buffered: true });
    window.__clsObserver = observer;
  });

  // Wait for layout to settle
  await new Promise((resolve) => setTimeout(resolve, waitTime));

  // Get CLS results
  const result = await locator.evaluate(() => ({
    cls: window.__clsValue,
    entries: window.__clsEntries,
  }));

  return result;
}

test.describe("Cumulative Layout Shift (CLS) - Direct Page Load", () => {
  test("should have zero CLS for db-entertainment page", async ({ page }) => {
    // Navigate directly to db-entertainment page
    await page.goto("/db-entertainment");

    // Wait for body to be available
    const body = page.locator("body");
    await body.waitFor({ state: "visible" });

    // Measure CLS
    const clsResult = await measureCLS(body, 3000);

    console.log(`\n=== CLS Results for db-entertainment (DIRECT PAGE) ===`);
    console.log(`CLS Score: ${clsResult.cls.toFixed(4)}`);
    console.log(`Number of layout shifts: ${clsResult.entries.length}`);

    if (clsResult.entries.length > 0) {
      console.log("\nLayout shift details:");
      clsResult.entries.forEach((entry, i) => {
        console.log(
          `  Shift ${i + 1}: ${entry.value.toFixed(4)} at ${entry.time.toFixed(0)}ms`,
        );
        if (entry.sources) {
          entry.sources.forEach((source) => {
            console.log(`    - Element: ${source.node}`);
          });
        }
      });
    }

    // CLS thresholds (Google's Web Vitals):
    // Good: <= 0.1
    // Needs Improvement: 0.1 - 0.25
    // Poor: > 0.25
    expect(
      clsResult.cls,
      `CLS score ${clsResult.cls.toFixed(4)} exceeds threshold 0.1`,
    ).toBeLessThanOrEqual(0.1);
  });

  test("should have zero CLS for standard test child page", async ({
    page,
  }) => {
    // Navigate directly to child page
    await page.goto("/child");

    const body = page.locator("body");
    await body.waitFor({ state: "visible" });

    const clsResult = await measureCLS(body, 2000);

    console.log(`\n=== CLS Results for standard child (DIRECT PAGE) ===`);
    console.log(`CLS Score: ${clsResult.cls.toFixed(4)}`);
    console.log(`Number of layout shifts: ${clsResult.entries.length}`);

    expect(clsResult.cls).toBeLessThanOrEqual(0.1);
  });
});

test.describe("Cumulative Layout Shift (CLS) - Iframe Embed", () => {
  test("should have zero CLS for db-entertainment in iframe", async ({
    page,
  }) => {
    // Navigate to the parent page with db-entertainment iframe
    await page.goto("/parent-db-entertainment");

    // Wait for iframe to load
    const iframe = page.locator("#test-iframe");
    await expect(iframe).toBeVisible();

    // Get the frame and wait for body
    const frame = page.frameLocator("#test-iframe");
    const bodyLocator = frame.locator("body");
    await bodyLocator.waitFor({ state: "visible" });

    // Wait for iframe-resizer to initialize and resize the iframe
    await waitForIframeResize(page, 200, 15000);

    // Measure CLS inside the iframe
    const clsResult = await measureCLS(bodyLocator, 3000);

    console.log(`\n=== CLS Results for db-entertainment (IFRAME) ===`);
    console.log(`CLS Score: ${clsResult.cls.toFixed(4)}`);
    console.log(`Number of layout shifts: ${clsResult.entries.length}`);

    if (clsResult.entries.length > 0) {
      console.log("\nLayout shift details:");
      clsResult.entries.forEach((entry, i) => {
        console.log(
          `  Shift ${i + 1}: ${entry.value.toFixed(4)} at ${entry.time.toFixed(0)}ms`,
        );
      });
    }

    expect(
      clsResult.cls,
      `CLS score ${clsResult.cls.toFixed(4)} exceeds threshold 0.1`,
    ).toBeLessThanOrEqual(0.1);
  });

  test("should have zero CLS for standard child in iframe", async ({
    page,
  }) => {
    await page.goto("/parent");

    const iframe = page.locator("#test-iframe");
    await expect(iframe).toBeVisible();

    const frame = page.frameLocator("#test-iframe");
    const bodyLocator = frame.locator("body");
    await bodyLocator.waitFor({ state: "visible" });

    await waitForIframeResize(page);

    const clsResult = await measureCLS(bodyLocator, 2000);

    console.log(`\n=== CLS Results for standard child (IFRAME) ===`);
    console.log(`CLS Score: ${clsResult.cls.toFixed(4)}`);
    console.log(`Number of layout shifts: ${clsResult.entries.length}`);

    expect(clsResult.cls).toBeLessThanOrEqual(0.1);
  });
});
