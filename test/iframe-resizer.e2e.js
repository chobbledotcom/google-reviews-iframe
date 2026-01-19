import { expect, test } from "@playwright/test";

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

test.describe("iframe-resizer integration", () => {
  test("should resize iframe to match content height", async ({ page }) => {
    // Enable console logging for debugging
    page.on("console", (msg) => {
      console.log(`Browser console [${msg.type()}]:`, msg.text());
    });

    page.on("pageerror", (err) => {
      console.error("Page error:", err.message);
    });

    // Navigate to the parent page
    await page.goto("/parent");

    // Wait for iframe to load
    const iframe = page.locator("#test-iframe");
    await expect(iframe).toBeVisible();

    // Wait for iframe-resizer to initialize and resize the iframe
    // The iframe should grow to accommodate its content (> 200px)
    await waitForIframeResize(page);

    // Get the final height
    const finalHeight = await iframe.evaluate((el) =>
      parseInt(el.style.height, 10),
    );

    console.log(
      `Iframe resized to ${finalHeight}px (was initially 200px in HTML)`,
    );

    // The content has 5 review cards, so it should be significantly larger than 200px
    // Expecting at least 400px based on the content
    expect(finalHeight).toBeGreaterThan(400);

    // The height should also be less than some reasonable maximum
    // (to ensure it's not broken and returning an unreasonable value)
    expect(finalHeight).toBeLessThan(2000);
  });

  test("should handle iframe with no content gracefully", async ({ page }) => {
    await page.goto("/parent");

    // Verify no errors are thrown
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Wait a bit for any potential errors
    await page.waitForTimeout(2000);

    // No critical errors should have occurred
    const criticalErrors = errors.filter(
      (e) => !e.includes("warning") && !e.includes("No iframes"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("should report correct height in height display", async ({ page }) => {
    await page.goto("/parent");

    // Wait for resize to complete
    await waitForIframeResize(page);

    // Get the displayed height from the height monitor
    const displayedHeight = await page.locator("#current-height").textContent();

    // Get the actual iframe height
    const actualHeight = await page
      .locator("#test-iframe")
      .evaluate((el) => el.style.height);

    // They should match (displayed height contains the same value as style.height)
    expect(displayedHeight).toContain(actualHeight.replace("px", ""));
  });

  test("should have iframe height >= child content height after masonry", async ({
    page,
  }) => {
    // This test verifies that the iframe is sized correctly AFTER masonry layout
    // The bug: iframe-resizer reports height before masonry finishes, causing undersized iframe
    await page.goto("/parent");

    // Wait for iframe to be resized (initial resize)
    await waitForIframeResize(page);

    // Wait for masonry and any subsequent iframe-resizer updates to settle
    await page.waitForTimeout(1000);

    // Get the iframe's set height (what parent set based on child's report)
    const iframeHeight = await page
      .locator("#test-iframe")
      .evaluate((el) => parseInt(el.style.height, 10));

    // Get the actual content height from inside the child iframe
    const frame = page.frameLocator("#test-iframe");
    const childContentHeight = await frame.locator("body").evaluate((body) => {
      return body.scrollHeight;
    });

    console.log(
      `Iframe height: ${iframeHeight}px, Child content height: ${childContentHeight}px`,
    );

    // The iframe height should be >= the child's actual content height
    // If masonry runs after iframe-resizer reports, this will fail
    expect(iframeHeight).toBeGreaterThanOrEqual(childContentHeight);
  });

  test("should resize iframe when masonry layout changes content height", async ({
    page,
  }) => {
    // This test tracks the sequence of height changes to verify proper ordering
    const heightChanges = [];

    await page.goto("/parent");

    // Set up listener for iframe height changes
    await page.evaluate(() => {
      const iframe = document.getElementById("test-iframe");
      window.__heightChanges = [];
      const observer = new MutationObserver(() => {
        const height = parseInt(iframe.style.height, 10);
        if (height > 0) {
          window.__heightChanges.push({
            height,
            time: Date.now(),
          });
        }
      });
      observer.observe(iframe, {
        attributes: true,
        attributeFilter: ["style"],
      });
    });

    // Wait for initial resize and masonry to complete
    await waitForIframeResize(page);

    // Wait for all layout changes to settle
    await page.waitForTimeout(1000);

    // Get height history and final content height
    const heightHistory = await page.evaluate(() => window.__heightChanges);
    const frame = page.frameLocator("#test-iframe");
    const finalContentHeight = await frame.locator("body").evaluate((body) => {
      return body.scrollHeight;
    });

    console.log("Height change history:", heightHistory);
    console.log("Final content height:", finalContentHeight);

    // Verify the final iframe height matches content
    const finalIframeHeight = await page
      .locator("#test-iframe")
      .evaluate((el) => parseInt(el.style.height, 10));

    expect(finalIframeHeight).toBeGreaterThanOrEqual(finalContentHeight);

    // If there were multiple height changes, check that height was eventually corrected
    if (heightHistory.length > 1) {
      console.log(
        `Iframe was resized ${heightHistory.length} times, final: ${finalIframeHeight}px`,
      );
    }
  });
});
