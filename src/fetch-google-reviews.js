#!/usr/bin/env bun

import {
  CONFIG,
  createReviewFetcher,
  extractGoogleUserId,
  fetchApiArray,
  filter,
  flatMap,
  getLatestReviewDate,
  hasContent,
  loadEnv,
  map,
  pipe,
} from "./lib/shared.js";

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const GOOGLE_ACTOR_ID = "nwua9Gu5YrADL7ZDj";

// Transform raw review data to normalized format
// Exported for testing
export const normalizeGoogleReview = (review) => {
  const authorUrl = review.reviewerUrl || review.authorUrl || "";
  return {
    content: review.text || review.reviewText || "",
    date: review.publishedAtDate
      ? new Date(review.publishedAtDate)
      : new Date(),
    rating: review.stars || review.rating || 0,
    author: review.name || review.authorName || "Anonymous",
    authorUrl: authorUrl,
    photoUrl:
      review.reviewerPhotoUrl ||
      review.userPhotoUrl ||
      review.reviewerAvatar ||
      "",
    userId: extractGoogleUserId(authorUrl),
  };
};

// Build Google Maps URL from place ID
// Exported for testing
export const buildGoogleMapsUrl = (placeId) =>
  `https://www.google.com/maps/place/?q=place_id:${placeId}`;

// Extract reviews from API response item
// Exported for testing
export const extractReviewsFromItem = (item) => item.reviews || [];

// Exported for testing
export async function fetchReviews(business, options = {}) {
  const url = `https://api.apify.com/v2/acts/${GOOGLE_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: buildGoogleMapsUrl(business.google_business_id) }],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
    reviewsSort: options.sort || "newest",
    language: options.language || "en",
    ...(options.reviewsStartDate && {
      reviewsStartDate: options.reviewsStartDate,
    }),
  };

  const results = await fetchApiArray(url, data);

  return pipe(
    flatMap(extractReviewsFromItem),
    map(normalizeGoogleReview),
    filter(hasContent),
  )(results);
}

// Create and run the fetcher
const main = createReviewFetcher({
  platformField: "google_business_id",
  source: "google",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
  getStartDate: getLatestReviewDate,
});

// Only run when executed directly (using && for single-line coverage)
import.meta.main && main();
