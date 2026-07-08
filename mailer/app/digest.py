"""Weekly digest entrypoint (run by the K8s CronJob).

Fetches the blog's RSS, keeps posts from the last SUMMARY_DAYS, and emails the
round-up to every opted-in subscriber via SES (with list management so each
recipient gets a one-click unsubscribe). Exits quietly if there's nothing new.
"""
from __future__ import annotations

import logging
import os
import urllib.request
from datetime import datetime, timezone

from .config import load_config
from .emails import build_digest, parse_rss, recent_items
from .ses import Ses

log = logging.getLogger("mailer.digest")
logging.basicConfig(level=logging.INFO)


def run() -> None:
    cfg = load_config()
    rss_url = os.environ["BLOG_RSS_URL"]
    days = int(os.environ.get("SUMMARY_DAYS", "7"))
    site_title = os.environ.get("SITE_TITLE", "The Blog")

    with urllib.request.urlopen(rss_url, timeout=15) as resp:
        xml = resp.read().decode("utf-8")

    items = recent_items(parse_rss(xml), datetime.now(timezone.utc), days)
    if not items:
        log.info("digest: no posts in the last %d days; nothing to send", days)
        return

    digest = build_digest(items, site_title)
    ses = Ses(cfg.region, cfg.mail_from, cfg.contact_list, cfg.topic)
    recipients = ses.subscribers()
    log.info("digest: %d post(s) -> %d subscriber(s)", len(items), len(recipients))

    sent = 0
    for email in recipients:
        try:
            ses.send(email, digest["subject"], digest["html"], html=True, list_mgmt=True)
            sent += 1
        except Exception:  # noqa: BLE001 - one bad recipient must not stop the rest
            log.exception("digest: failed sending to %s", email)
    log.info("digest: sent %d/%d", sent, len(recipients))


if __name__ == "__main__":
    run()
