# New Transmission Modal + Direct R2 Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overseer's inline New-Transmission form with a Fallout-styled modal that uploads the video directly from the browser to R2 (presigned PUT), grabs the poster + duration client-side, and commits the git entry — with the player now streaming progressive mp4.

**Architecture:** A new presign endpoint mints short-lived R2 PUT URLs; the modal's client JS reads duration + grabs a poster frame, PUTs the file straight to R2 via XHR (real progress/speed/ETA), then submits metadata + poster to the existing create handler (`video` now points at the uploaded mp4). The Plane A player branches on the file extension — `.m3u8` keeps hls.js, otherwise native `<video src>` with range requests.

**Tech Stack:** Astro SSR, TypeScript, vitest, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (new), XHR upload, `<canvas>` frame grab.

## Global Constraints

- Video uploads **browser → R2 direct** (presigned PUT); the pod never streams bytes. Accepted types: `video/mp4`, `video/webm`.
- R2 object key: `transmissions/{slug}/video.{ext}`; the entry's frontmatter `video` is the relative `{slug}/video.{ext}`.
- Slug is derived from the Title via `slugify` (`^[a-z0-9][a-z0-9-]*$`); no visible slug field.
- Poster is auto-grabbed from the video client-side (`<canvas>` → JPEG) and committed to git; duration is read client-side (`mm:ss`).
- The overseer's R2 creds need **write** (`PutObject`); the public engine gets none. The bucket needs a **CORS** rule allowing `PUT` from the overseer origin (operator-set; documented).
- UI reference: `mockups/transmissions-new-modal.html` (committed). Auth unchanged (network-privacy-only). Pre-existing `tsc --noEmit` errors are not this feature's concern; gates are `npm test` + `npm run build`.

---

### Task 1: R2 `presignPut` + presign endpoint

**Files:**
- Modify: `src/lib/overseer/r2.ts`
- Create: `src/pages/overseer/transmissions/api/presign.ts`
- Modify: `package.json` (add `@aws-sdk/s3-request-presigner`)
- Test: `test/lib/overseer/r2.test.ts` (add), `test/lib/overseer/presign-endpoint.test.ts` (new)

**Interfaces:**
- Consumes: `R2Config`, `makeS3` (r2.ts); `SLUG_RE` (`../../../../lib/overseer/transmissions`).
- Produces:
  - `type PresignFn = (key: string, contentType: string, expiresIn: number) => Promise<string>`
  - `makePresigner(cfg: R2Config): PresignFn`
  - `presignPut(cfg: R2Config, key: string, contentType: string, expiresIn?: number, presign?: PresignFn): Promise<string>`
  - `interface PresignInput { slug?: string; contentType?: string }`
  - `type PresignResult = { status: number; body: { ok: boolean; url?: string; videoRef?: string; error?: string } }`
  - `handlePresign(input: PresignInput, deps: { presign: PresignFn }): Promise<PresignResult>`

- [ ] **Step 1: Add the dependency**

Run: `npm install @aws-sdk/s3-request-presigner`
Expected: `package.json` gains `@aws-sdk/s3-request-presigner`; lockfile updates.

- [ ] **Step 2: Write the failing test for `presignPut`**

Append to `test/lib/overseer/r2.test.ts`:

```ts
import { presignPut } from '../../../src/lib/overseer/r2';

describe('presignPut', () => {
  it('delegates to the injected presigner with the key + content type', async () => {
    const calls: any[] = [];
    const fake = async (key: string, ct: string, exp: number) => { calls.push([key, ct, exp]); return 'https://signed/' + key; };
    const url = await presignPut(CFG, 'transmissions/x/video.mp4', 'video/mp4', 900, fake);
    expect(url).toBe('https://signed/transmissions/x/video.mp4');
    expect(calls[0]).toEqual(['transmissions/x/video.mp4', 'video/mp4', 900]);
  });
});
```

(`CFG` already exists at the top of this test file from the deletePrefix tests.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/r2.test.ts -t presignPut`
Expected: FAIL — `presignPut` not exported.

- [ ] **Step 4: Implement `presignPut` in `src/lib/overseer/r2.ts`**

Add imports at the top:

```ts
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
```

Append to the file:

```ts
export type PresignFn = (key: string, contentType: string, expiresIn: number) => Promise<string>;

/** A presigner bound to `cfg`'s R2 client — signs PutObject URLs. */
export function makePresigner(cfg: R2Config): PresignFn {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return (key, contentType, expiresIn) =>
    getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }), { expiresIn });
}

