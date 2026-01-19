#!/usr/bin/env bun

import {
  createApifyFetcher,
  createReviewFetcher,
  loadEnv,
} from "./lib/shared.js";

loadEnv();

const TRUSTPILOT_ACTOR_ID = "4AQb7n4pXPxFQQ2w5";

// Create a stable user ID from Trustpilot review data
// Exported for testing
export const extractTrustpilotUserId = (review) =>
  review.reviewId ? `tp-${review.reviewId}` : null;

// Check if title should be stripped (body already contains it or is a truncated version)
const shouldStripTitle = (title, body) => {
  const lowerBody = body.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // Exact match - body starts with full title
  if (lowerBody.startsWith(lowerTitle)) return true;

  // Title was truncated with ellipsis, body contains the full text
  const ellipsisMatch = title.match(/^(.+?)(\.{3}|…\.?)$/);
  if (ellipsisMatch) {
    const titlePrefix = ellipsisMatch[1].trim().toLowerCase();
    if (lowerBody.startsWith(titlePrefix)) return true;
  }

  return false;
};

// Combine title and text, handling duplication and ellipsis truncation
// Exported for testing
export const buildTrustpilotContent = (reviewTitle, reviewText) => {
  const body = reviewText || "";

  if (!reviewTitle) return body;

  let title = reviewTitle.trim();

  if (shouldStripTitle(title, body)) return body;

  // Add period to title if it doesn't end with sentence punctuation
  if (!/[.!?]$/.test(title)) {
    title = `${title}.`;
  }

  // Return just title if body is empty
  return body ? `${title}\n\n${body}` : title;
};

// Transform raw review data to normalized format
// Exported for testing
export const normalizeTrustpilotReview = (review) => ({
  content: buildTrustpilotContent(review.reviewTitle, review.reviewText),
  date: review.date ? new Date(review.date) : new Date(),
  rating: Number.parseInt(review.ratingValue, 10) || 0,
  author: review.name || "Anonymous",
  authorUrl: review.url || "",
  photoUrl: review.avatar || "",
  userId: extractTrustpilotUserId(review),
  reviewTitle: review.reviewTitle || null,
});

// Create fetcher using shared helper
const fetchReviews = createApifyFetcher(
  TRUSTPILOT_ACTOR_ID,
  "trustpilot_url",
  normalizeTrustpilotReview,
);

// Create and run the fetcher
const main = createReviewFetcher({
  platformField: "trustpilot_url",
  source: "trustpilot",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
});

// Only run when executed directly (using && for single-line coverage)
import.meta.main && main();
