/**
 * Tests for review normalization logic
 *
 * These tests verify that raw API responses are correctly normalized
 * to the internal review format, using the actual exported functions.
 */
import { describe, expect, it } from "bun:test";
import { filter, flatMap, map, pipe } from "#toolkit/fp/index.js";
import {
  extractFacebookUserId,
  normalizeFacebookReview,
} from "../src/fetch-facebook-reviews.js";
import { normalizeGoogleReview } from "../src/fetch-google-reviews.js";
import {
  buildTrustpilotContent,
  extractTrustpilotUserId,
  normalizeTrustpilotReview,
} from "../src/fetch-trustpilot-reviews.js";
import { hasContent } from "../src/lib/shared.js";
import {
  createFacebookReview,
  createGoogleResponse,
  createGoogleReview,
  createTrustpilotReview,
} from "./apify-mock.js";

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

  it("extractFacebookUserId handles various ID formats", () => {
    expect(extractFacebookUserId({ id: "123456" })).toBe("fb-123456");
    expect(extractFacebookUserId({ id: "pfbid0abc" })).toBe("fb-pfbid0abc");
    expect(extractFacebookUserId(null)).toBe(null);
    expect(extractFacebookUserId({})).toBe(null);
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

  it("extractTrustpilotUserId handles missing reviewId", () => {
    expect(extractTrustpilotUserId({ reviewId: "abc" })).toBe("tp-abc");
    expect(extractTrustpilotUserId({})).toBe(null);
  });

  it("buildTrustpilotContent handles various combinations", () => {
    expect(buildTrustpilotContent("Title", "Text")).toBe("Title\n\nText");
    expect(buildTrustpilotContent("Title", "")).toBe("Title");
    expect(buildTrustpilotContent(null, "Text")).toBe("Text");
    expect(buildTrustpilotContent("", "Text")).toBe("Text");
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
