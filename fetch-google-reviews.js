#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  CONFIG,
  loadEnv,
  getLatestReviewDate,
  makeApiRequest,
  saveReview,
  loadConfig,
  saveConfig,
  shouldFetch,
  updateLastFetched
} = require('./lib/shared');

loadEnv();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const GOOGLE_ACTOR_ID = 'nwua9Gu5YrADL7ZDj';

// Extract user ID from Google Maps contributor URL
function extractUserId(authorUrl) {
  if (!authorUrl) return null;
  const match = authorUrl.match(/\/contrib\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchReviews(placeId, options = {}) {
  const url = `https://api.apify.com/v2/acts/${GOOGLE_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
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

async function main() {
  const args = process.argv.slice(2);
  const targetSlug = args[0];

  // Validate requirements
  if (!APIFY_API_TOKEN) {
    console.error('Error: APIFY_API_TOKEN required in .env file');
    console.error('Get token: https://console.apify.com/account/integrations');
    process.exit(1);
  }

  const config = loadConfig();

  // Filter to Google businesses only
  const googleBusinesses = config.filter(b => !b.source || b.source === 'google');

  // Filter by target slug if provided
  const businessesToProcess = targetSlug
    ? googleBusinesses.filter(business => business.slug === targetSlug)
    : googleBusinesses;

  if (businessesToProcess.length === 0) {
    if (targetSlug) {
      console.log(`No Google business with slug "${targetSlug}" found`);
    } else {
      console.log('No Google businesses found in config');
    }
    return;
  }

  try {
    for (const business of businessesToProcess) {
      console.log(`\nProcessing Google business: ${business.slug} (${business.google_business_id})`);

      // Check if we need to fetch based on frequency
      if (!shouldFetch(business)) {
        const lastFetched = new Date(business.last_fetched);
        const daysSinceFetch = Math.floor((new Date() - lastFetched) / (1000 * 60 * 60 * 24));
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
        const wasSaved = await saveReview(review, businessDir, 'google');
        if (wasSaved) saved++;
      }

      console.log(`Saved ${saved} new reviews (${filteredReviews.length - saved} already existed)`);

      // Update last_fetched in config
      updateLastFetched(business);
    }

    // Save updated config
    saveConfig(config);
    console.log('\nConfig updated with new fetch timestamps');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
