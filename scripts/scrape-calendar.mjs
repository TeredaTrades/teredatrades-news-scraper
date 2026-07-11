// Fetches ForexFactory's weekly calendar feed server-side and writes it to
// disk. Run from the repo root by the GitHub Action -- no CORS issues here
// since this isn't a browser request, and no proxy is needed. Requires
// Node 18+ (global fetch), which actions/setup-node provides.
//
// Source URL and output path are read from FF_SOURCE_URL / FF_OUTPUT_FILE
// env vars so the same script can produce calendar.json (thisweek),
// calendar_lastweek.json, and calendar_nextweek.json -- see
// .github/workflows/forexfactory-calendar-scraper.yml, which calls this
// script three times with different env vars. Defaults below match the
// original thisweek/calendar.json behavior if the env vars aren't set
// (e.g. running the script locally by hand).
import fs from "node:fs";
import path from "node:path";
const FEED_URL = process.env.FF_SOURCE_URL || "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const OUTPUT_PATH = process.env.FF_OUTPUT_FILE || "output/calendar.json";
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
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${data.length} calendar events to ${OUTPUT_PATH}`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
