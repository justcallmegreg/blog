import type { APIRoute } from 'astro';
import {
  validateCreateInput,
  composeTransmissionMarkdown,
  transmissionEntryPaths,
  deletePlan,
  SLUG_RE,
  type CreateInput,
  type TransmissionFields,
} from '../../../../lib/overseer/transmissions';
import { commitFiles, githubConfig } from '../../../../lib/overseer/github';
import { deletePrefix, r2ConfigFromEnv } from '../../../../lib/overseer/r2';
import { ensureStarted } from '../../../../lib/store-singleton';

export interface HandlerResult {
  status: number;
  body: { ok: boolean; error?: string; slug?: string };
}
export interface WriteDeps {
  commit(i: { message: string; put?: { path: string; bytes: Uint8Array }[]; remove?: string[] }): Promise<{ commitSha: string }>;
  sync(): Promise<void>;
}
export interface DeleteDeps extends WriteDeps {
  deleteMedia(prefix: string): Promise<{ deleted: number }>;
}
export interface UpdateInput {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  duration?: string;
  video?: string;
  draft?: boolean;
  posterType?: string;
  posterBytes?: Uint8Array;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function handleCreate(
  input: CreateInput & { posterBytes?: Uint8Array },
  deps: WriteDeps
): Promise<HandlerResult> {
  const v = validateCreateInput({ ...input, hasPoster: Boolean(input.posterBytes) });
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const paths = transmissionEntryPaths(v.slug);
  const md = composeTransmissionMarkdown(v.fields);
  try {
    await deps.commit({
      message: `transmission: add ${v.slug}`,
      put: [
        { path: paths.indexMd, bytes: enc(md) },
        { path: paths.posterAsset, bytes: input.posterBytes! },
      ],
    });
  } catch {
    return { status: 502, body: { ok: false, error: 'commit failed' } };
  }
  await Promise.resolve(deps.sync()).catch(() => {});
  return { status: 200, body: { ok: true, slug: v.slug } };
}

export async function handleUpdate(input: UpdateInput, deps: WriteDeps): Promise<HandlerResult> {
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  if (input.posterType && !/^image\/(png|jpeg|webp|gif)$/.test(input.posterType)) {
    return { status: 400, body: { ok: false, error: 'poster must be png/jpeg/webp/gif' } };
  }
  const title = (input.title ?? '').trim();
  if (!title) return { status: 400, body: { ok: false, error: 'title is required' } };
  const fields: TransmissionFields = {
    title,
    description: input.description?.trim() || undefined,
    date: input.date?.trim() || undefined,
    duration: input.duration?.trim() || undefined,
    video: (input.video ?? '').trim() || `${slug}/master.m3u8`,
    draft: Boolean(input.draft),
  };
  const paths = transmissionEntryPaths(slug);
  const put: { path: string; bytes: Uint8Array }[] = [
    { path: paths.indexMd, bytes: enc(composeTransmissionMarkdown(fields)) },
  ];
  if (input.posterBytes) put.push({ path: paths.posterAsset, bytes: input.posterBytes });
  try {
    await deps.commit({ message: `transmission: update ${slug}`, put });
  } catch {
    return { status: 502, body: { ok: false, error: 'commit failed' } };
  }
  await Promise.resolve(deps.sync()).catch(() => {});
  return { status: 200, body: { ok: true, slug } };
}

export async function handleDelete(
  input: { slug?: string; confirm?: string },
  deps: DeleteDeps
): Promise<HandlerResult> {
  if (input.confirm !== 'APPROVE') return { status: 400, body: { ok: false, error: 'confirmation required' } };
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  const plan = deletePlan(slug);
  try {
    await deps.commit({ message: `transmission: remove ${slug}`, remove: plan.gitPaths });
  } catch {
    return { status: 502, body: { ok: false, error: 'git delete failed' } };
  }
  let warning: string | undefined;
  try {
    await deps.deleteMedia(plan.r2Prefix);
  } catch {
    warning = 'entry removed, but R2 media cleanup failed (orphaned objects)';
  }
  await Promise.resolve(deps.sync()).catch(() => {});
  return { status: 200, body: { ok: true, ...(warning ? { error: warning } : {}) } };
}

// ---- create route ----
async function fieldsFromForm(form: FormData) {
  const poster = form.get('poster');
  const posterFile = poster instanceof File && poster.size > 0 ? poster : null;
  const posterBytes = posterFile ? new Uint8Array(await posterFile.arrayBuffer()) : undefined;
  const str = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : undefined);
  return {
    slug: str('slug') ?? '',
    title: str('title') ?? '',
    description: str('description'),
    date: str('date'),
    duration: str('duration'),
    video: str('video'),
    draft: form.get('draft') === 'on' || form.get('draft') === 'true',
    posterType: posterFile?.type,
    posterBytes,
  };
}

function realDeps(): DeleteDeps {
  const gh = githubConfig();
  const r2 = r2ConfigFromEnv();
  return {
    commit: (i) => commitFiles(gh, i),
    deleteMedia: (prefix) => deletePrefix(r2, prefix),
    sync: async () => { const store = await ensureStarted(); await store.sync(); },
  };
}

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const f = await fieldsFromForm(form);
  const result = await handleCreate({ ...f, hasPoster: Boolean(f.posterBytes) }, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};

export { fieldsFromForm, realDeps };
