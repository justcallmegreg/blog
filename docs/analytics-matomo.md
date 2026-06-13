# Analytics (self-hosted Matomo)

The blog injects the Matomo tracking snippet **only after** a visitor accepts the
consent gate (the `gregco-consent` cookie). The engine stores nothing — the
browser talks directly to your Matomo instance.

## 1. Run Matomo

```bash
cp docker-compose.matomo.example.yml docker-compose.matomo.yml
# edit the passwords, then:
docker compose -f docker-compose.matomo.yml up -d
```

Open Matomo (e.g. `http://your-host:8080`, ideally behind TLS) and complete the
install wizard, pointing it at the `matomo-db` service with the credentials you set.

## 2. Privacy settings (do this)

In Matomo: **Administration → Privacy → Anonymize data**
- Anonymize visitor IP addresses (mask at least 2 bytes).
- Optionally enable "respect DoNotTrack".

## 3. Add the website → get the siteId

**Administration → Websites → Manage → Add a new website.** Enter the blog URL.
The number in the site list is your `siteId`.

## 4. Point the blog at Matomo

In `config.yaml`:

```yaml
analytics:
  enabled: true
  matomoUrl: "https://analytics.your-host.com"   # base URL, no trailing /matomo.php
  siteId: 1                                       # from step 3
```

Restart the blog. Accept the consent gate; within a minute Matomo's
**Visitors → Visits Log** should show the visit, and **Behaviour → Pages** the
time spent per page.
