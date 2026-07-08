from fastapi.testclient import TestClient

from app import main


class FakeSes:
    def __init__(self):
        self.sent = []
        self.subscribed = []
        self.unsubscribed = []

    def send(self, to, subject, body, reply_to=None, html=False, list_mgmt=False):
        self.sent.append(
            {"to": to, "subject": subject, "body": body, "reply_to": reply_to, "html": html}
        )
        return "msg-123"

    def subscribe(self, email):
        self.subscribed.append(email)

    def unsubscribe(self, email):
        self.unsubscribed.append(email)


def client():
    fake = FakeSes()
    main.ses = fake
    return TestClient(main.app), fake


def test_healthz():
    c, _ = client()
    assert c.get("/healthz").json() == {"ok": True}


def test_send_ok():
    c, fake = client()
    r = c.post("/send", json={"to": "a@b.co", "subject": "Hi", "body": "there", "replyTo": "x@y.co"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "messageId": "msg-123"}
    assert fake.sent[0]["to"] == "a@b.co" and fake.sent[0]["reply_to"] == "x@y.co"


def test_send_rejects_bad_address():
    c, fake = client()
    r = c.post("/send", json={"to": "nope", "subject": "Hi", "body": "there"})
    assert r.status_code == 400
    assert fake.sent == []


def test_send_requires_subject_and_body():
    c, _ = client()
    assert c.post("/send", json={"to": "a@b.co", "subject": "", "body": "x"}).status_code == 400


def test_subscribe_and_unsubscribe():
    c, fake = client()
    assert c.post("/subscribe", json={"email": "a@b.co"}).status_code == 200
    assert c.post("/unsubscribe", json={"email": "a@b.co"}).status_code == 200
    assert fake.subscribed == ["a@b.co"] and fake.unsubscribed == ["a@b.co"]
    assert c.post("/subscribe", json={"email": "bad"}).status_code == 400
