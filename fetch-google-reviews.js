#!/usr/bin/env node

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
  actorId: 'nwua9Gu5YrADL7ZDj',
  maxReviews: 9999 // Fetch all available reviews
};

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

  // Return the earliest date (oldest review)
  const earliestDate = new Date(Math.min(...reviewFiles));
  // Add one day buffer to ensure we don't miss reviews from the same day
  earliestDate.setDate(earliestDate.getDate() - 1);
  return earliestDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
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
    .map(review => ({
      content: review.text || review.reviewText || '',
      date: review.publishedAtDate ? new Date(review.publishedAtDate) : new Date(),
      rating: review.stars || review.rating || 0,
      author: review.name || review.authorName || 'Anonymous',
      authorUrl: review.reviewerUrl || review.authorUrl || ''
    }))
    .filter(review => review.content.length > 5);
}

function saveReview(review, outputDir) {
  const filename = formatFilename(review.author, review.date);
  const filepath = path.join(outputDir, filename);

  if (fs.existsSync(filepath)) {
    return false; // Skip existing
  }

  const reviewData = {
    author: review.author,
    authorUrl: review.authorUrl,
    rating: review.rating || 5,
    content: review.content,
    date: review.date.toISOString()
  };

  fs.writeFileSync(filepath, JSON.stringify(reviewData, null, 2));
  console.log(`✓ ${filename} (${review.rating}/5 stars)`);
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

      const saved = filteredReviews.reduce((count, review) =>
        count + (saveReview(review, businessDir) ? 1 : 0), 0
      );

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