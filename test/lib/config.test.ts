import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/lib/config';

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, contents);
  return path;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads a full config and applies defaults', () => {
    const path = writeConfig(`
site:
  title: "RobCo Termlink"
content:
  repo: "https://github.com/you/content.git"
`);
    dirs.push(join(path, '..'));
    const cfg = loadConfig(path);
    expect(cfg.site.title).toBe('RobCo Termlink');
    expect(cfg.content.repo).toBe('https://github.com/you/content.git');
    expect(cfg.content.branch).toBe('main');
    expect(cfg.content.subdir).toBe('');
    expect(cfg.content.syncIntervalSeconds).toBe(300);
    expect(cfg.effects).toEqual({
      matrixRain: true,
      matrixRainDurationSeconds: 7,
      typewriter: true,
      clickSound: true,
      crtGlitch: true,
      crtGlitchIntervalSeconds: 15,
      vaultBoy: true,
      vaultBoyLoops: 3,
    });
    expect(cfg.github.username).toBe('justcallmegreg');
    expect(cfg.contact.enabled).toBe(true);
    expect(cfg.contact.captcha).toBe(true);
  });

  it('throws a clear error when required fields are missing', () => {
    const path = writeConfig(`site:\n  title: "x"\n`);
    dirs.push(join(path, '..'));
    expect(() => loadConfig(path)).toThrow(/content\.repo/);
  });

  it('throws when the file does not exist', () => {
    expect(() => loadConfig('/no/such/config.yaml')).toThrow(/config/i);
  });
});
