"""FastAPI app for the mailer service.

Internal-only (ClusterIP, no auth). The blog engine calls /send for all
transactional mail and /subscribe|/unsubscribe for the newsletter list.
"""
from __future__ import annotations

import logging

from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import load_config
from .emails import valid_email
from .ses import Ses

log = logging.getLogger("mailer")
cfg = load_config()

# Module-level so tests can substitute a fake (e.g. `main.ses = FakeSes()`).
ses = Ses(cfg.region, cfg.mail_from, cfg.contact_list, cfg.topic)

app = FastAPI(title="mailer", docs_url=None, redoc_url=None)


class SendReq(BaseModel):
    to: str
    subject: str
    body: str
    replyTo: str | None = None
    html: bool = False


class EmailReq(BaseModel):
    email: str


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/send")
def send(req: SendReq) -> dict:
    if not valid_email(req.to):
        raise HTTPException(status_code=400, detail="invalid 'to' address")
    if not req.subject or not req.body:
        raise HTTPException(status_code=400, detail="subject and body are required")
    try:
        message_id = ses.send(req.to, req.subject, req.body, req.replyTo, req.html)
    except ClientError:
        log.exception("SES send failed")
        raise HTTPException(status_code=502, detail="send failed")
    return {"ok": True, "messageId": message_id}


@app.post("/subscribe")
def subscribe(req: EmailReq) -> dict:
    if not valid_email(req.email):
        raise HTTPException(status_code=400, detail="invalid email")
    try:
        ses.subscribe(req.email.strip())
    except ClientError:
        log.exception("SES subscribe failed")
        raise HTTPException(status_code=502, detail="subscribe failed")
    return {"ok": True}


@app.post("/unsubscribe")
def unsubscribe(req: EmailReq) -> dict:
    if not valid_email(req.email):
        raise HTTPException(status_code=400, detail="invalid email")
    try:
        ses.unsubscribe(req.email.strip())
    except ClientError:
        log.exception("SES unsubscribe failed")
        raise HTTPException(status_code=502, detail="unsubscribe failed")
    return {"ok": True}
