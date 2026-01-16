#!/usr/bin/env node

/**
 * Fetches and saves reviewer thumbnails for existing reviews
 * This script re-fetches reviews from Apify to get photo URLs,
 * then downloads thumbnails and updates existing review JSON files
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...value] = line.split('=');
      if (key && value.length && !process.env[key]) {
        process.env[key] = value.join('=').trim();
      }
    });
}

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const CONFIG = {
  configPath: path.join(__dirname, 'config.json'),
  reviewsDir: path.join(__dirname, 'reviews'),
  imagesDir: path.join(__dirname, 'images', 'reviewers'),
  actorId: 'nwua9Gu5YrADL7ZDj',
  maxReviews: 9999
};

// Extract user ID from Google Maps contributor URL
function extractUserId(authorUrl) {
  if (!authorUrl) return null;
  const match = authorUrl.match(/\/contrib\/(\d+)/);
  return match ? match[1] : null;
}

// Download image from URL and save locally
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
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
    const protocol = urlObj.protocol === 'https:' ? https : require('http');

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });

      fileStream.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Delete partial file
        resolve(false);
      });
    });

    request.on('error', () => {
      resolve(false);
    });

    request.setTimeout(30000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function makeApiRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const request = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, response => {
      let responseData = '';
      response.on('data', chunk => responseData += chunk);
      response.on('end', () => {
        if (response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}: ${responseData}`));
        } else {
          resolve(responseData);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(1200000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.write(postData);
    request.end();
  });
}

async function fetchReviewsWithPhotos(placeId) {
  const url = `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: `https://www.google.com/maps/place/?q=place_id:${placeId}` }],
    maxReviews: CONFIG.maxReviews,
    reviewsSort: 'newest',
    language: 'en'
  };

  console.log('Fetching reviews from Apify...');
  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);

  if (!Array.isArray(results)) {
    throw new Error('Invalid API response format');
  }

  // Create a map of authorUrl -> photoUrl for easy lookup
  const photoMap = new Map();
  results.flatMap(item => item.reviews || []).forEach(review => {
    const authorUrl = review.reviewerUrl || review.authorUrl || '';
    const photoUrl = review.reviewerPhotoUrl || review.userPhotoUrl || review.reviewerAvatar || '';
    if (authorUrl && photoUrl) {
      photoMap.set(authorUrl, photoUrl);
    }
  });

  return photoMap;
}

async function updateExistingReviews(businessDir, photoMap) {
  const reviewFiles = fs.readdirSync(businessDir)
    .filter(file => file.endsWith('.json'));

  let updated = 0;
  let downloaded = 0;

  for (const file of reviewFiles) {
    const filepath = path.join(businessDir, file);
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const review = JSON.parse(content);

      // Skip if already has thumbnail
      if (review.thumbnail) {
        continue;
      }

      // Try to get photo URL from map
      const photoUrl = photoMap.get(review.authorUrl);
      if (!photoUrl) {
        continue;
      }

      // Extract user ID
      const userId = extractUserId(review.authorUrl);
      if (!userId) {
        continue;
      }

      // Download thumbnail
      const imageFilename = `${userId}.jpg`;
      const imagePath = path.join(CONFIG.imagesDir, imageFilename);
      const success = await downloadImage(photoUrl, imagePath);

      if (success) {
        // Update review with thumbnail path
        review.userId = userId;
        review.thumbnail = `/images/reviewers/${imageFilename}`;
        fs.writeFileSync(filepath, JSON.stringify(review, null, 2));
        updated++;
        if (!fs.existsSync(imagePath)) {
          downloaded++;
        }
        console.log(`✓ Updated ${file} with thumbnail`);
      }
    } catch (error) {
      console.warn(`Error processing ${file}: ${error.message}`);
    }
  }

  return { updated, downloaded };
}

async function main() {
  const args = process.argv.slice(2);
  const targetSlug = args[0];

  if (!APIFY_API_TOKEN) {
    console.error('Error: APIFY_API_TOKEN required in .env file');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.configPath)) {
    console.error(`Error: ${CONFIG.configPath} not found`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG.configPath, 'utf8'));

  const businessesToProcess = targetSlug
    ? config.filter(business => business.slug === targetSlug)
    : config;

  if (businessesToProcess.length === 0) {
    console.error(targetSlug ? `Business with slug "${targetSlug}" not found` : 'No businesses found in config');
    process.exit(1);
  }

  // Ensure images directory exists
  fs.mkdirSync(CONFIG.imagesDir, { recursive: true });

  let totalUpdated = 0;
  let totalDownloaded = 0;

  for (const business of businessesToProcess) {
    console.log(`\n=== Processing ${business.slug} ===`);

    const businessDir = path.join(CONFIG.reviewsDir, business.slug);
    if (!fs.existsSync(businessDir)) {
      console.log(`No reviews directory found for ${business.slug}`);
      continue;
    }

    try {
      // Fetch photo URLs from Apify
      const photoMap = await fetchReviewsWithPhotos(business.google_business_id);
      console.log(`Found ${photoMap.size} reviews with photo URLs`);

      // Update existing reviews
      const { updated, downloaded } = await updateExistingReviews(businessDir, photoMap);
      totalUpdated += updated;
      totalDownloaded += downloaded;

      console.log(`Updated ${updated} reviews, downloaded ${downloaded} new thumbnails`);
    } catch (error) {
      console.error(`Error processing ${business.slug}: ${error.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total reviews updated: ${totalUpdated}`);
  console.log(`Total thumbnails downloaded: ${totalDownloaded}`);
}

if (require.main === module) {
  main();
}
