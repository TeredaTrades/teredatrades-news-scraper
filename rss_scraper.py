import json
import os
from datetime import datetime, timezone
from pathlib import Path

import feedparser

# ---------------------------------------------------------------------------
# FEEDS
# ---------------------------------------------------------------------------
# type:
#   "rss"        -> plain RSS/Atom feed, fetched directly
#   "twitter"    -> X/Twitter account, no native RSS. Fetched via a bridge
#                   (default: Nitter). Bridges are unofficial and go down
#                   often -- see BRIDGE NOTES below.
#   "telegram"   -> public Telegram channel, no native RSS. Fetched via a
#                   bridge (default: RSSHub). Same caveat as twitter.
#   "github_releases" -> GitHub repo releases, native Atom feed (reliable)
#   "github_commits"  -> GitHub repo commits on a branch, native Atom feed
#
# BRIDGE NOTES:
#   Twitter/X and Telegram have no official RSS anymore. This script uses
#   public bridge instances (Nitter for X, RSSHub for Telegram). Public
#   instances are frequently rate-limited or offline. For reliable use,
#   self-host your own Nitter (https://github.com/zedeus/nitter) and/or
#   RSSHub (https://github.com/DIYgod/RSSHub) instance -- e.g. on the same
#   Railway project as your Telegram bot -- and swap the base URLs below.

NITTER_BASE = "https://nitter.net"          # swap to your own instance if this dies
RSSHUB_BASE = "https://rsshub.app"          # swap to your own instance if this dies

FEEDS = [
    # --- Macro / official ---
    {"name": "Federal Reserve", "type": "rss", "url": "https://www.federalreserve.gov/feeds/press_all.xml", "category": "macro"},
    # US Treasury RSS retired -- site rebuilt on Drupal, no public feed anymore
    # (only GovDelivery email subscription). Re-check periodically:
    # https://home.treasury.gov/news/press-releases

    # --- News sites ---
    # DailyFX RSS retired -- dailyfx.com now redirects into IG.com's own site,
    # brand appears folded in. Re-check periodically if this matters to you.
    {"name": "FXStreet", "type": "rss", "url": "https://www.fxstreet.com/rss/news", "category": "news"},
    {"name": "FinancialJuice", "type": "rss", "url": "https://www.financialjuice.com/feed.ashx?x=1&rss=1", "category": "news"},

    # --- Reddit ---
    {"name": "r/Forex", "type": "rss", "url": "https://www.reddit.com/r/Forex/.rss", "category": "reddit"},
    {"name": "r/Daytrading", "type": "rss", "url": "https://www.reddit.com/r/Daytrading/.rss", "category": "reddit"},
    {"name": "r/WallStreetBets", "type": "rss", "url": "https://www.reddit.com/r/wallstreetbets/.rss", "category": "reddit"},
    {"name": "r/Economics", "type": "rss", "url": "https://www.reddit.com/r/Economics/.rss", "category": "reddit"},

    # --- X / Twitter (via bridge) ---
    {"name": "Kobeissi Letter", "type": "twitter", "handle": "KobeissiLetter", "category": "twitter"},
    {"name": "Walter Bloomberg", "type": "twitter", "handle": "DeItaone", "category": "twitter"},

    # --- Telegram (via bridge) ---
    # Fill in real channel usernames (the part after t.me/) you actually want tracked.
    # Example placeholders below -- replace or remove.
    # {"name": "Some Telegram Channel", "type": "telegram", "handle": "channel_username", "category": "telegram"},

    # --- GitHub (via native Atom feeds -- reliable, no bridge needed) ---
    # Fill in owner/repo pairs for tools you actually want release/commit alerts on.
    # Example placeholders below -- replace or remove.
    # {"name": "some-trading-repo releases", "type": "github_releases", "repo": "owner/repo", "category": "github"},
    # {"name": "some-trading-repo commits", "type": "github_commits", "repo": "owner/repo", "branch": "main", "category": "github"},
]

KEYWORDS = [
    "usd", "dxy", "fed", "fomc", "powell", "inflation", "cpi", "nfp",
    "jobs", "rates", "yield", "trump", "nvidia", "apple", "microsoft",
    "amazon", "google", "meta", "tesla", "nasdaq", "sp500", "s&p",
    # gold / metals additions
    "gold", "xau", "xauusd", "xag", "silver", "metals",
]

OUT_DIR = Path("output")
OUT_DIR.mkdir(exist_ok=True)
OUT_FILE = OUT_DIR / "rss_items.json"


def pick_time(entry):
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        t = entry.get(key)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def matches_keywords(text):
    t = (text or "").lower()
    return any(k in t for k in KEYWORDS)


def build_url(feed):
    """Resolve the actual feed URL to fetch based on feed type."""
    ftype = feed.get("type", "rss")
    if ftype == "rss":
        return feed["url"]
    if ftype == "twitter":
        return f"{NITTER_BASE}/{feed['handle']}/rss"
    if ftype == "telegram":
        return f"{RSSHUB_BASE}/telegram/channel/{feed['handle']}"
    if ftype == "github_releases":
        return f"https://github.com/{feed['repo']}/releases.atom"
    if ftype == "github_commits":
        branch = feed.get("branch", "main")
        return f"https://github.com/{feed['repo']}/commits/{branch}.atom"
    raise ValueError(f"Unknown feed type: {ftype}")


def fetch_feed(feed):
    url = build_url(feed)
    parsed = feedparser.parse(url)

    # feedparser doesn't raise on HTTP errors, it just returns empty/partial
    # results with a `bozo` flag set -- surface that as an error upstream.
    if parsed.bozo and not parsed.entries:
        raise RuntimeError(f"failed to parse feed ({parsed.get('bozo_exception', 'unknown error')})")

    items = []
    for entry in parsed.entries[:20]:
        title = entry.get("title", "").strip()
        summary = entry.get("summary", "").strip()
        link = entry.get("link", "").strip()
        text = f"{title} {summary}".lower()

        # GitHub feeds are low-volume and always relevant to your workflow --
        # don't keyword-filter them, just pass them through.
        is_github = feed.get("type", "").startswith("github")
        if not is_github and not matches_keywords(text):
            continue

        items.append({
            "source": feed["name"],
            "category": feed["category"],
            "title": title,
            "summary": summary[:400],
            "link": link,
            "published": pick_time(entry),
            "score": sum(1 for k in KEYWORDS if k in text) if not is_github else None,
        })
    return items


def dedupe(items):
    seen = set()
    out = []
    for item in items:
        key = (item["title"], item["link"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return sorted(out, key=lambda x: x["published"], reverse=True)


def main():
    all_items = []
    errors = []

    for feed in FEEDS:
        try:
            all_items.extend(fetch_feed(feed))
        except Exception as e:
            errors.append({"source": feed["name"], "type": feed.get("type", "rss"), "error": str(e)})

    items = dedupe(all_items)

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(items),
        "items": items,
        "errors": errors,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"saved {len(items)} items to {OUT_FILE}")
    if errors:
        print(f"{len(errors)} source(s) failed:")
        for e in errors:
            print(f"  - {e['source']} ({e['type']}): {e['error']}")


if __name__ == "__main__":
    main()
