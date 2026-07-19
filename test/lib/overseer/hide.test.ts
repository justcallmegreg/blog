import { describe, it, expect, vi } from 'vitest';
import { handleUpdate, hideUpdateFromEntry } from '../../../src/pages/overseer/transmissions/api/create';
import type { Transmission } from '../../../src/lib/content-store';

describe('hideUpdateFromEntry', () => {
  it('preserves every field and flips only draft', () => {
    const tx: any = {
      slug: 's',
      title: 'T',
      description: 'd',
      date: '2026-06-02',
      duration: '05:52',
      video: 'custom/x.m3u8',
      draft: false,
    };
    expect(hideUpdateFromEntry(tx, true)).toEqual({
      slug: 's',
      title: 'T',
      description: 'd',
      date: '2026-06-02',
      duration: '05:52',
      video: 'custom/x.m3u8',
      draft: true,
    });
  });

  it('composed through handleUpdate, the committed bytes retain every field (no data loss on hide/unhide)', async () => {
    const tx: Transmission = {
      url: '/transmissions/rich-entry',
      urlPrefix: '/transmissions/rich-entry',
      slug: 'rich-entry',
      contentDir: 'rich-entry',
      title: 'Rich Entry',
      date: '2026-06-02',
      description: 'a description that must survive a hide/unhide toggle',
      video: 'custom/x.m3u8',
      duration: '05:52',
      poster: 'rich-entry/assets/poster.jpg',
      draft: false,
      blobHash: 'irrelevant',
    };

    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const sync = vi.fn().mockResolvedValue(undefined);

    const res = await handleUpdate(hideUpdateFromEntry(tx, true), { commit, sync });

    expect(res.status).toBe(200);
    const arg = commit.mock.calls[0][0];
    const md = new TextDecoder().decode(arg.put[0].bytes);
    expect(md).toContain('date: "2026-06-02"');
    expect(md).toContain('duration: "05:52"');
    expect(md).toContain('description: "a description that must survive a hide/unhide toggle"');
    expect(md).toContain('video: "custom/x.m3u8"');
    expect(md).not.toContain('rich-entry/master.m3u8');
    expect(md).toContain('draft: true');
  });
});
