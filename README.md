# NSE Nifty Option-Chain Scraper

Captures a live Nifty option-chain snapshot from nseindia.com: spot value,
timestamp, and Call/Put "Change in OI" for the ATM ± N strikes.

## Files

- `scraper.js` — core logic: session bootstrap, fetch (both methods),
  extract. Extraction is pure and testable (`extractSnapshot` takes plain
  JSON, no network).
- `browser-fetch.js` — Playwright-driven fetch: loads the option-chain page
  in a real headless Chromium and intercepts the JSON response the page
  itself requests, instead of calling the API directly.
- `index.js` — CLI entry point: runs a capture, prints it, saves it to
  `snapshots/<timestamp>.json`. Uses the browser method by default.
- `test-extract.js` — offline test against a hand-built fixture, proving the
  ATM/window/OI extraction logic is correct without needing network access.

## ⚠️ NSE will most likely 403 the direct HTTP path — use the browser method

nseindia.com sits behind Akamai bot-detection that fingerprints the TLS/JS
handshake itself, not just IP, headers, or cookies. That means a plain HTTP
client (axios, `requests`, `curl`) can get a 403 even with a valid session
and perfect browser-like headers, **from any network, including your own
home connection** — this is a step up from ordinary IP-based blocking.

The fix: `captureSnapshotViaBrowser` (in `browser-fetch.js`) drives a real
headless Chromium via Playwright to load the page normally, which passes
the bot check, and intercepts the same JSON the page's own script requests.
This is the default in `index.js`.

Setup:
```bash
npm install
npx playwright install chromium   # downloads the browser binary, one-time
node index.js                     # uses the browser method by default
```

If you want to compare against the direct HTTP path (e.g. to see whether a
particular host is an exception):
```bash
FETCH_METHOD=http node index.js
```

If the browser method *also* gets blocked, the remaining options are:
1. A residential/India-region IP instead of a hyperscaler datacenter IP —
   Akamai still weighs IP reputation alongside the fingerprint check.
2. A stealth plugin (e.g. `playwright-extra` + a stealth plugin) to mask the
   remaining signals that distinguish automated Chromium from a real user's.
3. A paid market-data provider instead of scraping NSE at all, if reliability
   turns out to matter more than the (free) cost of scraping.

Either way: test the browser method from wherever you intend to actually
deploy this (e.g. a throwaway GitHub Actions run) before building the DB,
PCR engine, or anything else on top of it.

## Repo structure

```
nse-scraper/
├── .github/workflows/scrape.yml   # scheduled + manual GitHub Actions job
├── .gitignore
├── scraper.js                     # session bootstrap, fetch (both methods), extract
├── browser-fetch.js               # Playwright-driven fetch (the one that actually works)
├── index.js                       # CLI entry point
├── test-extract.js                # offline test, no network needed
├── package.json
└── README.md
```

## Pushing this and testing on GitHub Actions

```bash
git init
git add .
git commit -m "Initial NSE scraper"
git remote add origin <your-repo-url>
git push -u origin main
```

Then, **before trusting the cron schedule**: go to the repo's Actions tab,
select "NSE PCR Scraper", and click "Run workflow" (this uses the
`workflow_dispatch` trigger). This runs it once, immediately, on GitHub's
own servers — which is the real test of whether this deployment target
works, since GitHub's runner IPs (Microsoft/Azure datacenter ranges) are
a different network profile than your own machine, and are exactly the
kind of address range NSE's Akamai protection is most likely to flag.

Check the run's log for the same `[net:request]` / `[diagnostic]` lines
you've seen locally. If it completes and produces a snapshot, the
workflow also uploads it as a downloadable build artifact (see the
"Artifacts" section at the bottom of the run page) so you can inspect it
without re-running locally.

If GitHub's IPs get blocked where your own didn't, the options are the
same three listed in the section above (residential/India-region host,
stealth plugin, or a paid data provider) — a blocked CI IP doesn't mean
the browser-based approach itself has failed, just that this particular
host's network reputation is the problem.

Once this test passes, the cron schedule in `scrape.yml` takes over
automatically — no further action needed.

## Environment variables

- `NSE_SYMBOL` — defaults to `NIFTY`.
- `DAYS_TO_EXPIRY` — 0–4, controls the strike window (0 = expiry day, ±1
  strike; 4 = ±5 strikes). This is a placeholder until the holiday-aware
  trading-calendar module replaces it with a real calculation.

## What's not built yet

- The trading-calendar / holiday-shift logic that computes `daysToExpiry`
  automatically (currently a manual env var).
- Writing snapshots to Supabase instead of local JSON files.
- The 5-minute scheduling loop (intended to run via GitHub Actions cron, or
  whatever host passes the network test above).
- The PCR calculation and the strategy/signal engine.
