export interface PostPathInfo {
  slug: string;
  url: string;
  urlPrefix: string;
  contentDir: string; // content-root-relative dir, e.g. "justcallmegreg-blog/my-post"
}

// {namespace}/{slug}/index.md  — namespace is the source "owner-repo".
const POST_PATH = /^([^/]+)\/([^/]+)\/index\.md$/;

export function parsePostPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, ns, slug] = match;
  return {
    slug,
    url: `/${slug}`,
    urlPrefix: `/${slug}`,
    contentDir: `${ns}/${slug}`,
  };
}
