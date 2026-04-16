# Reviews Iframe

A toolchain that periodically fetches customer reviews from Google, Facebook
and Trustpilot, stores them as JSON, and pre-generates static HTML pages that
can be dropped into any site as a responsive, auto-sizing iframe.

Reviews are fetched via the [Apify](https://apify.com) API using the tokens
stored in GitHub Actions secrets. Rendered HTML is published to a CDN, and a
lightweight embed script pairs an `<iframe>` on the host site with its
`iframe-resizer` child running inside the iframe so the frame grows to match
its content.

## Repository Layout

### config.json

An array of businesses to fetch, each with the platform identifiers it has and
per-platform fetch state. A minimal entry looks like:

    {
      "google_business_id": "ChIJ...",
      "facebook_page_url": "https://www.facebook.com/Example",
      "trustpilot_url": "https://uk.trustpilot.com/review/example.com",
      "slug": "example",
      "number_of_reviews": -1,
      "minimum_star_rating": 0,
      "fetch_frequency_days": 7
    }

A business can include any subset of the three platform fields. Each platform
that has been fetched records its own `last_fetched_<source>` timestamp so the
three sources can run on independent schedules.

### src/fetch-google-reviews.js / fetch-facebook-reviews.js / fetch-trustpilot-reviews.js

Per-platform fetchers. Each one loads `config.json`, filters to businesses
that have the relevant platform field, checks whether `fetch_frequency_days`
has elapsed since the last fetch for that source, and then calls the
appropriate Apify actor. Results are normalised to a shared review shape and
written to `data/<slug>/<author-slug>-<YYYY-MM-DD>.json`.

Each script accepts an optional slug argument to fetch just that business:

    bun src/fetch-google-reviews.js my-business-slug

### src/lib/shared.js

Shared helpers: config loading, Apify HTTP calls (with a curl fallback for
flaky DNS), reviewer avatar download + resize to `.webp` thumbnails via
`sharp`, filename formatting, and the review fetcher factory that the three
platform scripts are built on top of.

### src/render-iframes.js

Reads the JSON files for each business, **deduplicates reviews that appear on
more than one platform** (priority: Trustpilot > Google > Facebook), sorts
the remaining reviews newest-first, and renders `data/<slug>/index.html` and
`data/<slug>/code.txt` (the `<iframe>` embed snippet to paste into a host
page).

Can be called with a single slug to render just that business or with no
argument to render all of them.

### src/iframe-layout.html

The iframe template. It includes inline CSS, inline SVG, and the bundled
`masonry.js` and `iframe-resizer-child.js` so that everything a visitor needs
arrives in a single HTML request. Review cards flow in a masonry column
layout that reshapes to fit the iframe width.

### src/embed/ and src/build.js

The embed side of the integration. `src/build.js` uses Bun's bundler to
produce three minified browser scripts in `dist/`:

* `reviews-embed.js` - loaded by the host site; wires `iframe-resizer`'s
  parent side up to any iframe on the page.
* `iframe-resizer-child.js` - loaded inside the iframe so it can report its
  content size back to the parent.
* `masonry.js` - client-side greedy shortest-column masonry layout that runs
  inside the iframe.

Run the bundle locally with:

    bun run build

### data/

Generated output, committed back to the repo by the GitHub Action. Per
business:

* `data/<slug>/*.json` - one file per review.
* `data/<slug>/index.html` - the rendered iframe contents.
* `data/<slug>/code.txt` - the embed snippet for that business.

### images/reviewers/

Downloaded reviewer avatars, resized to 48x48 (`<userId>.webp`) and 96x96
(`<userId>@2x.webp`) WebP images. Served alongside the rendered iframes from
the CDN.

### .github/workflows/fetch-google-reviews.yml

The scheduled GitHub Action. Runs daily (and on push) to:

1. Install dependencies and build the embed bundles.
2. Run each platform fetcher (Google, Facebook, Trustpilot) for every
   business that is due.
3. Render the iframes.
4. Commit any new reviews/renders back to the repo.
5. Sync `data/` and the embed script to Bunny CDN.

The workflow can also be dispatched manually with an optional business slug
and source (`google`, `facebook`, `trustpilot`, or `all`) to refresh a single
business or a single platform.

## Deduplication

Many customers leave the same review on more than one platform. At render
time, reviews are deduplicated across sources by normalised author name and
content. When the same review is present on multiple platforms, the
highest-priority copy is kept:

    trustpilot > google > facebook

The source-specific JSON files are left untouched on disk; deduplication only
affects what is rendered into the iframe.

## Local Development

    bun install                       # install dependencies
    bun run build                     # bundle embed scripts into dist/
    bun run fetch                     # fetch Google reviews (needs APIFY_API_TOKEN)
    bun run fetch:facebook            # fetch Facebook reviews
    bun src/fetch-trustpilot-reviews.js
    bun run render                    # regenerate data/<slug>/index.html
    bun run lint                      # biome check
    bun run test:e2e                  # playwright end-to-end tests

An `APIFY_API_TOKEN` in a `.env` file at the repo root is required to fetch
from any of the three platforms.
