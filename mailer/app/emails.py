"""Pure helpers: email validation, RSS parsing, and digest formatting.

These have no AWS/network dependencies so they are straightforward to unit-test.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import escape

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def valid_email(value: str | None) -> bool:
    return bool(EMAIL_RE.match((value or "").strip()))


def parse_rss(xml_text: str) -> list[dict]:
    """Parse an RSS 2.0 document into a list of items with a parsed datetime."""
    root = ET.fromstring(xml_text)
    items: list[dict] = []
    for item in root.iter("item"):
        def text(tag: str) -> str:
            el = item.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        pub = text("pubDate")
        when: datetime | None = None
        if pub:
            try:
                when = parsedate_to_datetime(pub)
            except (TypeError, ValueError):
                when = None
        items.append(
            {
                "title": text("title"),
                "link": text("link"),
                "description": text("description"),
                "date": when,
            }
        )
    return items


def recent_items(items: list[dict], now: datetime, days: int) -> list[dict]:
    """Items published within the last `days` (dropping undated ones)."""
    cutoff = now - timedelta(days=days)
    out: list[dict] = []
    for it in items:
        when = it.get("date")
        if when is None:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when >= cutoff:
            out.append(it)
    return out


def build_digest(items: list[dict], site_title: str) -> dict:
    """Build the digest email {subject, text, html} from recent items."""
    subject = f"{site_title} — new posts"
    text_lines = [f"New posts from {site_title}:", ""]
    html_parts = [
        f"<h2>New posts from {escape(site_title)}</h2>",
        "<ul>",
    ]
    for it in items:
        title = it.get("title") or it.get("link") or "(untitled)"
        link = it.get("link") or ""
        desc = it.get("description") or ""
        text_lines.append(f"- {title}\n  {link}")
        html_parts.append(
            f'<li><a href="{escape(link)}">{escape(title)}</a>'
            + (f"<br><span>{escape(desc)}</span>" if desc else "")
            + "</li>"
        )
    html_parts.append("</ul>")
    return {"subject": subject, "text": "\n".join(text_lines), "html": "\n".join(html_parts)}
