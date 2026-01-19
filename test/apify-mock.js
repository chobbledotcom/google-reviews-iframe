/**
 * Apify API Mock for testing
 *
 * Provides realistic mock responses for the three Apify actors used:
 * - Google Maps Reviews (nwua9Gu5YrADL7ZDj)
 * - Facebook Reviews (dX3d80hsNMilEwjXG)
 * - Trustpilot Reviews (4AQb7n4pXPxFQQ2w5)
 */

// Actor IDs for reference
const ACTOR_IDS = {
  google: "nwua9Gu5YrADL7ZDj",
  facebook: "dX3d80hsNMilEwjXG",
  trustpilot: "4AQb7n4pXPxFQQ2w5",
};

/**
 * Factory functions for creating mock review data
 */
const createGoogleReview = (overrides = {}) => ({
  reviewerUrl:
    "https://www.google.com/maps/contrib/101426519435404522118?hl=en",
  authorUrl: overrides.authorUrl || null,
  text: "Great service, very professional!",
  reviewText: overrides.reviewText || null,
  name: "John Smith",
  authorName: overrides.authorName || null,
  stars: 5,
  rating: overrides.rating || null,
  publishedAtDate: "2024-06-15T10:30:00.000Z",
  reviewerPhotoUrl: "https://lh3.googleusercontent.com/a/photo123",
  userPhotoUrl: overrides.userPhotoUrl || null,
  reviewerAvatar: overrides.reviewerAvatar || null,
  ...overrides,
});

const createFacebookReview = (overrides = {}) => ({
  text: "Highly recommend this business!",
  date: "2024-06-15",
  isRecommended: true,
  url: "https://facebook.com/review/123",
  user: {
    name: "Jane Doe",
    id: "1234567890",
    profileUrl: "https://facebook.com/jane.doe",
    profilePic: "https://facebook.com/photo/jane.jpg",
    ...overrides.user,
  },
  ...overrides,
});

const createTrustpilotReview = (overrides = {}) => ({
  reviewText: "Excellent experience from start to finish.",
  reviewTitle: "Amazing Service",
  date: "2024-06-15",
  ratingValue: "5",
  name: "Bob Wilson",
  url: "https://trustpilot.com/users/bob123",
  avatar: "https://trustpilot.com/avatar/bob.jpg",
  reviewId: "tp-review-abc123",
  ...overrides,
});

/**
 * Create a Google API response (reviews nested in results)
 */
const createGoogleResponse = (reviews = []) => [{ reviews }];

/**
 * Create a Facebook/Trustpilot API response (flat array)
 */
const createFlatResponse = (reviews) => reviews;

/**
 * Mock HTTP module replacement for testing
 *
 * @param {Object} responseData - Data to return from the mock API
 * @param {Object} options - { statusCode?: number, shouldFail?: boolean }
 * @returns {Object} Mock https module with request method
 */
const createHttpsMock = (responseData, options = {}) => {
  const { statusCode = 200, shouldFail = false, failureError = null } = options;

  return {
    request: (requestOptions, callback) => {
      const mockRequest = {
        on: (event, handler) => {
          if (event === "error" && shouldFail) {
            setTimeout(
              () => handler(failureError || new Error("Mock error")),
              0,
            );
          }
          return mockRequest;
        },
        setTimeout: (timeout, handler) => {
          // Don't trigger timeout by default
          return mockRequest;
        },
        write: () => {},
        end: () => {
          if (!shouldFail) {
            const mockResponse = {
              statusCode,
              on: (event, handler) => {
                if (event === "data") {
                  setTimeout(() => handler(JSON.stringify(responseData)), 0);
                }
                if (event === "end") {
                  setTimeout(() => handler(), 1);
                }
                return mockResponse;
              },
            };
            callback(mockResponse);
          }
        },
        destroy: () => {},
      };
      return mockRequest;
    },
  };
};

/**
 * Create a mock for the shared.js fetchApiArray function
 *
 * @param {Object|Array} response - The API response to return
 * @param {Object} options - { shouldFail?: boolean, errorMessage?: string }
 * @returns {Function} Mock fetchApiArray function
 */
const createFetchApiArrayMock = (response, options = {}) => {
  const { shouldFail = false, errorMessage = "Mock API error" } = options;

  return async (url, data) => {
    if (shouldFail) {
      throw new Error(errorMessage);
    }
    return response;
  };
};

/**
 * Sample datasets for testing
 */
