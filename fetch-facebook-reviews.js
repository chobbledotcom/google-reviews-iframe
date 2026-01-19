#!/usr/bin/env node

import { filter, map, pipe } from "#toolkit/fp/index.js";
import {
  CONFIG,
  createReviewFetcher,
  fetchApiArray,
  loadEnv,
} from "./lib/shared.js";

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const FACEBOOK_ACTOR_ID = "dX3d80hsNMilEwjXG";

// Create a stable user ID from Facebook user data
const extractUserId = (user) => {
  if (!user) return null;
  // Use the numeric ID if available, otherwise hash the profile URL or name
  if (user.id && /^\d+$/.test(user.id)) {
    return `fb-${user.id}`;
  }
  // For pfbid-style IDs, use them directly with fb prefix
  if (user.id) {
    return `fb-${user.id.substring(0, 20)}`;
  }
  return null;
};

// Transform raw review data to normalized format
const normalizeReview = (review) => {
  const user = review.user || {};
  const userId = extractUserId(user);
  // Facebook uses isRecommended (boolean) instead of star ratings
  // Convert to 5 stars for recommended, 1 for not recommended
  const rating = review.isRecommended ? 5 : 1;

  return {
    content: review.text || "",
    date: review.date ? new Date(review.date) : new Date(),
    rating: rating,
    author: user.name || "Anonymous",
    authorUrl: review.url || user.profileUrl || "",
    photoUrl: user.profilePic || "",
    userId: userId,
    isRecommended: review.isRecommended,
  };
};

// Filter reviews with sufficient content
const hasContent = (review) => review.content && review.content.length > 5;

async function fetchReviews(business, options = {}) {
  const url = `https://api.apify.com/v2/acts/${FACEBOOK_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: business.facebook_page_url }],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
  };

  const results = await fetchApiArray(url, data);

  // Use pipe with fp toolkit functions: map -> filter
  return pipe(map(normalizeReview), filter(hasContent))(results);
}

// Create and run the fetcher using the shared factory
// Facebook doesn't support date filtering, so no getStartDate
const main = createReviewFetcher({
  platformField: "facebook_page_url",
  source: "facebook",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
});

main();
