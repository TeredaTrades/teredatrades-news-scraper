// Maintains a rolling archive of every ForexFactory "thisweek" event this
// repo has ever fetched, and derives calendar_lastweek.json from it.
//
// Why: ForexFactory's free feed only ever serves output/calendar.json's
// source (ff_calendar_thisweek.json) -- there is no ff_calendar_lastweek.json
// or ff_calendar_nextweek.json anymore (confirmed both 404 as of July 2026).
// "Next week" genuinely cannot be reconstructed (no feed can archive
// forward into the future), but "last week" can: every event ForexFactory
// ever shows us as part of "this week" gets kept, so once a week rolls
// over, that data becomes available again by pulling it out of the archive.
//
// Run this AFTER scrape-calendar.mjs has written a fresh output/calendar.json
// for thisweek. Reads:
//   output/calendar.json          <- freshly fetched thisweek events
//   output/calendar_archive.json  <- everything fetched so far (created if missing)
// Writes:
//   output/calendar_archive.json  <- merged + pruned
//   output/calendar_lastweek.json <- archive filtered to last week's window
import fs from "node:fs";

const CALENDAR_PATH = "output/calendar.json";
const ARCHIVE_PATH = "output/calendar_archive.json";
const LASTWEEK_PATH = "output/calendar_lastweek.json";
const PRUNE_DAYS = 21; // keep ~3 weeks of history; only need the most recent 1 for lastweek

// Calendar-date arithmetic done purely on Y-M-D strings (no time-of-day),
// so this is safe regardless of DST -- we only ever compare "which day is
// this event on in America/New_York", never exact instants.
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function etDateStr(isoDateTime) {
  return new Date(isoDateTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function eventKey(ev) {
  return `${ev.date}|${ev.country}|${ev.title}`;
}

function main() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    throw new Error(`${CALENDAR_PATH} not found -- run scrape-calendar.mjs (thisweek) first`);
  }
  const fresh = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
  if (!Array.isArray(fresh)) {
    throw new Error(`${CALENDAR_PATH} did not contain a JSON array`);
  }

  let archive = [];
  if (fs.existsSync(ARCHIVE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ARCHIVE_PATH, "utf8"));
      if (Array.isArray(parsed)) archive = parsed;
    } catch (err) {
      console.warn(`Couldn't parse existing ${ARCHIVE_PATH}, starting fresh:`, err.message);
    }
  }

  // Upsert: fresh events overwrite any existing archive entry with the same
  // key, so revised forecast/actual values replace stale ones instead of
  // piling up as duplicates.
  const byKey = new Map(archive.map((ev) => [eventKey(ev), ev]));
  for (const ev of fresh) byKey.set(eventKey(ev), ev);

  // Prune anything older than PRUNE_DAYS (by ET calendar date) to keep the
  // archive from growing forever.
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const cutoff = addDays(todayET, -PRUNE_DAYS);
  const merged = [...byKey.values()].filter((ev) => etDateStr(ev.date) >= cutoff);
  merged.sort((a, b) => new Date(a.date) - new Date(b.date));

  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Archive updated: ${merged.length} events (pruned before ${cutoff})`);

  // Derive last week's Sunday..Saturday window (ET), then filter the archive
  // down to just those days.
  const todayDow = new Date(`${todayET}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const thisWeekSunday = addDays(todayET, -todayDow);
  const lastWeekSunday = addDays(thisWeekSunday, -7);
  const lastWeekDays = new Set(Array.from({ length: 7 }, (_, i) => addDays(lastWeekSunday, i)));

  const lastWeekEvents = merged.filter((ev) => lastWeekDays.has(etDateStr(ev.date)));
  fs.writeFileSync(LASTWEEK_PATH, JSON.stringify(lastWeekEvents, null, 2) + "\n");
  console.log(
    `Wrote ${lastWeekEvents.length} events to ${LASTWEEK_PATH} ` +
    `(window ${lastWeekSunday}..${addDays(lastWeekSunday, 6)})`
  );
}

main();
