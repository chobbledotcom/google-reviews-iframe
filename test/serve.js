#!/usr/bin/env bun
/**
 * Simple test server for Playwright tests
 */

const path = require("node:path");
const fs = require("node:fs");

const rootDir = path.join(__dirname, "..");

const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
};

const server = Bun.serve({
  port: 3456,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Map routes to files
    let filePath;
    if (pathname === "/" || pathname === "/parent") {
      filePath = path.join(__dirname, "fixtures", "parent.html");
    } else if (pathname === "/child" || pathname === "/child/") {
      filePath = path.join(__dirname, "fixtures", "child.html");
    } else if (pathname === "/db-entertainment" || pathname === "/db-entertainment/") {
      filePath = path.join(rootDir, "data", "db-entertainment", "index.html");
    } else if (pathname === "/parent-db-entertainment") {
      filePath = path.join(__dirname, "fixtures", "parent-db-entertainment.html");
    } else if (pathname === "/js" || pathname === "/reviews-embed.js") {
      filePath = path.join(rootDir, "dist", "reviews-embed.js");
    } else if (pathname.startsWith("/dist/")) {
      filePath = path.join(rootDir, pathname);
    } else if (pathname.startsWith("/test/")) {
      filePath = path.join(rootDir, pathname);
    } else {
      filePath = path.join(rootDir, pathname);
    }

    try {
      const file = Bun.file(filePath);
      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || "application/octet-stream";

      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    } catch (e) {
      return new Response("Not Found", { status: 404 });
    }
  },
});

console.log(`Test server running at http://localhost:${server.port}`);
