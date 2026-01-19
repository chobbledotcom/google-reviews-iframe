#!/usr/bin/env bun

import { filter, map, pipe } from "#toolkit/fp/index.js";
import {
  CONFIG,
  createReviewFetcher,
  fetchApiArray,
  loadEnv,
} from "./lib/shared.js";

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const TRUSTPILOT_ACTOR_ID = "4AQb7n4pXPxFQQ2w5";

// Create a stable user ID from Trustpilot review data
const extractUserId = (review) => {
  if (!review.reviewId) return null;
  // Use the review ID with tp prefix for Trustpilot
  return `tp-${review.reviewId}`;
};

// Transform raw review data to normalized format
const normalizeReview = (review) => {
  const userId = extractUserId(review);
  // Trustpilot uses 1-5 star ratings as strings
  const rating = Number.parseInt(review.ratingValue, 10) || 0;

  // Combine title and text if both exist
  let content;
  if (review.reviewTitle) {
    let title = review.reviewTitle.trim();
    const body = review.reviewText || "";

    // Skip title if body already starts with it (avoids duplication)
    if (body.toLowerCase().startsWith(title.toLowerCase())) {
      content = body;
    } else {
      // Add period to title if it doesn't end with sentence punctuation
      if (!/[.!?]$/.test(title)) {
        title = `${title}.`;
      }
      content = `${title}\n\n${body}`;
    }
  } else {
    content = review.reviewText || "";
  }

  return {
    content: content.trim(),
    date: review.date ? new Date(review.date) : new Date(),
    rating: rating,
    author: review.name || "Anonymous",
    authorUrl: review.url || "",
    photoUrl: review.avatar || "",
    userId: userId,
    reviewTitle: review.reviewTitle || null,
  };
};

// Filter reviews with sufficient content
const hasContent = (review) => review.content && review.content.length > 5;

async function fetchReviews(business, options = {}) {
  const url = `https://api.apify.com/v2/acts/${TRUSTPILOT_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: business.trustpilot_url }],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
  };

  const results = await fetchApiArray(url, data);

  // Use pipe with fp toolkit functions: map -> filter
  return pipe(map(normalizeReview), filter(hasContent))(results);
}

// Create and run the fetcher using the shared factory
// Trustpilot doesn't support date filtering in this actor, so no getStartDate
const main = createReviewFetcher({
  platformField: "trustpilot_url",
  source: "trustpilot",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
});

main();
