#!/usr/bin/env bun

import {
  createApifyFetcher,
  createReviewFetcher,
  loadEnv,
} from "./lib/shared.js";

loadEnv();

const FACEBOOK_ACTOR_ID = "dX3d80hsNMilEwjXG";

// Create a stable user ID from Facebook user data
// Exported for testing
export const extractFacebookUserId = (user) => {
  if (!user) return null;
  if (user.id && /^\d+$/.test(user.id)) return `fb-${user.id}`;
  if (user.id) return `fb-${user.id.substring(0, 20)}`;
  return null;
};

// Transform raw review data to normalized format
// Exported for testing
export const normalizeFacebookReview = (review) => {
  const user = review.user || {};
  return {
    content: review.text || "",
    date: review.date ? new Date(review.date) : new Date(),
    rating: review.isRecommended ? 5 : 1,
    author: user.name || "Anonymous",
    authorUrl: review.url || user.profileUrl || "",
    photoUrl: user.profilePic || "",
    userId: extractFacebookUserId(user),
    isRecommended: review.isRecommended,
  };
};

// Create fetcher using shared helper
const fetchReviews = createApifyFetcher(
  FACEBOOK_ACTOR_ID,
  "facebook_page_url",
  normalizeFacebookReview,
);

// Create and run the fetcher
const main = createReviewFetcher({
  platformField: "facebook_page_url",
  source: "facebook",
  envTokenName: "APIFY_API_TOKEN",
  fetchReviews,
});

// Only run when executed directly (using && for single-line coverage)
import.meta.main && main();
