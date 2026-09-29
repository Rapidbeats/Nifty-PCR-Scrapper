/**
 * NSE Nifty option-chain scraper
 * -------------------------------
 * Bootstraps a browser-like session against nseindia.com (required — the
 * underlying JSON API rejects requests that don't carry cookies obtained
 * from a prior page load), then fetches the live option-chain data and
 * reduces it to the ATM +/- windowSize strikes needed for PCR calculation.
 *
 * NOTE: nseindia.com actively blocks/rate-limits requests coming from known
 * datacenter/cloud IP ranges (AWS, GCP, GitHub-hosted CI runners, etc.).
 * Test this from wherever you actually intend to run it in production
 * BEFORE building anything on top of it — see README.md.
 */

const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const STRIKE_STEP = 50; // Nifty strikes are quoted in steps of 50

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/option-chain',
};

/**
 * Creates a fresh axios instance with its own cookie jar and walks the
 * normal browser path (home page -> option-chain page) so NSE issues the
 * cookies its API requires. A new client per call keeps runs isolated
 * (important when this is invoked repeatedly on a 5-min schedule).
 */
function createSessionClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({ jar, withCredentials: true, timeout: 15000 }));
}

async function bootstrapSession(client) {
  await client.get('https://www.nseindia.com', { headers: HEADERS });
  await client.get('https://www.nseindia.com/option-chain', { headers: HEADERS });
}

async function fetchOptionChainRaw(client, symbol = 'NIFTY') {
  const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
  const res = await client.get(url, { headers: HEADERS });
  return res.data;
}

function nearestStrike(spot, step = STRIKE_STEP) {
  return Math.round(spot / step) * step;
}

/**
 * Reduces the full option-chain payload to just what's needed:
 * spot value, timestamp, ATM strike, and Call/Put Chng-in-OI for the
 * strikes within +/- windowSize of ATM.
 *
 * @param {object} raw - parsed JSON from the option-chain-indices API
 * @param {number} windowSize - number of strikes above/below ATM to keep
 */
function extractSnapshot(raw, windowSize = 10) {
  const records = raw && raw.records;
  if (!records || !Array.isArray(records.data)) {
    throw new Error('Unexpected option-chain payload shape (records.data missing)');
  }

  const spot = records.underlyingValue;
  const timestamp = records.timestamp; // e.g. "25-Sep-2026 15:40:00"
  const atm = nearestStrike(spot);

  const lowStrike = atm - windowSize * STRIKE_STEP;
  const highStrike = atm + windowSize * STRIKE_STEP;

  const strikes = records.data
    .filter((row) => row.strikePrice >= lowStrike && row.strikePrice <= highStrike)
    .map((row) => ({
      strike: row.strikePrice,
      callChangeInOI: row.CE ? row.CE.changeinOpenInterest : null,
      putChangeInOI: row.PE ? row.PE.changeinOpenInterest : null,
    }))
    .sort((a, b) => a.strike - b.strike);

  return {
    spot,
    atm,
    nseTimestamp: timestamp,
    capturedAtIso: new Date().toISOString(),
    windowSize,
    strikes,
  };
}

/**
 * Full capture via direct HTTP: bootstrap session -> fetch -> extract.
 * NOTE: nseindia.com's Akamai bot-detection fingerprints the TLS/JS
 * handshake, not just headers/cookies — this path commonly gets a 403
 * even with a valid session and correct headers. If that happens, use
 * captureSnapshotViaBrowser instead. See README.md.
 */
async function captureSnapshot({ symbol = 'NIFTY', windowSize = 10 } = {}) {
  const client = createSessionClient();
  await bootstrapSession(client);
  const raw = await fetchOptionChainRaw(client, symbol);
  return extractSnapshot(raw, windowSize);
}

/**
 * Full capture via a real headless browser (Playwright), which passes
 * Akamai's bot-detection because it's an actual Chromium instance. Slower
 * and heavier than captureSnapshot, but far more reliable against NSE.
 */
async function captureSnapshotViaBrowser({ symbol = 'NIFTY', windowSize = 10 } = {}) {
  // Required lazily so environments that only use the HTTP path don't need
  // Playwright's browser binaries installed.
  const { fetchOptionChainViaBrowser } = require('./browser-fetch');
  const raw = await fetchOptionChainViaBrowser(symbol);
  return extractSnapshot(raw, windowSize);
}

module.exports = {
  captureSnapshot,
  captureSnapshotViaBrowser,
  extractSnapshot, // exported directly so it can be unit-tested without network
  nearestStrike,
};