/** Presigned PUT URL for `key`. Injectable `presign` for tests. */
export async function presignPut(
  cfg: R2Config,
  key: string,
  contentType: string,
  expiresIn = 900,
  presign: PresignFn = makePresigner(cfg)
): Promise<string> {
  return presign(key, contentType, expiresIn);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/r2.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing endpoint test**

Create `test/lib/overseer/presign-endpoint.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handlePresign } from '../../../src/pages/overseer/transmissions/api/presign';

describe('handlePresign', () => {
  const presign = vi.fn().mockResolvedValue('https://signed/put');

  it('400 on an invalid slug, no presign', async () => {
    const r = await handlePresign({ slug: 'Bad Slug', contentType: 'video/mp4' }, { presign });
    expect(r.status).toBe(400);
    expect(presign).not.toHaveBeenCalled();
  });
  it('400 on a non-video content type', async () => {
    expect((await handlePresign({ slug: 'ok', contentType: 'image/png' }, { presign })).status).toBe(400);
  });
  it('signs transmissions/{slug}/video.mp4 and returns the relative videoRef', async () => {
    const r = await handlePresign({ slug: 'first-tx', contentType: 'video/mp4' }, { presign });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://signed/put');
    expect(r.body.videoRef).toBe('first-tx/video.mp4');
    expect(presign).toHaveBeenCalledWith('transmissions/first-tx/video.mp4', 'video/mp4', 900);
  });
  it('maps webm to a .webm key', async () => {
    const r = await handlePresign({ slug: 's', contentType: 'video/webm' }, { presign });
    expect(r.body.videoRef).toBe('s/video.webm');
  });
  it('502 when signing throws', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    expect((await handlePresign({ slug: 's', contentType: 'video/mp4' }, { presign: bad })).status).toBe(502);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/presign-endpoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `src/pages/overseer/transmissions/api/presign.ts`**

```ts
import type { APIRoute } from 'astro';
import { SLUG_RE } from '../../../../lib/overseer/transmissions';
import { presignPut, r2ConfigFromEnv, type PresignFn } from '../../../../lib/overseer/r2';

export interface PresignInput {
  slug?: string;
  contentType?: string;
}
export type PresignResult = {
  status: number;
  body: { ok: boolean; url?: string; videoRef?: string; error?: string };
};

const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

export async function handlePresign(
  input: PresignInput,
  deps: { presign: PresignFn }
): Promise<PresignResult> {
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  const ext = EXT[input.contentType ?? ''];
  if (!ext) return { status: 400, body: { ok: false, error: 'video must be mp4 or webm' } };
  const key = `transmissions/${slug}/video.${ext}`;
  try {
    const url = await deps.presign(key, input.contentType!, 900);
    return { status: 200, body: { ok: true, url, videoRef: `${slug}/video.${ext}` } };
  } catch (err) {
    console.error('[overseer] presign failed:', err);
    return { status: 502, body: { ok: false, error: 'presign failed' } };
  }
}

export const POST: APIRoute = async ({ request }) => {
  let input: PresignInput;
  try {
    input = (await request.json()) as PresignInput;
  } catch {
    input = {};
  }
  const r2 = r2ConfigFromEnv();
  const result = await handlePresign(input, { presign: (k, ct, e) => presignPut(r2, k, ct, e) });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run test/lib/overseer/r2.test.ts test/lib/overseer/presign-endpoint.test.ts`
Expected: PASS (all).

- [ ] **Step 10: Commit**

```bash
git add src/lib/overseer/r2.ts src/pages/overseer/transmissions/api/presign.ts package.json package-lock.json test/lib/overseer/r2.test.ts test/lib/overseer/presign-endpoint.test.ts
git commit -m "feat(overseer): presigned R2 PUT + presign endpoint for direct video upload"
```

---

### Task 2: Pure upload-format helpers

**Files:**
- Create: `src/lib/overseer/upload-format.ts`
- Test: `test/lib/overseer/upload-format.test.ts` (new)

**Interfaces:**
- Produces:
  - `slugify(s: string): string`
  - `formatDuration(seconds: number): string` — `mm:ss`
  - `formatBytes(b: number): string`
  - `uploadStats(loaded: number, total: number, prevLoaded: number, dtSeconds: number): { speed: number; etaSeconds: number }`

- [ ] **Step 1: Write the failing test**

Create `test/lib/overseer/upload-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, formatDuration, formatBytes, uploadStats } from '../../../src/lib/overseer/upload-format';

describe('slugify', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugify('  My First Vlog! ')).toBe('my-first-vlog');
    expect(slugify('a__b--c')).toBe('a-b-c');
    expect(slugify('!!!')).toBe('');
  });
});
describe('formatDuration', () => {
  it('formats seconds as mm:ss and floors', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(72.9)).toBe('1:12');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
describe('formatBytes', () => {
  it('uses KB under 1MB and MB above', () => {
    expect(formatBytes(500)).toBe('1 KB'); // rounds
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });
});
describe('uploadStats', () => {
  it('computes speed (B/s) and ETA (s) from a delta', () => {
    const { speed, etaSeconds } = uploadStats(3_000_000, 9_000_000, 1_000_000, 1);
    expect(speed).toBe(2_000_000);
    expect(etaSeconds).toBe(3); // (9M-3M)/2M
  });
  it('returns Infinity ETA when speed is zero', () => {
    expect(uploadStats(0, 10, 0, 0).etaSeconds).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/upload-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/overseer/upload-format.ts`**

```ts
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function formatBytes(b: number): string {
  return b < 1e6 ? (b / 1e3).toFixed(0) + ' KB' : (b / 1e6).toFixed(1) + ' MB';
}

/** Instantaneous speed (bytes/s) and ETA (s) from a progress delta. */
export function uploadStats(
  loaded: number,
  total: number,
  prevLoaded: number,
  dtSeconds: number
): { speed: number; etaSeconds: number } {
  const speed = dtSeconds > 0 ? (loaded - prevLoaded) / dtSeconds : 0;
  const etaSeconds = speed > 0 ? (total - loaded) / speed : Infinity;
  return { speed, etaSeconds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/upload-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overseer/upload-format.ts test/lib/overseer/upload-format.test.ts
git commit -m "feat(overseer): pure upload-format helpers (slugify, duration, bytes, stats)"
```

---

### Task 3: Player plays progressive mp4

**Files:**
- Modify: `src/pages/transmissions/[slug].astro` (the client `<script>`)

**Interfaces:**
- Consumes: the existing `data-src` on `#tx-video` (now may be an `.mp4`/`.webm` URL).

- [ ] **Step 1: Replace the player client script**

In `src/pages/transmissions/[slug].astro`, replace the entire `<script> … </script>` block at the bottom with:

```astro
<script>
  const video = document.getElementById('tx-video') as HTMLVideoElement | null;
  const src = video?.dataset.src;
  if (video && src) {
    const isHls = src.endsWith('.m3u8');
    if (!isHls) {
      // Progressive mp4/webm — native playback with HTTP range requests.
      video.src = src;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src; // Safari/iOS native HLS
    } else {
      // Lazy-load hls.js only for HLS sources.
      const { default: Hls } = await import('hls.js');
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          video.outerHTML = `<div class="tx-signal-lost" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0e150e;color:var(--fg);font-family:inherit;">▚ SIGNAL LOST — transmission unavailable</div>`;
        });
      } else {
        video.controls = false;
        if (video.poster) video.outerHTML = `<img class="tx-poster" src="${video.poster}" alt="" />`;
      }
    }
  }
</script>
```

(The top-level `await import('hls.js')` is valid in an Astro client module; hls.js now only loads for `.m3u8` entries.)

- [ ] **Step 2: Build to verify types + bundling**

Run: `npm run build`
Expected: build succeeds; no TypeScript errors.

- [ ] **Step 3: Live-verify mp4 playback**

```bash
SCRATCH="$(mktemp -d)"
mkdir -p "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets"
printf -- '---\ntitle: "Demo"\nvideo: "demo/video.mp4"\nduration: "0:10"\n---\n' > "$SCRATCH/transmissions/justcallmegreg-blog/demo/index.md"
cp public/profile_picture.png "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets/poster.jpg"
CONTENT_LOCAL_DIR="$SCRATCH" npm run dev  # run in background; poll the log for the port
```

Verify `curl -s localhost:PORT/transmissions/demo` shows `<video id="tx-video"` with `data-src` ending `/transmissions/demo/video.mp4`, and the built client chunk sets `video.src` directly for a non-`.m3u8` source (no hls.js on the mp4 path). Stop the dev server and remove `$SCRATCH`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/transmissions/[slug].astro
git commit -m "feat(transmissions): player streams progressive mp4 (hls.js only for .m3u8)"
```

---

### Task 4: The New Transmission modal

**Files:**
- Modify: `src/pages/overseer/transmissions/index.astro` (replace the inline form with the modal + client script)

**Interfaces:**
- Consumes: `slugify`, `formatDuration`, `formatBytes`, `uploadStats` (Task 2, imported into the client script); the presign endpoint (Task 1) at `/overseer/transmissions/api/presign`; the existing create route `/overseer/transmissions/api/create`.

**Reference:** the committed mockup `mockups/transmissions-new-modal.html` is the exact UI (markup, CSS, block-cursor, tooltips-on-top, calendar, Fallout file picker, 355 counter, vertical toggle + CRT sound, progress bar). Port its markup + `<style>` into the modal, then wire the **real** upload/submit (the mockup only simulates).

- [ ] **Step 1: Replace the list page's "New" section with the modal**

In `src/pages/overseer/transmissions/index.astro`, keep the management table/pane, and replace the `// NEW TRANSMISSION` `<section>` (the inline `<form id="tx-new">` … through its `<script>`) with:
1. A wide glowing **New Transmission** button (`id="tx-open"`) at the top of the pane.
2. The modal overlay markup **ported verbatim from `mockups/transmissions-new-modal.html`** — the `.overlay`/`.modal` block containing the Title (block-cursor), Date (`type="date"`), Description (+ counter), Video (Fallout file picker + `.preview` canvas + `.prog` bar), Hidden (vertical toggle), and the `Upload Transmission` button (`id="create"`). Copy the mockup's `<style>` rules for these into the page's `<style>`.
3. Remove the mockup's demo-only bits: the `#demobtn` "Simulate upload" button and its handler.

- [ ] **Step 2: Wire the real client script**

Use the mockup's client JS as the base (tooltips fixed-positioning, block-cursor mirror, slugify-from-title, description counter, Hidden toggle + `crtClick`, `refresh()` gating, poster-grab + duration on file select), with these concrete real-upload changes. Import the helpers at the top of the module:

```ts
import { slugify, formatDuration, formatBytes, uploadStats } from '../../../lib/overseer/upload-format';
```

(remove the mockup's inline `const slugify = …`.) Keep a module-scoped `let posterBlob = null, durationStr = '', videoRef = '', uploaded = false, uploadedSlug = null;`.

**On file select** (replace the mockup's `simulateUpload(f.size)` call): read duration + grab the poster as a real Blob, then start the real upload:

```ts
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $('filename').textContent = f.name + ' · ' + formatBytes(f.size);
  const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = URL.createObjectURL(f);
  await new Promise((res) => { v.addEventListener('loadedmetadata', res, { once: true }); v.addEventListener('error', res, { once: true }); });
  const d = v.duration || 0; durationStr = formatDuration(d); $('dur').textContent = 'duration ' + durationStr + ' (auto)';
  v.currentTime = Math.min(1, d / 2);
  await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
  const c = $('poster'); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.style.display = 'block';
  posterBlob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  startUpload(f);
});
```

**The real upload** (presign → XHR PUT to R2, driving the progress bar):

```ts
function showErr(msg) { const p = $('prog'); p.style.display = 'block'; $('speed').textContent = 'error'; $('eta').textContent = msg; }

async function startUpload(file) {
  uploaded = false; refresh();
  const slug = slugify($('title').value);
  let pres;
  try {
    const r = await fetch('/overseer/transmissions/api/presign', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, contentType: file.type }),
    });
    pres = await r.json();
    if (!r.ok || !pres.ok) throw new Error(pres.error || ('presign ' + r.status));
  } catch (err) { showErr('presign failed: ' + err.message); return; }
  videoRef = pres.videoRef;

  const prog = $('prog'); prog.style.display = 'block'; prog.classList.remove('done');
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', pres.url, true);
  xhr.setRequestHeader('content-type', file.type);
  let last = performance.now(), lastLoaded = 0;
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const now = performance.now(); const dt = (now - last) / 1000;
    const { speed, etaSeconds } = uploadStats(e.loaded, e.total, lastLoaded, dt);
    last = now; lastLoaded = e.loaded;
    const pctv = e.loaded / e.total;
    $('fill').style.width = (pctv * 100).toFixed(1) + '%';
    $('pct').textContent = (pctv * 100).toFixed(0) + '%';
    $('bytes').textContent = formatBytes(e.loaded) + ' / ' + formatBytes(e.total);
    $('speed').textContent = (speed / 1e6).toFixed(1) + ' MB/s';
    $('eta').textContent = 'ETA ' + (isFinite(etaSeconds) ? formatDuration(etaSeconds) : '—');
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      prog.classList.add('done'); $('speed').textContent = 'done'; $('eta').textContent = 'ETA 0:00';
      uploaded = true; uploadedSlug = slug; $('filename').textContent += '  ✓ uploaded'; refresh();
    } else showErr('upload failed (' + xhr.status + ')');
  };
  xhr.onerror = () => showErr('upload error — check R2 CORS');
  xhr.send(file);
}
```

**Reset-on-title-change** (keep the mockup's rule): the `$('title')` input handler resets the upload when `slugify(title)` changes after an upload (`if (uploaded && slugify($('title').value) !== uploadedSlug) resetUpload();`). `resetUpload()` also clears `posterBlob`, `videoRef`, `durationStr`.

**Submit** (the `Upload Transmission` button posts to the create route):

```ts
$('create').onclick = async () => {
  if ($('create').hasAttribute('disabled')) return; crtClick();
  const slug = slugify($('title').value);
  const fd = new FormData();
  fd.set('slug', slug);
  fd.set('title', $('title').value);
  fd.set('date', $('date').value);
  fd.set('description', $('desc').value);
  fd.set('draft', hidden ? 'on' : '');
  fd.set('video', videoRef);
  fd.set('duration', durationStr);
  if (posterBlob) fd.set('poster', posterBlob, 'poster.jpg');
  const r = await fetch('/overseer/transmissions/api/create', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (r.ok) location.href = '/overseer/transmissions';
  else showErr('create failed: ' + (j.error || r.status));
};
```

`refresh()` gating (from the mockup, title-derived slug): CREATE enabled only when `$('title').value.trim()` yields a valid slug, `$('date').value` is set, and `uploaded` is true.

- [ ] **Step 3: Build to verify types + bundling**

Run: `npm run build`
Expected: build succeeds; the modal script + `upload-format` import bundle cleanly.

- [ ] **Step 4: Live-verify the modal in the overseer**

```bash
SCRATCH="$(mktemp -d)"; mkdir -p "$SCRATCH/transmissions/justcallmegreg-blog"
OVERSEER_ENABLED=true CONTENT_LOCAL_DIR="$SCRATCH" npm run dev  # background; poll for the port
```

Open `localhost:PORT/overseer/transmissions` and confirm (no real R2 needed for the UI checks): the glowing **New Transmission** button opens the modal; Title drives the derived slug and the block cursor tracks typing; Date defaults to today; the Description counter caps at 355; the Hidden vertical toggle flips red↔green with a click sound; tooltips appear on top; the file picker enables once a Title is entered; **Upload Transmission** stays disabled until Title + Date + a completed upload. (A real presigned PUT needs R2 write creds + CORS — that's Task 5's operator config; without them the upload step will error, which is expected in local dev.) Stop the dev server; remove `$SCRATCH`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/overseer/transmissions/index.astro
git commit -m "feat(overseer): Fallout New Transmission modal with direct R2 upload"
```

---

### Task 5: Docs — R2 write creds + bucket CORS + full suite

**Files:**
- Modify: `README.md` (the Overseer section)
- Modify: `helm/blog-engine/values.yaml` (the overseer secrets comment)

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Document R2 write + CORS in the README**

In `README.md`'s Overseer setup, update the `R2_*` note to state the credentials now need **write** (`PutObject`) — not just delete — because the modal uploads the video directly to R2. Add a short **bucket CORS** subsection: the R2 bucket must allow `PUT` from the overseer's origin, e.g.

```json
[{ "AllowedOrigins": ["https://overseer.<your-domain>"],
   "AllowedMethods": ["PUT"],
   "AllowedHeaders": ["content-type"],
   "MaxAgeSeconds": 3600 }]
```

Note that without this CORS rule the browser upload is blocked, and that `transmissions.mediaBaseUrl` (public engine) must serve the R2 objects for playback.

- [ ] **Step 2: Update the values.yaml comment**

In `helm/blog-engine/values.yaml`, adjust the overseer secrets comment: the `R2_*` creds need `PutObject` (upload) **and** delete; the bucket needs the CORS rule above.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — all files, including the new `presign-endpoint`, `upload-format`, and extended `r2` tests.

- [ ] **Step 4: Commit**

```bash
git add README.md helm/blog-engine/values.yaml
git commit -m "docs(overseer): R2 write scope + bucket CORS for direct video upload"
```
