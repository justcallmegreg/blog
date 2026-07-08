"""Environment-driven configuration for the mailer service."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    region: str
    mail_from: str          # verified SES sender, e.g. "GregCo <noreply@justcallmegreg.io>"
    mail_owner: str         # where owner notifications go (unused by mailer itself; blog builds those)
    contact_list: str       # SES v2 contact list name
    topic: str              # contact-list topic (the digest)
    port: int


def load_config() -> Config:
    return Config(
        region=os.environ.get("AWS_REGION", "eu-central-1"),
        mail_from=os.environ.get("MAIL_FROM", ""),
        mail_owner=os.environ.get("MAIL_OWNER", ""),
        contact_list=os.environ.get("SES_CONTACT_LIST", ""),
        topic=os.environ.get("SES_TOPIC", "weekly-digest"),
        port=int(os.environ.get("PORT", "8080")),
    )
