import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ConfigSchema = z.object({
  site: z.object({
    title: z.string(),
    description: z.string().default(''),
    baseUrl: z.string().optional(),
  }),
  content: z
    .object({
      repo: z.string(),
      branch: z.string().default('main'),
      subdir: z.string().default(''),
      syncIntervalSeconds: z.number().int().positive().default(300),
    })
    .default({}),
  effects: z
    .object({
      matrixRain: z.boolean().default(true),
      matrixRainDurationSeconds: z.number().int().positive().default(7),
      typewriter: z.boolean().default(true),
      clickSound: z.boolean().default(true),
      crtGlitch: z.boolean().default(true),
      crtGlitchIntervalSeconds: z.number().int().positive().default(15),
      vaultBoy: z.boolean().default(true),
      vaultBoyLoops: z.number().int().nonnegative().default(3),
    })
    .default({}),
  github: z
    .object({
      username: z.string().default('justcallmegreg'),
    })
    .default({}),
  contact: z
    .object({
      enabled: z.boolean().default(true),
      captcha: z.boolean().default(true),
    })
    .default({}),
  // Social links in the top bar. Empty string hides that link. Handles only,
  // not full URLs.
  social: z
    .object({
      github: z.string().default('justcallmegreg'),
      linkedin: z.string().default('justcallmegreg'),
      medium: z.string().default(''),
    })
    .default({}),
  about: z
    .object({
      enabled: z.boolean().default(true),
      headline: z.string().default(''),
      bio: z.string().default(''),
      projects: z
        .array(
          z.object({
            start: z.number().int(),
            end: z.number().int(),
            description: z.string(),
            responsibilities: z.string().default(''),
            deliveries: z.string().default(''),
          })
        )
        .default([]),
    })
    .default({}),
  // GDPR: a privacy/erasure contact email + the first-visit consent gate.
  privacy: z
    .object({
      email: z.string().default(''),
      consentBanner: z.boolean().default(true),
    })
    .default({}),
});
// Note: the HTTP port/host are controlled by the PORT/HOST env vars (read by the
// @astrojs/node standalone server), not by this file — see the Dockerfile and
// docker-compose.yml. In a container you change the published port via the compose
// `ports:` mapping. There is intentionally no `server` block here.

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }
  const raw = parseYaml(readFileSync(path, 'utf8')) ?? {};
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid config (${path}): ${issues}`);
  }
  return result.data;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    cached = loadConfig(process.env.CONFIG_PATH ?? './config.yaml');
  }
  return cached;
}
