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

// Combine title and text with double newline
// Exported for testing
export const buildTrustpilotContent = (title, text) =>
  title ? `${title}\n\n${text || ""}`.trim() : (text || "").trim();

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
