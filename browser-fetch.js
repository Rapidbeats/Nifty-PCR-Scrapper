/**
 * Browser-driven fetch for NSE's option chain.
 * ----------------------------------------------
 * Why this exists: nseindia.com sits behind Akamai bot-detection that
 * fingerprints the TLS/JS handshake, not just headers or cookies — so a
 * plain HTTP client (axios/requests/curl) gets a 403 even with perfect
 * headers and valid session cookies, regardless of IP.
 *
 * The workaround: drive a real Chromium instance to load the option-chain
 * page normally (passing whatever bot-check Akamai runs), and intercept the
 * network response for the same JSON endpoint the page itself calls,
 * instead of requesting that endpoint directly. We never touch the DOM —
 * the data we want comes off the wire in the exact shape scraper.js
 * already knows how to parse.
 */

const { chromium } = require('playwright');

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {string} symbol - e.g. "NIFTY"
 * @returns {Promise<object>} raw JSON payload, same shape as the direct API call
 */
async function fetchOptionChainViaBrowser(symbol = 'NIFTY') {
  // Default to a VISIBLE browser window for local debugging — a headless
  // Chromium that crashes gives you almost no information about why. Once
  // this works reliably you can set HEADLESS=true (e.g. for CI, where
  // there's no display anyway).
  const headless = process.env.HEADLESS === 'true';

  const browser = await chromium.launch({ headless });

  browser.on('disconnected', () => {
    console.error('[diagnostic] Browser disconnected/closed unexpectedly.');
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
    });
    const page = await context.newPage();

    page.on('crash', () => {
      console.error('[diagnostic] Page process crashed.');
    });
    page.on('close', () => {
      console.error('[diagnostic] Page was closed.');
    });
    page.on('console', (msg) => {
      console.log(`[page console:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error('[diagnostic] Page threw an error:', err.message);
    });

    // Broad diagnostic logging: record every request/response that looks
    // API-ish, so we can see what the page ACTUALLY calls instead of
    // assuming the old /api/option-chain-indices path still applies.
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('nseindia.com') && (u.includes('/api/') || u.includes('option-chain'))) {
        console.log(`[net:request] ${req.method()} ${u}`);
      }
    });
    page.on('response', (res) => {
      const u = res.url();
      if (u.includes('nseindia.com') && (u.includes('/api/') || u.includes('option-chain'))) {
        console.log(`[net:response] ${res.status()} ${u}`);
      }
    });

    // Set up the interception before navigating, so we don't miss the
    // request the page fires as soon as it loads. NSE renamed their
    // endpoint at some point — the current one is /api/option-chain-v3,
    // confirmed via a live network log (the old /api/option-chain-indices
    // path used by most older scraping guides no longer exists).
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/option-chain-v3') && res.url().includes(symbol),
      { timeout: DEFAULT_TIMEOUT_MS }
    );

    const url =
      symbol === 'NIFTY'
        ? 'https://www.nseindia.com/option-chain'
        : `https://www.nseindia.com/option-chain?symbol=${symbol}`;

    console.log(`[diagnostic] Navigating to ${url} (headless=${headless})...`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      console.log('[diagnostic] Navigation completed, page title:', await page.title());
    } catch (navErr) {
      console.error('[diagnostic] page.goto failed:', navErr.message);
      throw navErr;
    }

    // Give the page a generous window to make its API calls, logging
    // everything above, whether or not our specific filter ever matches.
    let response;
    try {
      response = await responsePromise;
    } catch (timeoutErr) {
      console.error(
        '[diagnostic] No request matched /api/option-chain-indices within the timeout. ' +
          'Check the [net:request]/[net:response] lines above for what actually fired — ' +
          'the endpoint path or trigger condition may have changed.'
      );
      throw timeoutErr;
    }
    if (!response.ok()) {
      throw new Error(`Intercepted response was not OK: HTTP ${response.status()}`);
    }
    const json = await response.json();

    // We haven't confirmed the v3 endpoint's JSON shape matches the old
    // one (field names, nesting) — save it and log its top-level keys so
    // a shape mismatch is immediately visible instead of failing silently
    // deep inside extractSnapshot.
    try {
      const fs = require('fs');
      const path = require('path');
      const outPath = path.join(__dirname, 'last-raw-response.json');
      fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
      console.log(`[diagnostic] Saved raw API response to ${outPath}`);
      console.log('[diagnostic] Top-level keys:', Object.keys(json));
      if (json.records) {
        console.log('[diagnostic] records keys:', Object.keys(json.records));
      }
    } catch (saveErr) {
      console.error('[diagnostic] Could not save raw response:', saveErr.message);
    }

    return json;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { fetchOptionChainViaBrowser };
