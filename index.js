const fs = require('fs');
const path = require('path');
const { captureSnapshot, captureSnapshotViaBrowser } = require('./scraper');

// Days-to-expiry -> strike window, per the strategy spec (Tuesday = expiry).
// Kept here (rather than baked into scraper.js) so the holiday-shift logic
// that reindexes this table can live in one obvious place later.
const WINDOW_BY_DAYS_TO_EXPIRY = {
  0: 1, // expiry day
  1: 2,
  2: 3,
  3: 4,
  4: 5,
};

async function main() {
  const symbol = process.env.NSE_SYMBOL || 'NIFTY';

  // Placeholder: replace with the real days-to-expiry calc (holiday-aware)
  // once the trading-calendar module exists. Defaults to the widest window
  // for now so a manual test run always returns data.
  const daysToExpiry = process.env.DAYS_TO_EXPIRY
    ? Number(process.env.DAYS_TO_EXPIRY)
    : 4;
  const windowSize = WINDOW_BY_DAYS_TO_EXPIRY[daysToExpiry] ?? 10;

  // Direct HTTP requests get a 403 from NSE's Akamai bot-detection in most
  // environments — default to the browser-driven path, which passes it.
  // Set FETCH_METHOD=http to try the direct path (useful for testing
  // whether a given host/network is an exception).
  const method = process.env.FETCH_METHOD === 'http' ? 'http' : 'browser';

  console.log(
    `Capturing NSE ${symbol} option chain via ${method} (window=+/-${windowSize} strikes)...`
  );

  const snapshot =
    method === 'http'
      ? await captureSnapshot({ symbol, windowSize })
      : await captureSnapshotViaBrowser({ symbol, windowSize });

  console.log(JSON.stringify(snapshot, null, 2));

  // Local file output for now — swap this for a Supabase insert once the
  // DB schema/step is in place.
  const outDir = path.join(__dirname, 'snapshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${snapshot.capturedAtIso.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
  console.log(`Saved to ${outFile}`);
}

main().catch((err) => {
  console.error('Scraper run failed:', err.message);
  if (err.response) {
    console.error('HTTP status:', err.response.status);
  }
  process.exit(1);
});
