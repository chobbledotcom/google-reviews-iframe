#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filter, map, pipe, sort } from "#toolkit/fp/index.js";
import { CONFIG, loadConfig } from "./lib/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const TEMPLATE_PATH = path.join(__dirname, "iframe-layout.html");

// Parse a review file
const parseReviewFile = (businessDir) => (file) => {
  try {
    const content = fs.readFileSync(path.join(businessDir, file), "utf8");
    return JSON.parse(content);
  } catch (_error) {
    return null;
  }
};

function loadReviews(businessSlug) {
  const businessDir = path.join(CONFIG.reviewsDir, businessSlug);

  if (!fs.existsSync(businessDir)) {
    return [];
  }

  const isJsonFile = (file) => file.endsWith(".json");
  const isNotNull = (review) => review !== null;
  const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);

  return pipe(
    filter(isJsonFile),
    map(parseReviewFile(businessDir)),
    filter(isNotNull),
    sort(byDateDesc),
  )(fs.readdirSync(businessDir));
}

// Date formatting helpers - broken into small functions
const daysBetween = (date1, date2) =>
  Math.ceil(Math.abs(date2 - date1) / (1000 * 60 * 60 * 24));

const formatRelativeTime = (diffDays) => {
  const units = [
    { threshold: 0, label: "Today" },
    { threshold: 1, label: "Yesterday" },
    { threshold: 7, calc: (d) => `${d} days ago` },
    { threshold: 30, calc: (d) => `${Math.floor(d / 7)} weeks ago` },
    { threshold: 365, calc: (d) => `${Math.floor(d / 30)} months ago` },
  ];

  for (const unit of units) {
    if (diffDays <= unit.threshold) {
      return unit.label || unit.calc(diffDays);
    }
  }
  // More than a year
  return `${Math.floor(diffDays / 365)} years ago`;
};

const formatDate = (dateString) => {
  const diffDays = daysBetween(new Date(dateString), new Date());
  return formatRelativeTime(diffDays);
};

function getInitials(name) {
  return name
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function renderStars(rating) {
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating ? "filled" : "empty";
    stars += `<span class="star ${filled}">★</span>`;
  }
  return `<div class="star-rating">${stars}</div>`;
}

function renderRating(review, source) {
  // For Facebook, show "Recommends" badge if rating is 5
  if (source === "facebook") {
    return review.rating === 5
      ? '<span class="recommended-badge">👍 Recommends</span>'
      : '<span class="not-recommended-badge">Does not recommend</span>';
  }
  // For Google, show star rating
  return renderStars(review.rating);
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function renderReviewCard(review, source) {
  const initials = getInitials(review.author);
  const authorLink = review.authorUrl
    ? `<a href="${review.authorUrl}" target="_blank" rel="noopener noreferrer">${review.author}</a>`
    : review.author;

  // Use thumbnail image if available, otherwise fall back to initials
  let avatarContent = initials;
  if (review.thumbnail) {
    const thumb2x = review.thumbnail.replace(".webp", "@2x.webp");
    avatarContent = `<img src="${review.thumbnail}" srcset="${review.thumbnail} 1x, ${thumb2x} 2x" alt="${review.author}" class="review-avatar-img" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML='${initials}'">`;
  }

  // Determine source from review data or passed parameter
  const reviewSource = review.source || source;

  return `
      <div class="review-card">
        <div class="review-header">
          <div class="review-avatar">${avatarContent}</div>
          <div class="review-info">
            <div class="review-author">${authorLink}</div>
            <div class="review-meta">
              ${renderRating(review, reviewSource)}
              <span class="review-date">${formatDate(review.date)}</span>
            </div>
          </div>
        </div>
        <div class="review-content">${review.content || ""}</div>
      </div>
    `;
}

// Determine which column to add a review to based on word count balance
function shouldAddToLeft(leftWordCount, rightWordCount, index) {
  // If right column is 20+ words longer, add to left
  if (rightWordCount - leftWordCount >= 20) return true;
  // If left column is 20+ words longer, add to right
  if (leftWordCount - rightWordCount >= 20) return false;
  // Otherwise alternate starting with left
  return index % 2 === 0;
}

function generateReviewsHtml(reviews, source = "google") {
  if (!reviews || reviews.length === 0) {
    return '<div class="no-reviews">No reviews available.</div>';
  }

  // Generate mobile layout (single column, all reviews in order)
  const mobileHtml = reviews
    .map((review) => renderReviewCard(review, source))
    .join("");

  // Generate desktop layout (two columns, balanced by word count)
  const leftColumn = [];
  const rightColumn = [];
  let leftWordCount = 0;
  let rightWordCount = 0;

  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];
    const reviewWords = countWords(review.content);
    const reviewHtml = renderReviewCard(review, source);

    if (shouldAddToLeft(leftWordCount, rightWordCount, i)) {
      leftColumn.push(reviewHtml);
      leftWordCount += reviewWords;
    } else {
      rightColumn.push(reviewHtml);
      rightWordCount += reviewWords;
    }
  }

  const desktopHtml = `
    <div class="reviews-column reviews-column-left">${leftColumn.join("")}</div>
    <div class="reviews-column reviews-column-right">${rightColumn.join("")}</div>
  `;

  return `
    <div class="mobile-reviews">${mobileHtml}</div>
    <div class="desktop-reviews">${desktopHtml}</div>
  `;
}

