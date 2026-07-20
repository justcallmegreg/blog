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
