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
    .use(rehypeShiki, { theme: 'github-dark' })
    .use(rewriteAssets, urlPrefix)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content);
  return String(file);
}
