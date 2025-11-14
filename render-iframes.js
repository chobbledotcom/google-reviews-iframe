#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const CONFIG = {
	configPath: path.join(__dirname, "config.json"),
	reviewsDir: path.join(__dirname, "reviews"),
	templatePath: path.join(__dirname, "iframe-layout.html"),
};

function loadReviews(businessSlug) {
	const businessDir = path.join(CONFIG.reviewsDir, businessSlug);

	if (!fs.existsSync(businessDir)) {
		console.warn(`No reviews directory found for ${businessSlug}`);
		return [];
	}

	const reviewFiles = fs
		.readdirSync(businessDir)
		.filter((file) => file.endsWith(".json"))
		.map((file) => {
			try {
				const content = fs.readFileSync(path.join(businessDir, file), "utf8");
				return JSON.parse(content);
			} catch (error) {
				console.warn(`Error reading ${file}: ${error.message}`);
				return null;
			}
		})
		.filter((review) => review !== null)
		.sort((a, b) => new Date(b.date) - new Date(a.date));

	return reviewFiles;
}

function generateReviewsHtml(reviews) {
	if (!reviews || reviews.length === 0) {
		return '<div class="no-reviews">No reviews available.</div>';
	}

	function getInitials(name) {
		return name
			.split(" ")
			.map((word) => word.charAt(0))
			.join("")
			.toUpperCase()
			.substring(0, 2);
	}

	function formatDate(dateString) {
		const date = new Date(dateString);
		const now = new Date();
		const diffTime = Math.abs(now - date);
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return "Today";
		if (diffDays === 1) return "Yesterday";
		if (diffDays < 7) return `${diffDays} days ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
		if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
		return `${Math.floor(diffDays / 365)} years ago`;
	}

	function renderStars(rating) {
		let stars = "";
		for (let i = 1; i <= 5; i++) {
			const filled = i <= rating ? "filled" : "empty";
			stars += `<span class="star ${filled}">★</span>`;
		}
		return `<div class="star-rating">${stars}</div>`;
	}

	return reviews
		.map((review) => {
			const initials = getInitials(review.author);
			const authorLink = review.authorUrl
				? `<a href="${review.authorUrl}" target="_blank" rel="noopener noreferrer">${review.author}</a>`
				: review.author;

			return `
      <div class="review-card">
        <div class="review-header">
          <div class="review-avatar">${initials}</div>
          <div class="review-info">
            <div class="review-author">${authorLink}</div>
            <div class="review-meta">
              ${renderStars(review.rating)}
              <span class="review-date">${formatDate(review.date)}</span>
            </div>
          </div>
        </div>
        <div class="review-content">${review.content || ''}</div>
      </div>
    `;
		})
		.join("");
}

function generateHtml(reviews, businessSlug) {
	if (!fs.existsSync(CONFIG.templatePath)) {
		throw new Error(`Template file not found: ${CONFIG.templatePath}`);
	}

	// Read HTML template
	const template = fs.readFileSync(CONFIG.templatePath, "utf8");

	// Read iframe resizer child script
	const childScriptPath = path.join(__dirname, "iframe-resizer.child.js");
	const childScript = fs.readFileSync(childScriptPath, "utf8");

	// Generate reviews HTML
	const reviewsHtml = generateReviewsHtml(reviews);

	// Replace placeholders
	let html = template.replace("{{REVIEWS_HTML}}", reviewsHtml);
	html = html.replace("{{IFRAME_RESIZER_SCRIPT}}", childScript);

	return html;
}

function generateEmbedCode(businessSlug) {
	const iframeUrl = `https://reviews-embeds.chobble.com/${businessSlug}/`;

	return `<!-- Google Reviews Embed Code for ${businessSlug} -->
<script async defer src="https://reviews-embeds.chobble.com/js"></script>
<iframe 
  class="google-reviews-iframe"
  src="${iframeUrl}"
  style="width: 100%; height: 1500px; margin: 2rem 0; padding:0; border: none; overflow: scroll;"
  scrolling="yes"
  frameborder="0"
  sandbox="allow-scripts allow-same-origin"
  referrerpolicy="no-referrer"
  loading="lazy"
></iframe>`;
}

function renderBusiness(businessSlug) {
	console.log(`Rendering reviews for ${businessSlug}...`);

	const reviews = loadReviews(businessSlug);

	if (reviews.length === 0) {
		console.log(`No reviews found for ${businessSlug}`);
		return;
	}

	console.log(`Found ${reviews.length} reviews for ${businessSlug}`);

	try {
		const html = generateHtml(reviews, businessSlug);

		const businessDir = path.join(CONFIG.reviewsDir, businessSlug);
		fs.mkdirSync(businessDir, { recursive: true });

		const htmlPath = path.join(businessDir, "index.html");
		fs.writeFileSync(htmlPath, html);

		const embedCode = generateEmbedCode(businessSlug);
		const codePath = path.join(businessDir, "code.txt");
		fs.writeFileSync(codePath, embedCode);

		console.log(`✓ Generated ${htmlPath}`);
		console.log(`✓ Generated ${codePath}`);
	} catch (error) {
		console.error(`Error rendering ${businessSlug}:`, error.message);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const targetSlug = args[0];

	if (!fs.existsSync(CONFIG.configPath)) {
		console.error(`Error: ${CONFIG.configPath} not found`);
		process.exit(1);
	}

	const config = JSON.parse(fs.readFileSync(CONFIG.configPath, "utf8"));

	if (targetSlug) {
		// Render specific business
		const business = config.find((b) => b.slug === targetSlug);
		if (!business) {
			console.error(`Business with slug "${targetSlug}" not found in config`);
			process.exit(1);
		}
		renderBusiness(targetSlug);
	} else {
		// Render all businesses
		console.log("Rendering all businesses...");
		for (const business of config) {
			renderBusiness(business.slug);
		}
	}

	console.log("\nRendering complete!");
}

if (require.main === module) {
	main();
}
