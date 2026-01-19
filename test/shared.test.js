/**
 * Tests for shared utility functions
 */
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { withTempDirAsync } from "#toolkit/test-utils/index.js";
import {
  extractGoogleUserId,
  filterByPlatform,
  filterBySlug,
  formatFilename,
  getLatestReviewDate,
  shouldFetch,
} from "../src/lib/shared.js";

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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const business = {
      last_fetched: yesterday.toISOString(),
      fetch_frequency_days: 7,
    };
    expect(shouldFetch(business)).toBe(false);
  });

  it("returns true when fetch frequency exceeded", () => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const business = {
      last_fetched: twoWeeksAgo.toISOString(),
      fetch_frequency_days: 7,
    };
    expect(shouldFetch(business)).toBe(true);
  });

  it("supports source-specific timestamps", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const business = {
      last_fetched_google: yesterday.toISOString(),
      last_fetched_facebook: twoWeeksAgo.toISOString(),
      fetch_frequency_days: 7,
    };

    expect(shouldFetch(business, "google")).toBe(false);
    expect(shouldFetch(business, "facebook")).toBe(true);
  });

  it("falls back to generic last_fetched if source-specific not found", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const business = {
      last_fetched: yesterday.toISOString(),
      fetch_frequency_days: 7,
    };
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
