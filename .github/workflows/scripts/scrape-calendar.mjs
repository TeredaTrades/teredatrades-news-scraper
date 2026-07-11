// Fetches ForexFactory's weekly calendar feed server-side and writes it to
// output/calendar.json. Run from the repo root by the GitHub Action --
// no CORS issues here since this isn't a browser request, and no proxy
// is needed. Requires Node 18+ (global fetch), which actions/setup-node
// provides.

import fs from "node:fs";

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const OUTPUT_PATH = "output/calendar.json";

async function main() {
  const res = await fetch(FEED_URL, {
    headers: {
      // Some hosts reject requests with no UA at all; a normal-looking one
      // avoids that without doing anything sneaky.
      "User-Agent": "Mozilla/5.0 (compatible; TeredaTradesCalendarBot/1.0; +https://github.com/TeredaTrades/teredatrades-news-scraper)"
    }
  });

  if (!res.ok) {
    throw new Error(`ForexFactory feed request failed: HTTP ${res.status}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected payload shape from ForexFactory feed (expected a JSON array)");
  }

  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");

  console.log(`Wrote ${data.length} calendar events to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
