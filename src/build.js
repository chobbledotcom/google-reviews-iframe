#!/usr/bin/env bun

/**
 * Build script using Bun's bundler to create:
 * - dist/reviews-embed.js (parent embed with iframe-resizer)
 * - dist/iframe-resizer-child.js (child script for iframes)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

// Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

// Build parent embed script
const parentResult = await Bun.build({
  entrypoints: [path.join(__dirname, "embed/parent.js")],
  outdir: distDir,
  naming: "reviews-embed.js",
  minify: true,
  target: "browser",
});

if (!parentResult.success) {
  console.error("Parent build failed:", parentResult.logs);
  process.exit(1);
}
console.log("Built dist/reviews-embed.js");

// Build child script for iframes
const childResult = await Bun.build({
  entrypoints: [path.join(__dirname, "embed/child.js")],
  outdir: distDir,
  naming: "iframe-resizer-child.js",
  minify: true,
  target: "browser",
});

if (!childResult.success) {
  console.error("Child build failed:", childResult.logs);
  process.exit(1);
}
console.log("Built dist/iframe-resizer-child.js");

// Build masonry script for iframes
const masonryResult = await Bun.build({
  entrypoints: [path.join(__dirname, "embed/masonry.js")],
  outdir: distDir,
  naming: "masonry.js",
  minify: true,
  target: "browser",
});

if (!masonryResult.success) {
  console.error("Masonry build failed:", masonryResult.logs);
  process.exit(1);
}
console.log("Built dist/masonry.js");

console.log("Build complete!");
