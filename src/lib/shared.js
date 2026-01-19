import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  compact,
  filter,
  flatMap,
  map,
  pipe,
  reduce,
} from "#toolkit/fp/index.js";

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

// Get image file paths for a user
const getImagePaths = (userId) => {
  const dir = CONFIG.imagesDir;
  return {
    dir,
    filepath1x: path.join(dir, `${userId}.webp`),
    filepath2x: path.join(dir, `${userId}@2x.webp`),
  };
};

// Check if both image files already exist
const imageFilesExist = ({ filepath1x, filepath2x }) =>
  fs.existsSync(filepath1x) && fs.existsSync(filepath2x);

// Parse URL safely, returning null on error
const parseUrlSafe = (url) => {
  try {
    return new URL(url);
  } catch (_e) {
    return null;
  }
};

// Check if response is a redirect
const isRedirect = (response) =>
  response.statusCode >= 300 &&
  response.statusCode < 400 &&
  response.headers.location;

// Check if error is a DNS error that should fallback to curl
const isDnsError = (err) =>
  err.code === "EAI_AGAIN" || err.message?.includes("EAI_AGAIN");

// Process buffer into 1x and 2x images
const processImageBuffer = async (buffer, paths) => {
  await sharp(buffer)
    .resize(48, 48, { fit: "cover" })
    .webp({ quality: 80 })
    .toFile(paths.filepath1x);
  await sharp(buffer)
    .resize(96, 96, { fit: "cover" })
    .webp({ quality: 80 })
    .toFile(paths.filepath2x);
};

// Collect response chunks and process as image
const collectAndProcessImage = (response, paths, userId, resolve) => {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", async () => {
    try {
      await processImageBuffer(Buffer.concat(chunks), paths);
      resolve(true);
    } catch (err) {
      console.warn(`Failed to process image for ${userId}: ${err.message}`);
      resolve(false);
    }
  });
};

// Handle HTTP response for image download
const handleImageResponse = (response, paths, userId, resolve) => {
  if (response.statusCode !== 200) return resolve(false);
  collectAndProcessImage(response, paths, userId, resolve);
};

// Create error handler for image request
const createImageErrorHandler = (url, paths, resolve) => async (err) => {
  const result = isDnsError(err)
    ? await downloadImageWithCurl(url, paths.filepath1x, paths.filepath2x)
    : false;
  resolve(result);
};

// Create response handler for image request
const createResponseHandler = (paths, userId, resolve) => (response) => {
  if (isRedirect(response)) {
    return downloadAndProcessImage(response.headers.location, userId).then(
      resolve,
    );
  }
  handleImageResponse(response, paths, userId, resolve);
};

// Validate inputs for image download
const validateImageInputs = (url, userId) => url && userId;

// Get protocol module for URL
const getProtocolModule = (urlObj) =>
  urlObj.protocol === "https:" ? https : http;

// Setup request timeout
const setupTimeout = (request, resolve, ms = 30000) => {
  request.setTimeout(ms, () => {
    request.destroy();
    resolve(false);
  });
};

// Check preconditions for image download, returns { skip: boolean, result: boolean, paths, urlObj }
const checkImagePreconditions = (url, userId) => {
  if (!validateImageInputs(url, userId)) return { skip: true, result: false };

  const paths = getImagePaths(userId);
  fs.mkdirSync(paths.dir, { recursive: true });

  if (imageFilesExist(paths)) return { skip: true, result: true };

  const urlObj = parseUrlSafe(url);
  if (!urlObj) return { skip: true, result: false };

  return { skip: false, paths, urlObj };
};

// Download image from URL, resize to avatar dimensions, and save as WebP
function downloadAndProcessImage(url, userId) {
  return new Promise((resolve) => {
    const preconditions = checkImagePreconditions(url, userId);
    if (preconditions.skip) return resolve(preconditions.result);

    const { paths, urlObj } = preconditions;
    const request = getProtocolModule(urlObj).get(
      url,
      createResponseHandler(paths, userId, resolve),
    );

    request.on("error", createImageErrorHandler(url, paths, resolve));
    setupTimeout(request, resolve);
  });
}

