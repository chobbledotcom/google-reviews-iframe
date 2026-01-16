#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

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
  maxReviews: 9999 // Fetch all available reviews
};

// Extract user ID from Google Maps contributor URL
function extractUserId(authorUrl) {
  if (!authorUrl) return null;
  const match = authorUrl.match(/\/contrib\/(\d+)/);
  return match ? match[1] : null;
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

    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : require('http');

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadAndProcessImage(response.headers.location, userId).then(resolve);
        return;
      }

      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);

          // Create 1x version (48x48)
          await sharp(buffer)
            .resize(48, 48, { fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(filepath1x);

          // Create 2x version (96x96) for retina
          await sharp(buffer)
            .resize(96, 96, { fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(filepath2x);

          resolve(true);
        } catch (err) {
          console.warn(`Failed to process image for ${userId}: ${err.message}`);
          resolve(false);
        }
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

function formatFilename(name, date) {
  const safeName = (name || 'anonymous')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);
  const safeDate = date instanceof Date && !isNaN(date)
    ? date.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  return `${safeName}-${safeDate}.json`;
}

function getLatestReviewDate(businessDir) {
  if (!fs.existsSync(businessDir)) {
    return null;
  }

  const reviewFiles = fs.readdirSync(businessDir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      try {
        const content = fs.readFileSync(path.join(businessDir, file), 'utf8');
        const review = JSON.parse(content);
        return new Date(review.date);
      } catch (error) {
        console.warn(`Error reading ${file}: ${error.message}`);
        return null;
      }
    })
    .filter(date => date !== null && !isNaN(date));

  if (reviewFiles.length === 0) {
    return null;
  }

  // Return latest date (most recent review)
  const latestDate = new Date(Math.max(...reviewFiles));
  // Add one day buffer to ensure we don't miss reviews from the same day
  latestDate.setDate(latestDate.getDate() + 1);
  return latestDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
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

async function fetchReviews(placeId, options = {}) {
  const url = `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: `https://www.google.com/maps/place/?q=place_id:${placeId}` }],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
    reviewsSort: options.sort || 'newest',
    language: options.language || 'en'
  };

  // Add reviewsStartDate if provided
  if (options.reviewsStartDate) {
    data.reviewsStartDate = options.reviewsStartDate;
    console.log(`Fetching reviews newer than ${options.reviewsStartDate}...`);
  } else {
    console.log(`Fetching all available reviews...`);
  }

  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);

  if (!Array.isArray(results)) {
    throw new Error('Invalid API response format');
  }

  return results
    .flatMap(item => item.reviews || [])
    .map(review => {
      const authorUrl = review.reviewerUrl || review.authorUrl || '';
      return {
        content: review.text || review.reviewText || '',
        date: review.publishedAtDate ? new Date(review.publishedAtDate) : new Date(),
        rating: review.stars || review.rating || 0,
        author: review.name || review.authorName || 'Anonymous',
        authorUrl: authorUrl,
        photoUrl: review.reviewerPhotoUrl || review.userPhotoUrl || review.reviewerAvatar || '',
        userId: extractUserId(authorUrl)
      };
    })
    .filter(review => review.content.length > 5);
}

async function saveReview(review, outputDir) {
  const filename = formatFilename(review.author, review.date);
  const filepath = path.join(outputDir, filename);

  if (fs.existsSync(filepath)) {
    return false; // Skip existing
  }

  // Download and process thumbnail if available
  let thumbnailPath = null;
  if (review.userId && review.photoUrl) {
    const downloaded = await downloadAndProcessImage(review.photoUrl, review.userId);
    if (downloaded) {
      thumbnailPath = `/images/reviewers/${review.userId}.webp`;
    }
  }

  const reviewData = {
    author: review.author,
    authorUrl: review.authorUrl,
    rating: review.rating || 5,
    content: review.content,
    date: review.date.toISOString(),
    userId: review.userId || null,
    thumbnail: thumbnailPath
  };

  fs.writeFileSync(filepath, JSON.stringify(reviewData, null, 2));
  const thumbInfo = thumbnailPath ? ' [with thumbnail]' : '';
  console.log(`✓ ${filename} (${review.rating}/5 stars)${thumbInfo}`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const targetSlug = args[0];

  // Validate requirements
  if (!APIFY_API_TOKEN) {
    console.error('Error: APIFY_API_TOKEN required in .env file');
    console.error('Get token: https://console.apify.com/account/integrations');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.configPath)) {
    console.error(`Error: ${CONFIG.configPath} not found`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG.configPath, 'utf8'));
  
  // Filter businesses based on target slug if provided
  const businessesToProcess = targetSlug 
    ? config.filter(business => business.slug === targetSlug)
    : config;

  if (businessesToProcess.length === 0) {
    console.error(targetSlug ? `Business with slug "${targetSlug}" not found` : 'No businesses found in config');
    process.exit(1);
  }

  try {
    for (const business of businessesToProcess) {
      console.log(`\nProcessing business: ${business.slug} (${business.google_business_id})`);
      
      // Check if we need to fetch based on frequency
      const lastFetched = new Date(business.last_fetched);
      const daysSinceFetch = Math.floor((new Date() - lastFetched) / (1000 * 60 * 60 * 24));
      
      if (daysSinceFetch < business.fetch_frequency_days) {
        console.log(`Skipping ${business.slug} - fetched ${daysSinceFetch} days ago (frequency: ${business.fetch_frequency_days} days)`);
        continue;
      }

      // Ensure business directory exists
      const businessDir = path.join(CONFIG.reviewsDir, business.slug);
      fs.mkdirSync(businessDir, { recursive: true });

      // Get latest review date to fetch only newer reviews
      const latestDate = getLatestReviewDate(businessDir);
      
      // Fetch and save reviews
      const reviews = await fetchReviews(business.google_business_id, {
        maxReviews: business.number_of_reviews === -1 ? CONFIG.maxReviews : business.number_of_reviews,
        reviewsStartDate: latestDate
      });

      // Filter by minimum star rating
      const filteredReviews = reviews.filter(review => review.rating >= business.minimum_star_rating);
      console.log(`Found ${reviews.length} reviews, ${filteredReviews.length} meet minimum rating of ${business.minimum_star_rating} stars`);

      let saved = 0;
      for (const review of filteredReviews) {
        const wasSaved = await saveReview(review, businessDir);
        if (wasSaved) saved++;
      }

      console.log(`Saved ${saved} new reviews (${filteredReviews.length - saved} already existed)`);

      // Update last_fetched in config
      business.last_fetched = new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    // Save updated config
    fs.writeFileSync(CONFIG.configPath, JSON.stringify(config, null, 2));
    console.log('\nConfig updated with new fetch timestamps');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}