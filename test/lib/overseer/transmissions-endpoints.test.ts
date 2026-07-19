import { describe, it, expect, vi } from 'vitest';
import { handleCreate, handleUpdate, handleDelete } from '../../../src/pages/overseer/transmissions/api/create';

function poster() { return new TextEncoder().encode('JPEGBYTES'); }

describe('handleCreate', () => {
  it('400 on invalid input, without committing', async () => {
    const commit = vi.fn(); const sync = vi.fn();
    const res = await handleCreate({ slug: 'Bad Slug', title: 'T', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync });
    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits index.md + poster and syncs on success', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleCreate(
      { slug: 'first-tx', title: 'First', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg', duration: '05:52' },
      { commit, sync }
    );
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('first-tx');
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toEqual([
      'transmissions/justcallmegreg-blog/first-tx/index.md',
      'transmissions/justcallmegreg-blog/first-tx/assets/poster.jpg',
    ]);
    expect(new TextDecoder().decode(arg.put[0].bytes)).toContain('video: "first-tx/master.m3u8"');
    expect(sync).toHaveBeenCalled();
  });

  it('502 when the commit throws', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('gh down'));
    const res = await handleCreate({ slug: 'x', title: 'X', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync: vi.fn() });
    expect(res.status).toBe(502);
  });
});

describe('handleUpdate', () => {
  it('rewrites index.md (no poster) and syncs', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleUpdate({ slug: 'first-tx', title: 'New Title', draft: true }, { commit, sync });
    expect(res.status).toBe(200);
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toEqual(['transmissions/justcallmegreg-blog/first-tx/index.md']);
    expect(new TextDecoder().decode(arg.put[0].bytes)).toContain('draft: true');
    expect(sync).toHaveBeenCalled();
  });
  it('includes the poster in the commit when a new one is provided', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const res = await handleUpdate({ slug: 'first-tx', title: 'T', posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync: vi.fn() });
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toContain('transmissions/justcallmegreg-blog/first-tx/assets/poster.jpg');
  });
});

describe('handleDelete', () => {
  it('400 without APPROVE, no commit', async () => {
    const commit = vi.fn(); const deleteMedia = vi.fn(); const sync = vi.fn();
    expect((await handleDelete({ slug: 'x', confirm: 'nope' }, { commit, deleteMedia, sync })).status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });
  it('commits removal BEFORE deleting media, then syncs', async () => {
    const order: string[] = [];
    const commit = vi.fn().mockImplementation(async () => { order.push('commit'); return { commitSha: 'C' }; });
    const deleteMedia = vi.fn().mockImplementation(async () => { order.push('media'); return { deleted: 3 }; });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync });
    expect(res.status).toBe(200);
    expect(order).toEqual(['commit', 'media']);
    expect(commit.mock.calls[0][0].remove).toEqual([
      'transmissions/justcallmegreg-blog/gone/index.md',
      'transmissions/justcallmegreg-blog/gone/assets/poster.jpg',
    ]);
    expect(deleteMedia).toHaveBeenCalledWith('transmissions/gone/');
  });
  it('502 and no media delete when the git removal fails', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('gh down'));
    const deleteMedia = vi.fn();
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync: vi.fn() });
    expect(res.status).toBe(502);
    expect(deleteMedia).not.toHaveBeenCalled();
  });
  it('still returns 200 (git succeeded) when media cleanup fails, with a warning', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const deleteMedia = vi.fn().mockRejectedValue(new Error('r2 down'));
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync: vi.fn() });
    expect(res.status).toBe(200);
    expect(res.body.error).toMatch(/media/i);
  });
});
