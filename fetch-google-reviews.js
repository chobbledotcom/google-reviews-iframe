#!/usr/bin/env bun

import { filter, flatMap, map, pipe } from "#toolkit/fp/index.js";
import {
  CONFIG,
  createReviewFetcher,
  extractGoogleUserId,
  fetchApiArray,
  getLatestReviewDate,
  loadEnv,
} from "./lib/shared.js";

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const GOOGLE_ACTOR_ID = "nwua9Gu5YrADL7ZDj";

// Transform raw review data to normalized format
const normalizeReview = (review) => {
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

// Filter reviews with sufficient content
const hasContent = (review) => review.content.length > 5;

async function fetchReviews(business, options = {}) {
  const url = `https://api.apify.com/v2/acts/${GOOGLE_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [
      {
        url: `https://www.google.com/maps/place/?q=place_id:${business.google_business_id}`,
      },
    ],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
    reviewsSort: options.sort || "newest",
    language: options.language || "en",
  };

  if (options.reviewsStartDate) {
    data.reviewsStartDate = options.reviewsStartDate;
  }

  const results = await fetchApiArray(url, data);

  // Use pipe with fp toolkit functions: flatMap -> map -> filter
  return pipe(
    flatMap((item) => item.reviews || []),
    map(normalizeReview),
    filter(hasContent),
  )(results);
}

// Create and run the fetcher using the shared factory
const main = createReviewFetcher({
  platformField: "google_business_id",
  source: "google",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
  getStartDate: getLatestReviewDate,
});

main();