function formatFilename(name, date) {
  const safeName = (name || "anonymous")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 30);
  const safeDate =
    date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];
  return `${safeName}-${safeDate}.json`;
}

// Read a JSON file safely, returning null on error
const readJsonSafe = (filepath) => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch (error) {
    console.warn(`Error reading ${filepath}: ${error.message}`);
    return null;
  }
};

// Parse a date safely, returning null for invalid dates
const parseDateSafe = (dateStr) => {
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Add days to a date (pure function)
const addDays = (days) => (date) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Format date as YYYY-MM-DD
const formatDateYMD = (date) => date.toISOString().split("T")[0];

function getLatestReviewDate(businessDir) {
  if (!fs.existsSync(businessDir)) return null;

  const files = fs.readdirSync(businessDir);

  const reviewDates = pipe(
    filter((f) => f.endsWith(".json")),
    map((f) => readJsonSafe(path.join(businessDir, f))),
    compact,
    map((review) => parseDateSafe(review.date)),
    compact,
  )(files);

  if (reviewDates.length === 0) return null;

  // Get latest date + 1 day buffer
  return pipe(
    reduce((max, d) => (d > max ? d : max), reviewDates[0]),
    addDays(1),
    formatDateYMD,
  )(reviewDates);
}

// Handle request timeout - extracted for testability
const handleApiTimeout = (request, reject) => () => {
  request.destroy();
  reject(new Error("Request timeout"));
};

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
    request.setTimeout(1200000, handleApiTimeout(request, reject));

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

// Handle API request error with DNS fallback - extracted for testability
const handleApiRequestError = (url, data, error) => {
  if (isDnsError(error)) {
    console.log("Using curl fallback due to DNS issues...");
    return makeApiRequestCurl(url, data);
  }
  throw error;
};

async function makeApiRequest(url, data) {
  try {
    return await makeApiRequestHttps(url, data);
  } catch (error) {
    return handleApiRequestError(url, data, error);
  }
}

// Validate that response is an array - extracted for testability
const validateArrayResponse = (results) => {
  if (!Array.isArray(results)) {
    throw new Error("Invalid API response format");
  }
  return results;
};

/**
 * Fetch API response and parse as JSON array
 * @param {string} url - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<Array>} Parsed array response
 */
async function fetchApiArray(url, data) {
  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);
  return validateArrayResponse(results);
}

// Try to download thumbnail, returning path or null
const tryDownloadThumbnail = async (review) => {
  if (!review.userId || !review.photoUrl) return null;
  const downloaded = await downloadAndProcessImage(
    review.photoUrl,
    review.userId,
  );
  return downloaded ? `/images/reviewers/${review.userId}.webp` : null;
};

// Format rating for display
const formatRating = (rating, source) =>
  source === "facebook"
    ? rating === 5
      ? "recommended"
      : "not recommended"
    : `${rating}/5 stars`;

// Build review data object for storage
const buildReviewData = (review, thumbnailPath, source) => ({
  author: review.author,
  authorUrl: review.authorUrl,
  rating: review.rating,
  content: review.content,
  date: review.date.toISOString(),
  userId: review.userId || null,
  thumbnail: thumbnailPath,
  source: source,
});

