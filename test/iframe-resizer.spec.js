import { expect, test } from "@playwright/test";

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
    await page.waitForFunction(
      () => {
        const iframe = document.getElementById("test-iframe");
        const height = parseInt(iframe.style.height, 10);
        // iframe-resizer sets the height dynamically, should be > 200px
        return height > 200;
      },
      { timeout: 10000 },
    );

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
    await page.waitForFunction(
      () => {
        const iframe = document.getElementById("test-iframe");
        const height = parseInt(iframe.style.height, 10);
        return height > 200;
      },
      { timeout: 10000 },
    );

    // Get the displayed height from the height monitor
    const displayedHeight = await page.locator("#current-height").textContent();

    // Get the actual iframe height
    const actualHeight = await page
      .locator("#test-iframe")
      .evaluate((el) => el.style.height);

    // They should match (displayed height contains the same value as style.height)
    expect(displayedHeight).toContain(actualHeight.replace("px", ""));
  });
});
