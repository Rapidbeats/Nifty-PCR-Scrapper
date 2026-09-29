/**
 * Offline test for extractSnapshot() using a small hand-built fixture
 * shaped like NSE's real option-chain-indices payload. Run with:
 *   node test-extract.js
 */
const assert = require('assert');
const { extractSnapshot, nearestStrike } = require('./scraper');

function makeRow(strikePrice, ceChng, peChng) {
  return {
    strikePrice,
    CE: ceChng === null ? undefined : { changeinOpenInterest: ceChng },
    PE: peChng === null ? undefined : { changeinOpenInterest: peChng },
  };
}

// Spot at 23140.50 -> nearest 50-strike ATM should be 23150
const fixture = {
  records: {
    underlyingValue: 23140.5,
    timestamp: '25-Sep-2026 15:40:00',
    data: [
      makeRow(22900, 100, -50),
      makeRow(22950, 120, -60),
      makeRow(23000, 200, -80),
      makeRow(23050, 300, -100),
      makeRow(23100, 400, -150),
      makeRow(23150, 500, -200), // ATM
      makeRow(23200, 350, -180),
      makeRow(23250, 250, -140),
      makeRow(23300, 150, -90),
      makeRow(23350, 90, -60),
      makeRow(23400, 50, -30),
      // outside a +/-5 window on either side, to prove filtering works
      makeRow(22600, 10, -10),
      makeRow(23700, 10, -10),
    ],
  },
};

// --- nearestStrike ---
assert.strictEqual(nearestStrike(23140.5), 23150, 'ATM should round to nearest 50');
assert.strictEqual(nearestStrike(23124), 23100, 'rounds down correctly');

// --- extractSnapshot with a +/-5 window ---
const snap = extractSnapshot(fixture, 5);
assert.strictEqual(snap.spot, 23140.5);
assert.strictEqual(snap.atm, 23150);
assert.strictEqual(snap.nseTimestamp, '25-Sep-2026 15:40:00');
assert.strictEqual(snap.windowSize, 5);

// window should be 22900..23400 inclusive -> 11 strikes, excluding the two outliers
assert.strictEqual(snap.strikes.length, 11, `expected 11 strikes in window, got ${snap.strikes.length}`);
assert.strictEqual(snap.strikes[0].strike, 22900);
assert.strictEqual(snap.strikes[snap.strikes.length - 1].strike, 23400);

const atmRow = snap.strikes.find((r) => r.strike === 23150);
assert.strictEqual(atmRow.callChangeInOI, 500);
assert.strictEqual(atmRow.putChangeInOI, -200);

// --- extractSnapshot with a +/-1 window (expiry-day case) ---
const tightSnap = extractSnapshot(fixture, 1);
assert.strictEqual(tightSnap.strikes.length, 3, 'expiry-day window should keep only 3 strikes');
assert.deepStrictEqual(
  tightSnap.strikes.map((r) => r.strike),
  [23100, 23150, 23200]
);

console.log('All extractSnapshot tests passed.');
console.log(JSON.stringify(snap, null, 2));
