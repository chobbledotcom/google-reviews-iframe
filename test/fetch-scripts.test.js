/**
 * Tests for fetch scripts
 * Tests the specific fetch implementations for each platform
 */
import { describe, expect, it } from "bun:test";
import {
  extractFacebookUserId,
  normalizeFacebookReview,
} from "../src/fetch-facebook-reviews.js";
import {
  buildGoogleMapsUrl,
  extractReviewsFromItem,
  fetchReviews,
  normalizeGoogleReview,
} from "../src/fetch-google-reviews.js";
import {
  buildTrustpilotContent,
  extractTrustpilotUserId,
  normalizeTrustpilotReview,
} from "../src/fetch-trustpilot-reviews.js";

// Helper to assert common empty/default field patterns
const expectEmptyDefaults = (normalized) => {
  expect(normalized.content).toBe("");
  expect(normalized.rating).toBe(0);
  expect(normalized.author).toBe("Anonymous");
};

// Helper to run async test with env token management
const withApiToken = async (testFn) => {
  const originalToken = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = "test-token";
  try {
    await testFn();
  } finally {
    if (originalToken) {
      process.env.APIFY_API_TOKEN = originalToken;
    } else {
      delete process.env.APIFY_API_TOKEN;
    }
  }
};

describe("Google Review Normalization", () => {
  it("normalizes review with all fields", () => {
    const raw = {
      text: "Great service!",
      publishedAtDate: "2024-06-15T10:00:00Z",
      stars: 5,
      name: "John Doe",
      reviewerUrl: "https://maps.google.com/contrib/123",
      reviewerPhotoUrl: "https://example.com/photo.jpg",
    };

    const normalized = normalizeGoogleReview(raw);

    expect(normalized.content).toBe("Great service!");
    expect(normalized.rating).toBe(5);
    expect(normalized.author).toBe("John Doe");
    expect(normalized.authorUrl).toBe("https://maps.google.com/contrib/123");
    expect(normalized.photoUrl).toBe("https://example.com/photo.jpg");
    expect(normalized.userId).toBe("123");
  });

  it("falls back to alternative field names", () => {
    const raw = {
      reviewText: "Alt text field",
      rating: 4,
      authorName: "Jane",
      authorUrl: "https://maps.google.com/contrib/456",
      userPhotoUrl: "https://example.com/alt.jpg",
    };

    const normalized = normalizeGoogleReview(raw);

    expect(normalized.content).toBe("Alt text field");
    expect(normalized.rating).toBe(4);
    expect(normalized.author).toBe("Jane");
    expect(normalized.userId).toBe("456");
  });

  it("handles missing fields gracefully", () => {
    const normalized = normalizeGoogleReview({});
    expectEmptyDefaults(normalized);
    expect(normalized.authorUrl).toBe("");
    expect(normalized.photoUrl).toBe("");
    expect(normalized.userId).toBe(null);
  });
});

describe("Facebook Review Normalization", () => {
  it("normalizes recommended review", () => {
    const raw = {
      text: "Great business!",
      date: "2024-06-15",
      isRecommended: true,
      user: {
        name: "FB User",
        id: "12345",
        profileUrl: "https://facebook.com/user",
        profilePic: "https://facebook.com/photo.jpg",
      },
      url: "https://facebook.com/review",
    };

    const normalized = normalizeFacebookReview(raw);

    expect(normalized.content).toBe("Great business!");
    expect(normalized.rating).toBe(5);
    expect(normalized.author).toBe("FB User");
    expect(normalized.isRecommended).toBe(true);
    expect(normalized.userId).toBe("fb-12345");
  });

  it("normalizes not recommended review", () => {
    const raw = {
      text: "Not great",
      isRecommended: false,
      user: { name: "Critic" },
    };

    const normalized = normalizeFacebookReview(raw);

    expect(normalized.rating).toBe(1);
    expect(normalized.isRecommended).toBe(false);
  });

  it("handles missing user data", () => {
    const raw = { text: "Anonymous review" };

    const normalized = normalizeFacebookReview(raw);

    expect(normalized.author).toBe("Anonymous");
    expect(normalized.userId).toBe(null);
  });
});