async function saveReview(review, outputDir, source = "google") {
  const filename = formatFilename(review.author, review.date);
  const filepath = path.join(outputDir, filename);

  if (fs.existsSync(filepath)) return false;

  const thumbnailPath = await tryDownloadThumbnail(review);
  const reviewData = buildReviewData(review, thumbnailPath, source);

  fs.writeFileSync(filepath, JSON.stringify(reviewData, null, 2));

  const thumbInfo = thumbnailPath ? " [with thumbnail]" : "";
  console.log(
    `✓ ${filename} (${formatRating(review.rating, source)})${thumbInfo}`,
  );
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
 * Shared content filter - reviews must have >5 characters
 */
const hasContent = (review) => review.content && review.content.length > 5;

/**
 * Curried filter for businesses with a specific platform field
 */
const filterByPlatform = (platformField) => filter((b) => b[platformField]);

/**
 * Curried filter for businesses by slug
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
 * Build fetch options from business config
 */
const buildFetchOptions = (business, businessDir, getStartDate) => ({
  maxReviews:
    business.number_of_reviews === -1
      ? CONFIG.maxReviews
      : business.number_of_reviews,
  ...(getStartDate && { reviewsStartDate: getStartDate(businessDir) }),
});

/**
 * Filter reviews by minimum rating
 */
const filterByMinRating = (minRating) =>
  filter((review) => review.rating >= minRating);

/**
 * Save reviews and return count saved
 */
const saveReviewsWithCount = async (reviews, businessDir, source) => {
  let saved = 0;
  for (const review of reviews) {
    if (await saveReview(review, businessDir, source)) saved++;
  }
  return saved;
};

/**
 * Create a business processor for a specific platform
 */
const createBusinessProcessor = (options) => {
  const { source, fetchReviews, getStartDate } = options;

  return async (business, businessDir) => {
    const fetchOptions = buildFetchOptions(business, businessDir, getStartDate);
    const reviews = await fetchReviews(business, fetchOptions);
    const filtered = filterByMinRating(business.minimum_star_rating)(reviews);

    const saved = await saveReviewsWithCount(filtered, businessDir, source);
    updateLastFetched(business, source);
    return saved;
  };
};

/**
 * Process businesses that need fetching
 */
const processBusinesses = async (
  businesses,
  processor,
  ensureDir,
  shouldProcess,
  source,
) => {
  for (const business of businesses) {
    if (!shouldProcess(business, source)) continue;
    await processor(business, ensureDir(business));
  }
};

/**
 * Create a main runner function for a review platform
 */
const createReviewFetcher = (options) => {
  const { platformField, source, envTokenName, fetchReviews, getStartDate } =
    options;

  const processor = createBusinessProcessor({
    source,
    fetchReviews,
    getStartDate,
  });

  return async () => {
    if (!process.env[envTokenName]) return process.exit(1);

    const config = loadConfig();
    const businesses = pipe(
      filterByPlatform(platformField),
      filterBySlug(process.argv[2]),
    )(config);

    if (businesses.length === 0) return;

    try {
      await processBusinesses(
        businesses,
        processor,
        ensureBusinessDir,
        shouldFetch,
        source,
      );
      saveConfig(config);
    } catch (_error) {
      process.exit(1);
    }
  };
};

/**
 * Create an Apify fetcher function with normalization pipeline
 * Reduces duplication across fetch-*.js files
 */
const createApifyFetcher = (
  actorId,
  urlField,
  normalize,
  extractReviews = (x) => x,
) => {
  const token = process.env.APIFY_API_TOKEN;

  return async (business, options = {}) => {
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`;
    const data = {
      startUrls: [{ url: business[urlField] }],
      maxReviews: options.maxReviews || CONFIG.maxReviews,
      ...options.extraParams,
    };

    const results = await fetchApiArray(url, data);

    return pipe(extractReviews, map(normalize), filter(hasContent))(results);
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
  // FP-style helpers
  hasContent,
  createApifyFetcher,
  pipe,
  filter,
  flatMap,
  map,
  filterByPlatform,
  filterBySlug,
  ensureBusinessDir,
  createBusinessProcessor,
  createReviewFetcher,
  // Business logic helpers
  buildFetchOptions,
  filterByMinRating,
  saveReviewsWithCount,
  processBusinesses,
  // Pure helpers for testing
  formatRating,
  buildReviewData,
  parseUrlSafe,
  isRedirect,
  isDnsError,
  handleApiTimeout,
  validateArrayResponse,
  handleApiRequestError,
  // Internal helpers exported for testing
  tryDownloadThumbnail,
  getImagePaths,
  imageFilesExist,
  downloadImageWithCurl,
  makeApiRequestHttps,
  makeApiRequestCurl,
  processImageBuffer,
  collectAndProcessImage,
  handleImageResponse,
  createImageErrorHandler,
  setupTimeout,
  // Additional internal helpers for full coverage
  createResponseHandler,
  validateImageInputs,
  getProtocolModule,
  checkImagePreconditions,
};
