import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { filter, pipe } from "#toolkit/fp/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..", "..");

const CONFIG = {
  configPath: path.join(rootDir, "config.json"),
  reviewsDir: path.join(rootDir, "data"),
  imagesDir: path.join(rootDir, "images", "reviewers"),
  maxReviews: 9999,
};

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const [key, ...value] = line.split("=");
      if (key && value.length && !process.env[key]) {
        process.env[key] = value.join("=").trim();
      }
    }
  }
}

// Download image using curl and process with sharp
async function downloadImageWithCurl(url, filepath1x, filepath2x) {
  try {
    const result = execSync(`curl -s -L --max-time 30 "${url}"`, {
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
    });
    const buffer = Buffer.from(result);

    // Create 1x version (48x48)
    await sharp(buffer)
      .resize(48, 48, { fit: "cover" })
      .webp({ quality: 80 })
      .toFile(filepath1x);

    // Create 2x version (96x96) for retina
    await sharp(buffer)
      .resize(96, 96, { fit: "cover" })
      .webp({ quality: 80 })
      .toFile(filepath2x);

    return true;
  } catch (_err) {
    return false;
  }
}

// Download image from URL, resize to avatar dimensions, and save as WebP
function downloadAndProcessImage(url, userId) {
  return new Promise((resolve) => {
    if (!url || !userId) {
      resolve(false);
      return;
    }

    const dir = CONFIG.imagesDir;
    fs.mkdirSync(dir, { recursive: true });

    const filepath1x = path.join(dir, `${userId}.webp`);
    const filepath2x = path.join(dir, `${userId}@2x.webp`);

    // Skip if both files already exist
    if (fs.existsSync(filepath1x) && fs.existsSync(filepath2x)) {
      resolve(true);
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (_e) {
      resolve(false);
      return;
    }

    const protocol = urlObj.protocol === "https:" ? https : http;

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadAndProcessImage(response.headers.location, userId).then(
          resolve,
        );
        return;
      }

      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);

          // Create 1x version (48x48)
          await sharp(buffer)
            .resize(48, 48, { fit: "cover" })
            .webp({ quality: 80 })
            .toFile(filepath1x);

          // Create 2x version (96x96) for retina
          await sharp(buffer)
            .resize(96, 96, { fit: "cover" })
            .webp({ quality: 80 })
            .toFile(filepath2x);

          resolve(true);
        } catch (err) {
          console.warn(`Failed to process image for ${userId}: ${err.message}`);
          resolve(false);
        }
      });
    });

    request.on("error", async (err) => {
      // Fallback to curl on DNS errors
      if (
        err.code === "EAI_AGAIN" ||
        (err.message && err.message.includes("EAI_AGAIN"))
      ) {
        const result = await downloadImageWithCurl(url, filepath1x, filepath2x);
        resolve(result);
      } else {
        resolve(false);
      }
    });

    request.setTimeout(30000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function formatFilename(name, date) {
  const safeName = (name || "anonymous")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 30);
  const safeDate =
    date instanceof Date && !isNaN(date)
      ? date.toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];
  return `${safeName}-${safeDate}.json`;
}

function getLatestReviewDate(businessDir) {
  if (!fs.existsSync(businessDir)) {
    return null;
  }

  const reviewDates = [];
  const files = fs.readdirSync(businessDir);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = fs.readFileSync(path.join(businessDir, file), "utf8");
      const review = JSON.parse(content);
      const date = new Date(review.date);
      if (!isNaN(date)) {
        reviewDates.push(date);
      }
    } catch (error) {
      console.warn(`Error reading ${file}: ${error.message}`);
    }
  }

  if (reviewDates.length === 0) {
    return null;
  }

  // Return latest date (most recent review)
  const latestDate = new Date(Math.max(...reviewDates));
  // Add one day buffer to ensure we don't miss reviews from the same day
  latestDate.setDate(latestDate.getDate() + 1);
  return latestDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
}

