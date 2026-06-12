import { describe, it, expect, afterEach } from 'vitest';
import { __resetStoreForTests, getStore } from '../../src/lib/store-singleton';

afterEach(() => __resetStoreForTests());

describe('store-singleton', () => {
  it('returns the same store instance on repeated calls', () => {
    const a = getStore({
      repo: 'r',
      branch: 'main',
      subdir: '',
      cacheDir: '/tmp/x',
    });
    const b = getStore({
      repo: 'r',
      branch: 'main',
      subdir: '',
      cacheDir: '/tmp/x',
    });
    expect(a).toBe(b);
  });
});
