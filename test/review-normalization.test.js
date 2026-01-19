/**
 * Tests for review normalization logic
 *
 * These tests verify that raw API responses are correctly normalized
 * to the internal review format. Since the normalization functions
 * are internal to each fetch module, we test them via their behavior
 * on known inputs.
 */
import { describe, expect, it } from "bun:test";
import { filter, flatMap, map, pipe } from "#toolkit/fp/index.js";
import { extractGoogleUserId } from "../src/lib/shared.js";
import {
  createFacebookReview,
  createGoogleResponse,
  createGoogleReview,
  createTrustpilotReview,
} from "./apify-mock.js";

/**
 * Re-implementations of the normalization logic for testing.
 * These mirror the actual implementations in the fetch modules,
 * allowing us to test the normalization behavior independently.
 */

// Google normalization (from fetch-google-reviews.js)
const normalizeGoogleReview = (review) => {
  const authorUrl = review.reviewerUrl || review.authorUrl || "";
  return {
    content: review.text || review.reviewText || "",
    date: review.publishedAtDate
      ? new Date(review.publishedAtDate)
      : new Date(),
    rating: review.stars || review.rating || 0,
    author: review.name || review.authorName || "Anonymous",
    authorUrl: authorUrl,
    photoUrl:
      review.reviewerPhotoUrl ||
      review.userPhotoUrl ||
      review.reviewerAvatar ||
      "",
    userId: extractGoogleUserId(authorUrl),
  };
};

// Facebook normalization (from fetch-facebook-reviews.js)
const extractFacebookUserId = (user) => {
  if (!user) return null;
  if (user.id && /^\d+$/.test(user.id)) {
    return `fb-${user.id}`;
  }
  if (user.id) {
    return `fb-${user.id.substring(0, 20)}`;
  }
  return null;
};

const normalizeFacebookReview = (review) => {
  const user = review.user || {};
  const userId = extractFacebookUserId(user);
  const rating = review.isRecommended ? 5 : 1;

  return {
    content: review.text || "",
    date: review.date ? new Date(review.date) : new Date(),
    rating: rating,
    author: user.name || "Anonymous",
    authorUrl: review.url || user.profileUrl || "",
    photoUrl: user.profilePic || "",
    userId: userId,
    isRecommended: review.isRecommended,
  };
};

// Trustpilot normalization (from fetch-trustpilot-reviews.js)
const extractTrustpilotUserId = (review) => {
  if (!review.reviewId) return null;
  return `tp-${review.reviewId}`;
};

const normalizeTrustpilotReview = (review) => {
  const userId = extractTrustpilotUserId(review);
  const rating = Number.parseInt(review.ratingValue, 10) || 0;
  const content = review.reviewTitle
    ? `${review.reviewTitle}\n\n${review.reviewText || ""}`
    : review.reviewText || "";

  return {
    content: content.trim(),
    date: review.date ? new Date(review.date) : new Date(),
    rating: rating,
    author: review.name || "Anonymous",
    authorUrl: review.url || "",
    photoUrl: review.avatar || "",
    userId: userId,
    reviewTitle: review.reviewTitle || null,
  };
};

// Content filter
const hasContent = (review) => review.content && review.content.length > 5;

describe("Google Review Normalization", () => {
  it("extracts content from primary 'text' field", () => {
    const raw = createGoogleReview({ text: "Primary text field" });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.content).toBe("Primary text field");
  });

  it("falls back to 'reviewText' when 'text' is empty", () => {
    const raw = createGoogleReview({
      text: "",
      reviewText: "Fallback text field",
    });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.content).toBe("Fallback text field");
  });

  it("extracts rating from 'stars' field primarily", () => {
    const raw = createGoogleReview({ stars: 5, rating: 3 });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.rating).toBe(5);
  });

  it("falls back to 'rating' when 'stars' is not set", () => {
    const raw = createGoogleReview({ stars: null, rating: 3 });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.rating).toBe(3);
  });

  it("extracts author from 'name' field primarily", () => {
    const raw = createGoogleReview({ name: "Primary Name", authorName: "Alt" });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.author).toBe("Primary Name");
  });

  it("falls back to 'authorName' when 'name' is not set", () => {
    const raw = createGoogleReview({ name: null, authorName: "Fallback Name" });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.author).toBe("Fallback Name");
  });

  it("uses 'Anonymous' when no name fields are set", () => {
    const raw = createGoogleReview({ name: null, authorName: null });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.author).toBe("Anonymous");
  });

  it("extracts user ID from reviewer URL", () => {
    const raw = createGoogleReview({
      reviewerUrl:
        "https://www.google.com/maps/contrib/12345678901234567890?hl=en",
    });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.userId).toBe("12345678901234567890");
  });

  it("extracts photo URL with correct priority", () => {
    // Primary: reviewerPhotoUrl
    let raw = createGoogleReview({
      reviewerPhotoUrl: "primary.jpg",
      userPhotoUrl: "secondary.jpg",
    });
    expect(normalizeGoogleReview(raw).photoUrl).toBe("primary.jpg");

    // Fallback: userPhotoUrl
    raw = createGoogleReview({
      reviewerPhotoUrl: "",
      userPhotoUrl: "secondary.jpg",
      reviewerAvatar: "tertiary.jpg",
    });
    expect(normalizeGoogleReview(raw).photoUrl).toBe("secondary.jpg");

    // Final fallback: reviewerAvatar
    raw = createGoogleReview({
      reviewerPhotoUrl: "",
      userPhotoUrl: "",
      reviewerAvatar: "tertiary.jpg",
    });
    expect(normalizeGoogleReview(raw).photoUrl).toBe("tertiary.jpg");
  });

  it("parses publishedAtDate to Date object", () => {
    const raw = createGoogleReview({
      publishedAtDate: "2024-06-15T10:30:00.000Z",
    });
    const normalized = normalizeGoogleReview(raw);
    expect(normalized.date).toBeInstanceOf(Date);
    expect(normalized.date.toISOString()).toBe("2024-06-15T10:30:00.000Z");
  });

  it("processes full Google response with nested reviews", () => {
    const response = createGoogleResponse([
      createGoogleReview({ text: "Review 1", stars: 5 }),
      createGoogleReview({ text: "Review 2", stars: 4 }),
    ]);

    const reviews = pipe(
      flatMap((item) => item.reviews || []),
      map(normalizeGoogleReview),
    )(response);

    expect(reviews.length).toBe(2);
    expect(reviews[0].content).toBe("Review 1");
    expect(reviews[1].content).toBe("Review 2");
  });
});