function makeApiRequestHttps(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const request = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (response) => {
        let responseData = "";
        response.on("data", (chunk) => {
          responseData += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${responseData}`));
          } else {
            resolve(responseData);
          }
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(1200000, () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });

    request.write(postData);
    request.end();
  });
}

function makeApiRequestCurl(url, data) {
  const postData = JSON.stringify(data);
  const escapedData = postData.replace(/'/g, "'\\''");

  try {
    const result = execSync(
      `curl -s --max-time 1200 -X POST "${url}" -H "Content-Type: application/json" -d '${escapedData}'`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
    );
    return result;
  } catch (error) {
    throw new Error(`Curl request failed: ${error.message}`);
  }
}

async function makeApiRequest(url, data) {
  try {
    return await makeApiRequestHttps(url, data);
  } catch (error) {
    // Fallback to curl if https fails (e.g., DNS issues)
    if (error.code === "EAI_AGAIN" || error.message.includes("EAI_AGAIN")) {
      console.log("Using curl fallback due to DNS issues...");
      return makeApiRequestCurl(url, data);
    }
    throw error;
  }
}

/**
 * Fetch API response and parse as JSON array
 * @param {string} url - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<Array>} Parsed array response
 */
async function fetchApiArray(url, data) {
  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);

  if (!Array.isArray(results)) {
    throw new Error("Invalid API response format");
  }

  return results;
}

async function saveReview(review, outputDir, source = "google") {
  const filename = formatFilename(review.author, review.date);
  const filepath = path.join(outputDir, filename);

  if (fs.existsSync(filepath)) {
    return false; // Skip existing
  }

  // Download and process thumbnail if available
  let thumbnailPath = null;
  if (review.userId && review.photoUrl) {
    const downloaded = await downloadAndProcessImage(
      review.photoUrl,
      review.userId,
    );
    if (downloaded) {
      thumbnailPath = `/images/reviewers/${review.userId}.webp`;
    }
  }

  const reviewData = {
    author: review.author,
    authorUrl: review.authorUrl,
    rating: review.rating,
    content: review.content,
    date: review.date.toISOString(),
    userId: review.userId || null,
    thumbnail: thumbnailPath,
    source: source,
  };

  fs.writeFileSync(filepath, JSON.stringify(reviewData, null, 2));
  const thumbInfo = thumbnailPath ? " [with thumbnail]" : "";
  const ratingDisplay =
    source === "facebook"
      ? review.rating === 5
        ? "recommended"
        : "not recommended"
      : `${review.rating}/5 stars`;
  console.log(`✓ ${filename} (${ratingDisplay})${thumbInfo}`);
  return true;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG.configPath)) {
    throw new Error(`Config file not found: ${CONFIG.configPath}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG.configPath, "utf8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG.configPath, JSON.stringify(config, null, 2));
}

function shouldFetch(business, source = null) {
  // Support source-specific timestamps (last_fetched_google, last_fetched_facebook)
  // or fall back to generic last_fetched
  const timestampField = source ? `last_fetched_${source}` : "last_fetched";
  const lastFetchedStr = business[timestampField] || business.last_fetched;

  if (!lastFetchedStr) {
    return true; // Never fetched, so should fetch
  }

  const lastFetched = new Date(lastFetchedStr);
  const daysSinceFetch = Math.floor(
    (Date.now() - lastFetched) / (1000 * 60 * 60 * 24),
  );
  return daysSinceFetch >= business.fetch_frequency_days;
}

function updateLastFetched(business, source = null) {
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  if (source) {
    business[`last_fetched_${source}`] = timestamp;
  } else {
    business.last_fetched = timestamp;
  }
}

/**
 * Curried filter for businesses with a specific platform field
 * Uses the fp toolkit's filter function
 */
const filterByPlatform = (platformField) => filter((b) => b[platformField]);

/**
 * Curried filter for businesses by slug
 * Uses the fp toolkit's filter function
 */
const filterBySlug = (targetSlug) =>
  targetSlug ? filter((b) => b.slug === targetSlug) : (x) => x;

/**
 * Ensure business directory exists
 */
const ensureBusinessDir = (business) => {
  const dir = path.join(CONFIG.reviewsDir, business.slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Create a business processor for a specific platform
 * @param {object} options - Platform-specific configuration
 */
const createBusinessProcessor = (options) => {
  const { source, fetchReviews, getStartDate } = options;

  return async (business, businessDir) => {
    const fetchOptions = {
      maxReviews:
        business.number_of_reviews === -1
          ? CONFIG.maxReviews
          : business.number_of_reviews,
    };

    // Add start date if the platform supports it
    if (getStartDate) {
      fetchOptions.reviewsStartDate = getStartDate(businessDir);
    }

    const reviews = await fetchReviews(business, fetchOptions);

    // Filter by minimum star rating using toolkit's filter
    const meetsMinRating = (review) =>
      review.rating >= business.minimum_star_rating;
    const filteredReviews = filter(meetsMinRating)(reviews);

    let saved = 0;
    for (const review of filteredReviews) {
      const wasSaved = await saveReview(review, businessDir, source);
      if (wasSaved) saved++;
    }

    updateLastFetched(business, source);
    return saved;
  };
};

/**
 * Create a main runner function for a review platform
 * Uses pipe from fp toolkit for composing filters
 */
const createReviewFetcher = (options) => {
  const { platformField, source, envTokenName, fetchReviews, getStartDate } =
    options;

  const processBusinessReviews = createBusinessProcessor({
    source,
    fetchReviews,
    getStartDate,
  });

  return async () => {
    const targetSlug = process.argv[2];

    // Validate token
    if (!process.env[envTokenName]) {
      process.exit(1);
    }

    const config = loadConfig();

    // Filter businesses using pipe and curried functions from toolkit
    const businessesToProcess = pipe(
      filterByPlatform(platformField),
      filterBySlug(targetSlug),
    )(config);

    if (businessesToProcess.length === 0) {
      return;
    }

    try {
      for (const business of businessesToProcess) {
        // Check if we need to fetch based on frequency
        if (!shouldFetch(business, source)) {
          continue;
        }

        const businessDir = ensureBusinessDir(business);
        await processBusinessReviews(business, businessDir);
      }

      // Save updated config
      saveConfig(config);
    } catch (_error) {
      process.exit(1);
    }
  };
};

// Extract user ID from Google Maps contributor URL
const extractGoogleUserId = (authorUrl) => {
  if (!authorUrl) return null;
  const match = authorUrl.match(/\/contrib\/(\d+)/);
  return match ? match[1] : null;
};

export {
  CONFIG,
  loadEnv,
  downloadAndProcessImage,
  formatFilename,
  getLatestReviewDate,
  makeApiRequest,
  fetchApiArray,
  saveReview,
  loadConfig,
  saveConfig,
  shouldFetch,
  updateLastFetched,
  extractGoogleUserId,
  // FP-style fetching using toolkit
  pipe,
  filter,
  filterByPlatform,
  filterBySlug,
  ensureBusinessDir,
  createBusinessProcessor,
  createReviewFetcher,
};
