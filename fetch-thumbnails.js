#!/usr/bin/env node

/**
 * Fetches and saves reviewer thumbnails for existing reviews
 * This script re-fetches reviews from Apify to get photo URLs,
 * then downloads thumbnails and updates existing review JSON files
 */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filter, flatMap, pipe } from "#toolkit/fp/index.js";
import {
  CONFIG,
  extractGoogleUserId,
  fetchApiArray,
  loadConfig,
  loadEnv,
} from "./lib/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const GOOGLE_ACTOR_ID = "nwua9Gu5YrADL7ZDj";

// Download image from URL and save locally
function downloadImage(url, filepath) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }

    // Ensure directory exists
    const dir = path.dirname(filepath);
    fs.mkdirSync(dir, { recursive: true });

    // Skip if file already exists
    if (fs.existsSync(filepath)) {
      resolve(true);
      return;
    }

    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadImage(response.headers.location, filepath).then(resolve);
        return;
      }

      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        resolve(true);
      });

      fileStream.on("error", () => {
        fs.unlink(filepath, () => {}); // Delete partial file
        resolve(false);
      });
    });

    request.on("error", () => {
      resolve(false);
    });

    request.setTimeout(30000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

// Check if review has valid author URL and photo URL
const hasValidPhotoData = (review) => {
  const authorUrl = review.reviewerUrl || review.authorUrl || "";
  const photoUrl =
    review.reviewerPhotoUrl ||
    review.userPhotoUrl ||
    review.reviewerAvatar ||
    "";
  return authorUrl && photoUrl;
};

// Extract photo mapping from a review
const toPhotoMapping = (review) => {
  const authorUrl = review.reviewerUrl || review.authorUrl || "";
  const photoUrl =
    review.reviewerPhotoUrl ||
    review.userPhotoUrl ||
    review.reviewerAvatar ||
    "";
  return [authorUrl, photoUrl];
};

async function fetchReviewsWithPhotos(placeId) {
  const url = `https://api.apify.com/v2/acts/${GOOGLE_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [
      { url: `https://www.google.com/maps/place/?q=place_id:${placeId}` },
    ],
    maxReviews: CONFIG.maxReviews,
    reviewsSort: "newest",
    language: "en",
  };
  const results = await fetchApiArray(url, data);

  // Use pipe with toolkit functions to build the photo map
  const photoEntries = pipe(
    flatMap((item) => item.reviews || []),
    filter(hasValidPhotoData),
  )(results);

  const photoMap = new Map();
  for (const review of photoEntries) {
    const [authorUrl, photoUrl] = toPhotoMapping(review);
    photoMap.set(authorUrl, photoUrl);
  }

  return photoMap;
}

// Process a single review file
async function processReviewFile(filepath, photoMap) {
  const content = fs.readFileSync(filepath, "utf8");
  const review = JSON.parse(content);

  // Skip if already has thumbnail
  if (review.thumbnail) {
    return { updated: false, downloaded: false };
  }

  // Try to get photo URL from map
  const photoUrl = photoMap.get(review.authorUrl);
  if (!photoUrl) {
    return { updated: false, downloaded: false };
  }

  // Extract user ID
  const userId = extractGoogleUserId(review.authorUrl);
  if (!userId) {
    return { updated: false, downloaded: false };
  }

  // Download thumbnail
  const imageFilename = `${userId}.jpg`;
  const imagePath = path.join(CONFIG.imagesDir, imageFilename);
  const alreadyExists = fs.existsSync(imagePath);
  const success = await downloadImage(photoUrl, imagePath);

  if (success) {
    // Update review with thumbnail path
    review.userId = userId;
    review.thumbnail = `/images/reviewers/${imageFilename}`;
    fs.writeFileSync(filepath, JSON.stringify(review, null, 2));
    return { updated: true, downloaded: !alreadyExists };
  }

  return { updated: false, downloaded: false };
}

async function updateExistingReviews(businessDir, photoMap) {
  const files = fs.readdirSync(businessDir);
  const reviewFiles = filter((file) => file.endsWith(".json"))(files);

  let updated = 0;
  let downloaded = 0;

  for (const file of reviewFiles) {
    const filepath = path.join(businessDir, file);
    try {
      const result = await processReviewFile(filepath, photoMap);
      if (result.updated) updated++;
      if (result.downloaded) downloaded++;
    } catch (_error) {
      // Skip files that can't be processed
    }
  }

  return { updated, downloaded };
}

// Process a single business
async function processBusiness(business) {
  const businessDir = path.join(CONFIG.reviewsDir, business.slug);
  if (!fs.existsSync(businessDir)) {
    return { updated: 0, downloaded: 0 };
  }

  const photoMap = await fetchReviewsWithPhotos(business.google_business_id);
  return updateExistingReviews(businessDir, photoMap);
}

async function main() {
  const targetSlug = process.argv[2];

  if (!APIFY_API_TOKEN) {
    process.exit(1);
  }

  const config = loadConfig();

  const businessesToProcess = targetSlug
    ? filter((business) => business.slug === targetSlug)(config)
    : config;

  if (businessesToProcess.length === 0) {
    process.exit(1);
  }

  // Ensure images directory exists
  fs.mkdirSync(CONFIG.imagesDir, { recursive: true });

  for (const business of businessesToProcess) {
    try {
      await processBusiness(business);
    } catch (_error) {
      // Continue with next business
    }
  }
}

main();
