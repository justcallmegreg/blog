import { describe, it, expect } from 'vitest';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { deletePrefix, type S3Like } from '../../../src/lib/overseer/r2';

const CFG = { endpoint: 'https://r2', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };

describe('deletePrefix', () => {
  it('lists then deletes all keys under the prefix, following pagination', async () => {
    const deleted: string[] = [];
    let listCall = 0;
    const s3: S3Like = {
      async send(cmd: any) {
        if (cmd instanceof ListObjectsV2Command) {
          listCall++;
          return listCall === 1
            ? { Contents: [{ Key: 'transmissions/x/a.ts' }, { Key: 'transmissions/x/master.m3u8' }], IsTruncated: true, NextContinuationToken: 'C' }
            : { Contents: [{ Key: 'transmissions/x/b.ts' }], IsTruncated: false };
        }
        if (cmd instanceof DeleteObjectsCommand) {
          for (const o of cmd.input.Delete!.Objects!) deleted.push(o.Key!);
          return {};
        }
        throw new Error('unexpected command');
      },
    };
    const res = await deletePrefix(CFG, 'transmissions/x/', s3);
    expect(res.deleted).toBe(3);
    expect(deleted.sort()).toEqual(['transmissions/x/a.ts', 'transmissions/x/b.ts', 'transmissions/x/master.m3u8']);
  });

  it('is a no-op when the prefix is empty', async () => {
    let deletes = 0;
    const s3: S3Like = {
      async send(cmd: any) {
        if (cmd instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: false };
        deletes++;
        return {};
      },
    };
    const res = await deletePrefix(CFG, 'transmissions/none/', s3);
    expect(res.deleted).toBe(0);
    expect(deletes).toBe(0);
  });
});