function generateHtml(reviews, _businessSlug, source = "google") {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template file not found: ${TEMPLATE_PATH}`);
  }

  // Read HTML template
  let template = fs.readFileSync(TEMPLATE_PATH, "utf8");

  // Read bundled iframe resizer child script from dist/
  const childScriptPath = path.join(rootDir, "dist", "iframe-resizer-child.js");
  const childScript = fs.readFileSync(childScriptPath, "utf8");

  // Generate reviews HTML
  const reviewsHtml = generateReviewsHtml(reviews, source);

  // Update title based on source
  const title = source === "facebook" ? "Facebook Reviews" : "Google Reviews";
  template = template.replace(
    "<title>Google Reviews</title>",
    `<title>${title}</title>`,
  );

  // Add Facebook-specific styles if needed
  if (source === "facebook") {
    const fbStyles = `
      .recommended-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #1877f2;
        font-weight: 500;
        font-size: 14px;
      }
      .not-recommended-badge {
        color: #666;
        font-size: 14px;
      }
    `;
    template = template.replace("</style>", `${fbStyles}</style>`);
  }

  // Replace placeholders
  let html = template.replace("{{REVIEWS_HTML}}", reviewsHtml);
  html = html.replace("{{IFRAME_RESIZER_SCRIPT}}", childScript);

  return html;
}

function generateEmbedCode(businessSlug, source = "google") {
  const iframeUrl = `https://reviews-embeds.chobble.com/${businessSlug}/`;
  const sourceLabel = source === "facebook" ? "Facebook" : "Google";

  return `<!-- ${sourceLabel} Reviews Embed Code for ${businessSlug} -->
<script async defer src="https://reviews-embeds.chobble.com/js"></script>
<iframe
  class="${source}-reviews-iframe"
  src="${iframeUrl}"
  style="width: 100%; height: 1500px; margin: 2rem 0; padding:0; border: none; overflow: scroll; background: transparent;"
  scrolling="yes"
  frameborder="0"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  referrerpolicy="no-referrer"
  loading="lazy"
  allowtransparency="true"
></iframe>`;
}

function renderBusiness(business) {
  const businessSlug = business.slug;
  const source = business.source || "google";

  const reviews = loadReviews(businessSlug);

  if (reviews.length === 0) {
    return;
  }

  try {
    const html = generateHtml(reviews, businessSlug, source);

    const businessDir = path.join(CONFIG.reviewsDir, businessSlug);
    fs.mkdirSync(businessDir, { recursive: true });

    const htmlPath = path.join(businessDir, "index.html");
    fs.writeFileSync(htmlPath, html);

    const embedCode = generateEmbedCode(businessSlug, source);
    const codePath = path.join(businessDir, "code.txt");
    fs.writeFileSync(codePath, embedCode);
  } catch (_error) {
    // Skip business on error
  }
}

async function main() {
  const targetSlug = process.argv[2];

  const config = loadConfig();

  if (targetSlug) {
    // Render specific business
    const business = config.find((b) => b.slug === targetSlug);
    if (!business) {
      process.exit(1);
    }
    renderBusiness(business);
  } else {
    for (const business of config) {
      renderBusiness(business);
    }
  }
}

main();
