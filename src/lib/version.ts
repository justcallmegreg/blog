// The engine's version, read from VERSION.txt and embedded at build time (Vite
// `?raw`), so /version reflects the released version baked into the image without
// needing the file present at runtime. VERSION.txt is maintained by CI — see
// docs/ci-versioning.md.
import raw from '../../VERSION.txt?raw';

export const VERSION = raw.trim();
