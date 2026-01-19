/**
 * Tests for shared utility functions
 */
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { withTempDirAsync } from "#toolkit/test-utils/index.js";
import {
  buildReviewData,
  extractGoogleUserId,
  filterByPlatform,
  filterBySlug,
  formatFilename,
  formatRating,
  getLatestReviewDate,
  isDnsError,
  isRedirect,
  parseUrlSafe,
  shouldFetch,
  updateLastFetched,
} from "../src/lib/shared.js";

// Test helper: create a date offset by days from today
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Test helper: create business with last_fetched timestamp
const createBusinessWithFetch = (lastFetched, frequency = 7, extra = {}) => ({
  last_fetched: lastFetched.toISOString(),
  fetch_frequency_days: frequency,
  ...extra,
});

describe("extractGoogleUserId", () => {
  it("extracts user ID from standard contributor URL", () => {
    const url =
      "https://www.google.com/maps/contrib/101426519435404522118?hl=en";
    expect(extractGoogleUserId(url)).toBe("101426519435404522118");
  });

  it("extracts user ID from URL without query params", () => {
    const url = "https://www.google.com/maps/contrib/999888777666555";
    expect(extractGoogleUserId(url)).toBe("999888777666555");
  });

  it("returns null for null/undefined input", () => {
    expect(extractGoogleUserId(null)).toBe(null);
    expect(extractGoogleUserId(undefined)).toBe(null);
  });

  it("returns null for URLs without contributor ID", () => {
    expect(extractGoogleUserId("https://www.google.com/maps")).toBe(null);
    expect(extractGoogleUserId("https://example.com")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(extractGoogleUserId("")).toBe(null);
  });
});

describe("formatFilename", () => {
  it("creates filename from name and date", () => {
    const result = formatFilename("John Smith", new Date("2024-06-15"));
    expect(result).toBe("john-smith-2024-06-15.json");
  });

  it("handles special characters in name", () => {
    const result = formatFilename("José O'Brien", new Date("2024-01-01"));
    expect(result).toBe("jos-obrien-2024-01-01.json");
  });

  it("truncates long names to 30 characters", () => {
    const longName = "Bartholomew Christopher Maximilian Fitzgerald III";
    const result = formatFilename(longName, new Date("2024-01-01"));
    expect(result.startsWith("bartholomew-christopher-maximi")).toBe(true);
    // Name part should be max 30 chars
    const namePart = result.replace("-2024-01-01.json", "");
    expect(namePart.length).toBeLessThanOrEqual(30);
  });

  it("uses 'anonymous' for null/undefined names", () => {
    const date = new Date("2024-06-15");
    expect(formatFilename(null, date)).toBe("anonymous-2024-06-15.json");
    expect(formatFilename(undefined, date)).toBe("anonymous-2024-06-15.json");
  });

  it("uses today's date for invalid dates", () => {
    const result = formatFilename("Test User", new Date("invalid"));
    const today = new Date().toISOString().split("T")[0];
    expect(result).toBe(`test-user-${today}.json`);
  });

  it("collapses multiple spaces into single dash", () => {
    const result = formatFilename("John    Smith", new Date("2024-01-01"));
    expect(result).toBe("john-smith-2024-01-01.json");
  });
});

describe("filterByPlatform", () => {
  const businesses = [
    { slug: "biz1", google_business_id: "ChIJ123" },
    { slug: "biz2", facebook_page_url: "https://fb.com/biz2" },
    {
      slug: "biz3",
      google_business_id: "ChIJ456",
      facebook_page_url: "https://fb.com/biz3",
    },
    { slug: "biz4" },
  ];

  it("filters businesses with google_business_id", () => {
    const result = filterByPlatform("google_business_id")(businesses);
    expect(result.length).toBe(2);
    expect(result.map((b) => b.slug)).toEqual(["biz1", "biz3"]);
  });

  it("filters businesses with facebook_page_url", () => {
    const result = filterByPlatform("facebook_page_url")(businesses);
    expect(result.length).toBe(2);
    expect(result.map((b) => b.slug)).toEqual(["biz2", "biz3"]);
  });

  it("returns empty array when no businesses have the field", () => {
    const result = filterByPlatform("trustpilot_url")(businesses);
    expect(result.length).toBe(0);
  });
});

describe("filterBySlug", () => {
  const businesses = [
    { slug: "biz1", name: "Business 1" },
    { slug: "biz2", name: "Business 2" },
    { slug: "biz3", name: "Business 3" },
  ];

  it("returns only matching business when slug provided", () => {
    const result = filterBySlug("biz2")(businesses);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Business 2");
  });

  it("returns identity function when no slug provided", () => {
    const result = filterBySlug(null)(businesses);
    expect(result).toBe(businesses);
  });

  it("returns empty array when slug not found", () => {
    const result = filterBySlug("nonexistent")(businesses);
    expect(result.length).toBe(0);
  });
});

describe("shouldFetch", () => {
  it("returns true when never fetched", () => {
    const business = { fetch_frequency_days: 7 };
    expect(shouldFetch(business)).toBe(true);
  });

  it("returns false when fetched recently (within frequency)", () => {
    const business = createBusinessWithFetch(daysAgo(1));
    expect(shouldFetch(business)).toBe(false);
  });

  it("returns true when fetch frequency exceeded", () => {
    const business = createBusinessWithFetch(daysAgo(14));
    expect(shouldFetch(business)).toBe(true);
  });

  it("supports source-specific timestamps", () => {
    const business = {
      last_fetched_google: daysAgo(1).toISOString(),
      last_fetched_facebook: daysAgo(14).toISOString(),
      fetch_frequency_days: 7,
    };
    expect(shouldFetch(business, "google")).toBe(false);
    expect(shouldFetch(business, "facebook")).toBe(true);
  });

  it("falls back to generic last_fetched if source-specific not found", () => {
    const business = createBusinessWithFetch(daysAgo(1));
    expect(shouldFetch(business, "google")).toBe(false);
  });
});

describe("getLatestReviewDate", () => {
  it("returns null for non-existent directory", () => {
    const result = getLatestReviewDate("/nonexistent/path");
    expect(result).toBe(null);
  });

  it("returns null for empty directory", async () => {
    await withTempDirAsync("empty-dir", async (dir) => {
      const result = getLatestReviewDate(dir);
      expect(result).toBe(null);
    });
  });

  it("returns latest date plus one day from reviews", async () => {
    await withTempDirAsync("latest-date", async (dir) => {
      // Create review files
      fs.writeFileSync(
        path.join(dir, "old-review.json"),
        JSON.stringify({ date: "2024-01-01T10:00:00.000Z" }),
      );
      fs.writeFileSync(
        path.join(dir, "new-review.json"),
        JSON.stringify({ date: "2024-06-15T10:00:00.000Z" }),
      );

      const result = getLatestReviewDate(dir);
      // Should be one day after the latest review
      expect(result).toBe("2024-06-16");
    });
  });

  it("ignores non-JSON files", async () => {
    await withTempDirAsync("non-json", async (dir) => {
      fs.writeFileSync(
        path.join(dir, "review.json"),
        JSON.stringify({ date: "2024-01-01T10:00:00.000Z" }),
      );
      fs.writeFileSync(path.join(dir, "readme.txt"), "Not a review");

      const result = getLatestReviewDate(dir);
      expect(result).toBe("2024-01-02");
    });
  });

  it("handles invalid JSON files gracefully", async () => {
    await withTempDirAsync("invalid-json", async (dir) => {
      fs.writeFileSync(
        path.join(dir, "valid.json"),
        JSON.stringify({ date: "2024-01-01T10:00:00.000Z" }),
      );
      fs.writeFileSync(path.join(dir, "invalid.json"), "not valid json{");

      const result = getLatestReviewDate(dir);
      expect(result).toBe("2024-01-02");
    });
  });
});

describe("formatRating", () => {
  it("formats Google ratings as stars", () => {
    expect(formatRating(5, "google")).toBe("5/5 stars");
    expect(formatRating(3, "google")).toBe("3/5 stars");
    expect(formatRating(1, "google")).toBe("1/5 stars");
  });

  it("formats Facebook 5 stars as recommended", () => {
    expect(formatRating(5, "facebook")).toBe("recommended");
  });

  it("formats Facebook non-5 stars as not recommended", () => {
    expect(formatRating(1, "facebook")).toBe("not recommended");
    expect(formatRating(4, "facebook")).toBe("not recommended");
  });

  it("formats Trustpilot ratings as stars", () => {
    expect(formatRating(4, "trustpilot")).toBe("4/5 stars");
  });
});

describe("buildReviewData", () => {
  it("builds review data object from review and metadata", () => {
    const review = {
      author: "John Doe",
      authorUrl: "https://example.com/user/123",
      rating: 5,
      content: "Great service!",
      date: new Date("2024-06-15T10:00:00.000Z"),
      userId: "123456",
    };

    const result = buildReviewData(review, "/images/thumb.webp", "google");

    expect(result).toEqual({
      author: "John Doe",
      authorUrl: "https://example.com/user/123",
      rating: 5,
      content: "Great service!",
      date: "2024-06-15T10:00:00.000Z",
      userId: "123456",
      thumbnail: "/images/thumb.webp",
      source: "google",
    });
  });

  it("handles null userId", () => {
    const review = {
      author: "Anonymous",
      authorUrl: "",
      rating: 4,
      content: "Good",
      date: new Date("2024-01-01T00:00:00.000Z"),
      userId: null,
    };

    const result = buildReviewData(review, null, "facebook");

    expect(result.userId).toBe(null);
    expect(result.thumbnail).toBe(null);
    expect(result.source).toBe("facebook");
  });
});

describe("parseUrlSafe", () => {
  it("parses valid URLs", () => {
    const result = parseUrlSafe("https://example.com/path?query=1");
    expect(result).toBeInstanceOf(URL);
    expect(result.hostname).toBe("example.com");
  });

  it("returns null for invalid URLs", () => {
    expect(parseUrlSafe("not-a-url")).toBe(null);
    expect(parseUrlSafe("")).toBe(null);
    expect(parseUrlSafe("://missing-protocol")).toBe(null);
  });
});

describe("isRedirect", () => {
  it("returns truthy for redirect responses with location header", () => {
    expect(
      isRedirect({ statusCode: 301, headers: { location: "/new" } }),
    ).toBeTruthy();
    expect(
      isRedirect({ statusCode: 302, headers: { location: "/other" } }),
    ).toBeTruthy();
    expect(
      isRedirect({ statusCode: 307, headers: { location: "/temp" } }),
    ).toBeTruthy();
  });

  it("returns falsy for non-redirect status codes", () => {
    expect(
      isRedirect({ statusCode: 200, headers: { location: "/" } }),
    ).toBeFalsy();
    expect(
      isRedirect({ statusCode: 404, headers: { location: "/" } }),
    ).toBeFalsy();
    expect(
      isRedirect({ statusCode: 500, headers: { location: "/" } }),
    ).toBeFalsy();
  });

  it("returns falsy when location header is missing", () => {
    expect(isRedirect({ statusCode: 301, headers: {} })).toBeFalsy();
    expect(
      isRedirect({ statusCode: 302, headers: { other: "value" } }),
    ).toBeFalsy();
  });
});

describe("isDnsError", () => {
  it("returns true for EAI_AGAIN error code", () => {
    expect(isDnsError({ code: "EAI_AGAIN" })).toBe(true);
  });

  it("returns truthy for error message containing EAI_AGAIN", () => {
    expect(
      isDnsError({ message: "getaddrinfo EAI_AGAIN example.com" }),
    ).toBeTruthy();
  });

  it("returns falsy for other errors", () => {
    expect(isDnsError({ code: "ENOTFOUND" })).toBeFalsy();
    expect(isDnsError({ code: "ECONNREFUSED" })).toBeFalsy();
    expect(isDnsError({ message: "Connection timeout" })).toBeFalsy();
  });

  it("handles missing message gracefully", () => {
    expect(isDnsError({ code: "OTHER" })).toBeFalsy();
    expect(isDnsError({})).toBeFalsy();
  });
});

describe("updateLastFetched", () => {
  it("updates generic last_fetched when no source specified", () => {
    const business = { slug: "test" };
    updateLastFetched(business);
    expect(business.last_fetched).toBeDefined();
    expect(business.last_fetched).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("updates source-specific timestamp when source is specified", () => {
    const business = { slug: "test" };
    updateLastFetched(business, "google");
    expect(business.last_fetched_google).toBeDefined();
    expect(business.last_fetched).toBeUndefined();
  });

  it("preserves other properties", () => {
    const business = { slug: "test", name: "Test Business" };
    updateLastFetched(business, "facebook");
    expect(business.slug).toBe("test");
    expect(business.name).toBe("Test Business");
    expect(business.last_fetched_facebook).toBeDefined();
  });
});
