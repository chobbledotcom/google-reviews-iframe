/**
 * Parent embed script for Google/Facebook Reviews iframes
 * Bundles iframe-resizer parent and auto-initializes review iframes
 */

import iframeResize from "@iframe-resizer/parent";

/**
 * Auto-initialize iFrame Resizer for Reviews embeds
 * Automatically resizes any iframe with class "google-reviews-iframe"
 */
function initReviewsIframes() {
  const iframes = document.querySelectorAll(".google-reviews-iframe");
  if (iframes.length === 0) {
    return;
  }

  iframeResize(
    {
      log: false,
      checkOrigin: false,
      license: "GPLv3",
    },
    ".google-reviews-iframe",
  );
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initReviewsIframes);
} else {
  initReviewsIframes();
}