describe("Facebook Review Normalization", () => {
  it("converts isRecommended=true to 5 stars", () => {
    const raw = createFacebookReview({ isRecommended: true });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.rating).toBe(5);
  });

  it("converts isRecommended=false to 1 star", () => {
    const raw = createFacebookReview({ isRecommended: false });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.rating).toBe(1);
  });

  it("extracts user ID with fb- prefix for numeric IDs", () => {
    const raw = createFacebookReview({
      user: { id: "1234567890", name: "Test" },
    });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.userId).toBe("fb-1234567890");
  });

  it("truncates pfbid-style IDs to 20 characters", () => {
    const raw = createFacebookReview({
      user: { id: "pfbid02ABC123DEF456GHI789JKL", name: "Test" },
    });
    const normalized = normalizeFacebookReview(raw);
    // substring(0, 20) gives first 20 chars: "pfbid02ABC123DEF456G"
    expect(normalized.userId).toBe("fb-pfbid02ABC123DEF456G");
  });

  it("returns null userId when user has no ID", () => {
    const raw = createFacebookReview({
      user: { id: null, name: "No ID User" },
    });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.userId).toBe(null);
  });

  it("prefers review URL over profile URL for authorUrl", () => {
    const raw = createFacebookReview({
      url: "https://facebook.com/review/123",
      user: { profileUrl: "https://facebook.com/user" },
    });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.authorUrl).toBe("https://facebook.com/review/123");
  });

  it("falls back to profile URL when review URL is missing", () => {
    const raw = createFacebookReview({
      url: null,
      user: { profileUrl: "https://facebook.com/user" },
    });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.authorUrl).toBe("https://facebook.com/user");
  });

  it("preserves isRecommended in normalized output", () => {
    const raw = createFacebookReview({ isRecommended: true });
    const normalized = normalizeFacebookReview(raw);
    expect(normalized.isRecommended).toBe(true);
  });
});

describe("Trustpilot Review Normalization", () => {
  it("parses ratingValue string to number", () => {
    const raw = createTrustpilotReview({ ratingValue: "4" });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.rating).toBe(4);
  });

  it("handles invalid ratingValue gracefully", () => {
    const raw = createTrustpilotReview({ ratingValue: "invalid" });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.rating).toBe(0);
  });

  it("combines title and text with double newline", () => {
    const raw = createTrustpilotReview({
      reviewTitle: "Great Title",
      reviewText: "Body text here",
    });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.content).toBe("Great Title\n\nBody text here");
  });

  it("uses only text when title is missing", () => {
    const raw = createTrustpilotReview({
      reviewTitle: null,
      reviewText: "Just the body",
    });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.content).toBe("Just the body");
  });

  it("uses only title when text is missing", () => {
    const raw = createTrustpilotReview({
      reviewTitle: "Just a title",
      reviewText: "",
    });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.content).toBe("Just a title");
  });

  it("extracts user ID with tp- prefix from reviewId", () => {
    const raw = createTrustpilotReview({ reviewId: "abc123xyz" });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.userId).toBe("tp-abc123xyz");
  });

  it("preserves reviewTitle in normalized output", () => {
    const raw = createTrustpilotReview({ reviewTitle: "Original Title" });
    const normalized = normalizeTrustpilotReview(raw);
    expect(normalized.reviewTitle).toBe("Original Title");
  });
});

describe("Content Filtering", () => {
  it("accepts reviews with more than 5 characters", () => {
    const review = { content: "This is long enough" };
    expect(hasContent(review)).toBeTruthy();
  });

  it("rejects reviews with 5 or fewer characters", () => {
    expect(hasContent({ content: "Short" })).toBeFalsy();
    expect(hasContent({ content: "Hi" })).toBeFalsy();
    expect(hasContent({ content: "" })).toBeFalsy();
  });

  it("rejects reviews with null/undefined content", () => {
    expect(hasContent({ content: null })).toBeFalsy();
    expect(hasContent({ content: undefined })).toBeFalsy();
  });

  it("filters pipeline excludes short reviews", () => {
    const reviews = [
      { content: "This is a valid review" },
      { content: "OK" },
      { content: "Another good review here" },
      { content: "" },
    ];

    const filtered = filter(hasContent)(reviews);
    expect(filtered.length).toBe(2);
  });
});
