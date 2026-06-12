import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeShiki from '@shikijs/rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
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
