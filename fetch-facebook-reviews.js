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
const FACEBOOK_ACTOR_ID = 'dX3d80hsNMilEwjXG';

// Create a stable user ID from Facebook user data
function extractUserId(user) {
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
}

async function fetchReviews(pageUrl, options = {}) {
  const url = `https://api.apify.com/v2/acts/${FACEBOOK_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: pageUrl }],
    maxReviews: options.maxReviews || CONFIG.maxReviews
  };

  console.log(`Fetching Facebook reviews from ${pageUrl}...`);

  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);

  if (!Array.isArray(results)) {
    throw new Error('Invalid API response format');
  }

  return results
    .map(review => {
      const user = review.user || {};
      const userId = extractUserId(user);

      // Facebook uses isRecommended (boolean) instead of star ratings
      // Convert to 5 stars for recommended, 1 for not recommended
      const rating = review.isRecommended ? 5 : 1;

      return {
        content: review.text || '',
        date: review.date ? new Date(review.date) : new Date(),
        rating: rating,
        author: user.name || 'Anonymous',
        authorUrl: review.url || user.profileUrl || '',
        photoUrl: user.profilePic || '',
        userId: userId,
        isRecommended: review.isRecommended
      };
    })
    .filter(review => review.content && review.content.length > 5);
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

  // Filter to Facebook businesses only
  const facebookBusinesses = config.filter(b => b.source === 'facebook');

  // Filter by target slug if provided
  const businessesToProcess = targetSlug
    ? facebookBusinesses.filter(business => business.slug === targetSlug)
    : facebookBusinesses;

  if (businessesToProcess.length === 0) {
    if (targetSlug) {
      console.log(`No Facebook business with slug "${targetSlug}" found`);
    } else {
      console.log('No Facebook businesses found in config');
    }
    return;
  }

  try {
    for (const business of businessesToProcess) {
      console.log(`\nProcessing Facebook business: ${business.slug} (${business.facebook_page_url})`);

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

      // Fetch all reviews (Facebook API doesn't support date filtering the same way)
      const reviews = await fetchReviews(business.facebook_page_url, {
        maxReviews: business.number_of_reviews === -1 ? CONFIG.maxReviews : business.number_of_reviews
      });

      // Filter by minimum star rating (5 = recommended, 1 = not recommended)
      const filteredReviews = reviews.filter(review => review.rating >= business.minimum_star_rating);
      const recommendedCount = reviews.filter(r => r.isRecommended).length;
      console.log(`Found ${reviews.length} reviews (${recommendedCount} recommended), ${filteredReviews.length} meet minimum rating`);

      let saved = 0;
      for (const review of filteredReviews) {
        const wasSaved = await saveReview(review, businessDir, 'facebook');
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
