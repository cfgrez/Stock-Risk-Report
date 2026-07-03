// src/index.js — Cloudflare Worker entry point.
//
// Uses Workers static assets (the [assets] block in wrangler.toml) to serve
// everything in /public, and handles /api/report itself. One Worker, one
// `wrangler deploy`, one *.workers.dev (or custom domain) URL.

import { handleReport } from "./report.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/report") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "content-type": "application/json" },
        });
      }
      return handleReport(request, env);
    }

    // Everything else (/, /index.html, /style.css, /app.js, ...) is served
    // straight from the public/ directory via the ASSETS binding.
    return env.ASSETS.fetch(request);
  },
};
