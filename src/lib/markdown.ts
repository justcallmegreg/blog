import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeShiki from '@shikijs/rehype';
import rehypeStringify from 'rehype-stringify';
import { visit, EXIT } from 'unist-util-visit';
import type { Root, Element } from 'hast';

const RELATIVE = /^(?:\.\/)?assets\//;
const EXTERNAL = /^https?:\/\//i;

/**
 * Open external links (absolute http/https URLs) in a new tab so readers don't
 * navigate away from the blog. Relative/root-relative links, anchors, and
 * mailto:/tel: stay in the same tab. `noopener noreferrer` closes the
 * reverse-tabnabbing hole and avoids leaking the referrer.
 */
function externalLinksNewTab() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href === 'string' && EXTERNAL.test(href)) {
        node.properties!.target = '_blank';
        node.properties!.rel = 'noopener noreferrer';
      }
    });
  };
}

function rewriteAssets(urlPrefix: string) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const attr =
        node.tagName === 'img'
          ? 'src'
          : node.tagName === 'a'
            ? 'href'
            : null;
      if (!attr) return;
      const value = node.properties?.[attr];
      if (typeof value === 'string' && RELATIVE.test(value)) {
        node.properties![attr] = `${urlPrefix}/${value.replace(/^\.\//, '')}`;
      }
    });
  };
}

/** Recursively gather the text content of a hast node. */
function hastText(node: any): string {
  if (node?.type === 'text') return node.value ?? '';
  if (Array.isArray(node?.children)) return node.children.map(hastText).join('');
  return '';
}

/**
 * Rewrite ```mermaid fences to `<pre class="mermaid">…source…</pre>` so the
 * client-side Mermaid runtime can render them, and so they bypass the Shiki
 * highlighter. With JavaScript off the raw diagram source stays visible as
 * preformatted text. Runs BEFORE rehypeShiki.
 */
function mermaidBlocks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;
      const code = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code'
      );
      const cls = code?.properties?.className;
      const isMermaid = Array.isArray(cls) && cls.includes('language-mermaid');
      if (!code || !isMermaid) return;
      node.properties = { className: ['mermaid'] };
      node.children = [{ type: 'text', value: hastText(code) }];
    });
  };
}

/** Recursively gather the visible text of an mdast node. */
function nodeText(node: any): string {
  if (typeof node?.value === 'string') return node.value;
  if (Array.isArray(node?.children)) return node.children.map(nodeText).join('');
  return '';
}

/**
 * Plain-text teaser from the first prose paragraph of the markdown (leading
 * headings are skipped). Whitespace is collapsed and the result is capped at
 * `maxWords` words, appending an ellipsis when truncated. Returns '' if there
 * is no paragraph.
 */
export function extractExcerpt(content: string, maxWords = 255): string {
  const tree = unified().use(remarkParse).parse(content);
  let para = '';
  visit(tree, 'paragraph', (node) => {
    para = nodeText(node).replace(/\s+/g, ' ').trim();
    return EXIT;
  });
  if (!para) return '';
  const words = para.split(' ');
  if (words.length <= maxWords) return para;
  return words.slice(0, maxWords).join(' ') + '…';
}

export async function renderMarkdown(
  content: string,
  urlPrefix: string
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(mermaidBlocks)
    // defaultLanguage: even fences without a language get Shiki's line-wrapped
    // structure (a <pre class="shiki"> with .line spans), so CSS line numbers
    // and the copy button apply uniformly to every code block.
    .use(rehypeShiki, { theme: 'github-dark', defaultLanguage: 'text' })
    .use(rewriteAssets, urlPrefix)
    .use(externalLinksNewTab)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content);
  return String(file);
}
