import { describe, it, expect, vi } from 'vitest';
import { handleDelete } from '../../../src/pages/overseer/api/delete';

describe('handleDelete', () => {
  it('400 when confirm is not exactly APPROVE', async () => {
    const del = vi.fn();
    expect((await handleDelete({ email: 'a@x.co', confirm: 'approve' }, { deleteSubscriber: del })).status).toBe(400);
    expect((await handleDelete({ email: 'a@x.co' }, { deleteSubscriber: del })).status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('400 when email is missing', async () => {
    const del = vi.fn();
    expect((await handleDelete({ confirm: 'APPROVE' }, { deleteSubscriber: del })).status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes (trimmed) and returns 200 on APPROVE', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const res = await handleDelete({ email: ' a@x.co ', confirm: 'APPROVE' }, { deleteSubscriber: del });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(del).toHaveBeenCalledWith('a@x.co');
  });

  it('502 when the delete throws', async () => {
    const del = vi.fn().mockRejectedValue(new Error('ses down'));
    const res = await handleDelete({ email: 'a@x.co', confirm: 'APPROVE' }, { deleteSubscriber: del });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});
