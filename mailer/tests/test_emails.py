from datetime import datetime, timezone

from app.emails import build_digest, parse_rss, recent_items, valid_email

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Blog</title>
  <item><title>New post</title><link>https://x.test/new</link>
    <description>hello</description><pubDate>Mon, 06 Jul 2026 00:00:00 GMT</pubDate></item>
  <item><title>Old post</title><link>https://x.test/old</link>
    <description>bye</description><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
</channel></rss>"""


def test_valid_email():
    assert valid_email("a@b.co")
    assert not valid_email("nope")
    assert not valid_email("")
    assert not valid_email(None)


def test_parse_rss_extracts_items_with_dates():
    items = parse_rss(RSS)
    assert len(items) == 2
    assert items[0]["title"] == "New post"
    assert items[0]["link"] == "https://x.test/new"
    assert items[0]["date"].year == 2026 and items[0]["date"].month == 7


def test_recent_items_filters_by_window():
    now = datetime(2026, 7, 8, tzinfo=timezone.utc)
    recent = recent_items(parse_rss(RSS), now, days=7)
    assert [i["title"] for i in recent] == ["New post"]  # old one is > 7 days


def test_build_digest_includes_titles_and_links():
    now = datetime(2026, 7, 8, tzinfo=timezone.utc)
    recent = recent_items(parse_rss(RSS), now, days=7)
    d = build_digest(recent, "GregCo")
    assert "GregCo" in d["subject"]
    assert "New post" in d["text"] and "https://x.test/new" in d["text"]
    assert '<a href="https://x.test/new">New post</a>' in d["html"]