const sampleData = {
  google: {
    mixedReviews: createGoogleResponse([
      createGoogleReview({ text: "Excellent!", stars: 5 }),
      createGoogleReview({ text: "Good service", stars: 4, name: "Alice" }),
      createGoogleReview({ text: "OK", stars: 3, name: "Bob" }), // Short content
      createGoogleReview({ text: "", stars: 2, name: "Charlie" }), // Empty content
      createGoogleReview({
        text: "Very disappointed with the service",
        stars: 1,
        name: "Dave",
      }),
    ]),
    alternativeFields: createGoogleResponse([
      // Uses authorUrl instead of reviewerUrl
      createGoogleReview({
        reviewerUrl: null,
        authorUrl: "https://www.google.com/maps/contrib/999888777666555?hl=en",
        text: "Used authorUrl field",
      }),
      // Uses reviewText instead of text
      createGoogleReview({
        text: null,
        reviewText: "Used reviewText field",
      }),
      // Uses authorName instead of name
      createGoogleReview({
        name: null,
        authorName: "Used AuthorName",
        text: "Name from authorName",
      }),
      // Uses rating instead of stars
      createGoogleReview({
        stars: null,
        rating: 4,
        text: "Rating from rating field",
      }),
      // Uses alternative photo fields
      createGoogleReview({
        reviewerPhotoUrl: null,
        userPhotoUrl: "https://example.com/userphoto.jpg",
        text: "Photo from userPhotoUrl",
      }),
      createGoogleReview({
        reviewerPhotoUrl: null,
        userPhotoUrl: null,
        reviewerAvatar: "https://example.com/avatar.jpg",
        text: "Photo from reviewerAvatar",
      }),
    ]),
    emptyResponse: createGoogleResponse([]),
  },

  facebook: {
    mixedReviews: createFlatResponse([
      createFacebookReview({ isRecommended: true }),
      createFacebookReview({
        isRecommended: false,
        text: "Not happy with the service",
        user: { name: "Unhappy Customer", id: "9876543210" },
      }),
      createFacebookReview({ text: "OK" }), // Short content
      createFacebookReview({ text: "", isRecommended: true }), // Empty content
    ]),
    pfbidUser: createFlatResponse([
      createFacebookReview({
        user: {
          name: "PFBID User",
          id: "pfbid02ABC123DEF456",
          profileUrl: "https://facebook.com/pfbiduser",
        },
      }),
    ]),
    noUserId: createFlatResponse([
      createFacebookReview({
        user: { name: "No ID User", id: null, profileUrl: null },
      }),
    ]),
    emptyResponse: createFlatResponse([]),
  },

  trustpilot: {
    mixedReviews: createFlatResponse([
      createTrustpilotReview({ ratingValue: "5" }),
      createTrustpilotReview({
        ratingValue: "3",
        reviewTitle: "Average",
        reviewText: "Nothing special",
        name: "Average Joe",
      }),
      createTrustpilotReview({
        ratingValue: "1",
        reviewTitle: "Terrible",
        reviewText: "Worst experience ever",
        name: "Angry Customer",
      }),
      createTrustpilotReview({ reviewText: "Short" }), // Short content
      createTrustpilotReview({ reviewText: "", reviewTitle: "" }), // Empty content
    ]),
    titleOnly: createFlatResponse([
      createTrustpilotReview({
        reviewTitle: "Great Title",
        reviewText: "",
      }),
    ]),
    textOnly: createFlatResponse([
      createTrustpilotReview({
        reviewTitle: null,
        reviewText: "Just the review text without a title",
      }),
    ]),
    emptyResponse: createFlatResponse([]),
  },
};

/**
 * Intercept fetch for Apify API calls
 *
 * @param {Object} handlers - Map of actor IDs to response data
 * @returns {Function} Restore function
 */
const interceptApifyFetch = (handlers) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // Check if this is an Apify API call
    if (urlStr.includes("api.apify.com")) {
      // Extract actor ID from URL
      const actorMatch = urlStr.match(/\/acts\/([^/]+)\//);
      const actorId = actorMatch ? actorMatch[1] : null;

      // Find handler for this actor
      let responseData = null;
      for (const [key, data] of Object.entries(handlers)) {
        if (ACTOR_IDS[key] === actorId || key === actorId) {
          responseData = data;
          break;
        }
      }

      if (responseData === null) {
        throw new Error(`No mock handler for actor: ${actorId}`);
      }

      // Handle error responses
      if (responseData instanceof Error) {
        throw responseData;
      }

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseData),
        json: async () => responseData,
      };
    }

    // Pass through non-Apify requests
    return originalFetch(url, options);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
};

export {
  ACTOR_IDS,
  createGoogleReview,
  createFacebookReview,
  createTrustpilotReview,
  createGoogleResponse,
  createFlatResponse,
  createHttpsMock,
  createFetchApiArrayMock,
  sampleData,
  interceptApifyFetch,
};