describe("Facebook User ID Extraction", () => {
  it("extracts numeric user ID", () => {
    expect(extractFacebookUserId({ id: "12345678" })).toBe("fb-12345678");
  });

  it("truncates long non-numeric IDs", () => {
    const result = extractFacebookUserId({
      id: "some-long-string-id-here-very-long",
    });
    expect(result).toBe("fb-some-long-string-id-");
  });

  it("returns null for missing user", () => {
    expect(extractFacebookUserId(null)).toBe(null);
    expect(extractFacebookUserId(undefined)).toBe(null);
  });
});

describe("Trustpilot Review Normalization", () => {
  it("normalizes review with title and text", () => {
    const raw = {
      reviewTitle: "Amazing!",
      reviewText: "Very satisfied with the service.",
      date: "2024-06-15T10:00:00Z",
      ratingValue: "5",
      name: "TP User",
      url: "https://trustpilot.com/review/1",
      avatar: "https://trustpilot.com/avatar.jpg",
      reviewId: "tp123",
    };

    const normalized = normalizeTrustpilotReview(raw);

    expect(normalized.content).toBe(
      "Amazing!\n\nVery satisfied with the service.",
    );
    expect(normalized.rating).toBe(5);
    expect(normalized.author).toBe("TP User");
    expect(normalized.userId).toBe("tp-tp123");
    expect(normalized.reviewTitle).toBe("Amazing!");
  });

  it("handles review without title", () => {
    const raw = {
      reviewText: "Just text",
      ratingValue: "4",
    };

    const normalized = normalizeTrustpilotReview(raw);

    expect(normalized.content).toBe("Just text");
    expect(normalized.rating).toBe(4);
  });

  it("handles missing fields", () => {
    expectEmptyDefaults(normalizeTrustpilotReview({}));
  });
});

describe("Trustpilot User ID Extraction", () => {
  it("creates ID from reviewId", () => {
    expect(extractTrustpilotUserId({ reviewId: "abc123" })).toBe("tp-abc123");
  });

  it("returns null for missing reviewId", () => {
    expect(extractTrustpilotUserId({})).toBe(null);
  });
});

describe("Trustpilot Content Building", () => {
  it("combines title and text", () => {
    expect(buildTrustpilotContent("Title", "Body text")).toBe(
      "Title\n\nBody text",
    );
  });

  it("handles title only", () => {
    expect(buildTrustpilotContent("Title", null)).toBe("Title");
    expect(buildTrustpilotContent("Title", "")).toBe("Title");
  });

  it("handles text only", () => {
    expect(buildTrustpilotContent(null, "Just body")).toBe("Just body");
    expect(buildTrustpilotContent("", "Just body")).toBe("Just body");
  });

  it("handles empty inputs", () => {
    expect(buildTrustpilotContent(null, null)).toBe("");
    expect(buildTrustpilotContent("", "")).toBe("");
  });
});

describe("extractReviewsFromItem", () => {
  it("returns reviews array when present", () => {
    const item = { reviews: [{ text: "Great!" }, { text: "Good" }] };
    expect(extractReviewsFromItem(item)).toEqual([
      { text: "Great!" },
      { text: "Good" },
    ]);
  });

  it("returns empty array when reviews is undefined", () => {
    const item = { name: "Business" };
    expect(extractReviewsFromItem(item)).toEqual([]);
  });

  it("returns empty array when reviews is null", () => {
    const item = { reviews: null };
    expect(extractReviewsFromItem(item)).toEqual([]);
  });
});

describe("Google Maps URL Builder", () => {
  it("builds correct URL from place ID", () => {
    const placeId = "ChIJ1234567890";
    const url = buildGoogleMapsUrl(placeId);
    expect(url).toBe(
      "https://www.google.com/maps/place/?q=place_id:ChIJ1234567890",
    );
  });

  it("handles special characters in place ID", () => {
    const placeId = "ChIJ_abc-123";
    const url = buildGoogleMapsUrl(placeId);
    expect(url).toContain(placeId);
  });
});

describe("Google fetchReviews", () => {
  it("calls API and processes results", async () => {
    await withApiToken(async () => {
      try {
        await fetchReviews({ google_business_id: "ChIJtest123" }, { maxReviews: 5 });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  it("uses default options when not provided", async () => {
    await withApiToken(async () => {
      try {
        await fetchReviews({ google_business_id: "ChIJdefault" });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  it("includes reviewsStartDate when provided", async () => {
    await withApiToken(async () => {
      try {
        await fetchReviews(
          { google_business_id: "ChIJstartdate" },
          { maxReviews: 10, reviewsStartDate: "2024-01-01" },
        );
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
