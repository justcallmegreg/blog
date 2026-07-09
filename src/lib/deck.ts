import matter from 'gray-matter';
import { z } from 'zod';

// The deck dialect: one Markdown file = frontmatter + slides separated by `---`
// (outside fenced code). See docs/superpowers/specs/2026-07-09-deck-dialect-and-presenter-design.md.

const DeckFrontmatterSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  theme: z.string().default('pipboy'),
  draft: z.boolean().default(false),
  publishAt: z.string().optional(),
});
export type DeckFrontmatter = z.infer<typeof DeckFrontmatterSchema>;

export const DECK_LAYOUTS = ['title', 'default', 'stat', 'two-col', 'standby'] as const;
export type DeckLayout = (typeof DECK_LAYOUTS)[number];

export interface ParsedSlide {
  layout: DeckLayout;
  /** Leading #/## heading of a two-col slide, rendered full-width above the columns. */
  head: string | null;
  /** Markdown sources: one entry normally; [left, right] for two-col. */
  parts: string[];
}
export interface ParsedDeck {
  meta: DeckFrontmatter;
  slides: ParsedSlide[];
}

export function parseDeckSource(raw: string): ParsedDeck {
  const parsed = matter(raw);
  const result = DeckFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid deck frontmatter: ${issues}`);
  }
  const meta = result.data;

  // Split slides on `---` lines outside fenced code blocks.
  const chunks: string[][] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of parsed.content.replace(/\r/g, '').split('\n')) {
    if (/^```/.test(line.trim())) fence = !fence;
    if (!fence && line.trim() === '---') {
      chunks.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  chunks.push(cur);

  const slides: ParsedSlide[] = chunks
    .map((c) => c.join('\n').trim())
    .filter(Boolean)
    .map((src, i) => {
      let layout: string | null = null;
      const m = /^<!--\s*slide:\s*([\w-]+)\s*-->\s*\n?/.exec(src);
      if (m) {
        layout = m[1];
        src = src.slice(m[0].length).trim();
      }
      if (layout && !(DECK_LAYOUTS as readonly string[]).includes(layout)) {
        console.warn(`[deck] unknown layout "${layout}" — using default`);
        layout = 'default';
      }
      if (!layout) layout = i === 0 ? 'title' : 'default';

      if (layout === 'two-col') {
        const cols = src.split(/^<!--\s*col\s*-->\s*$/m);
        let a = (cols[0] ?? '').trim();
        let head: string | null = null;
        const hm = /^(##?\s+.+)\n?/.exec(a);
        if (hm) {
          head = hm[1];
          a = a.slice(hm[0].length).trim();
        }
        return { layout: 'two-col' as DeckLayout, head, parts: [a, (cols[1] ?? '').trim()] };
      }
      return { layout: layout as DeckLayout, head: null, parts: [src] };
    });

  if (!meta.title) {
    const h = /^#\s+(.+)$/m.exec(slides[0]?.parts[0] ?? '');
    if (h) meta.title = h[1];
  }
  return { meta, slides };
}

export interface DeckSlideHtml {
  layout: DeckLayout;
  html: string;
}

/** Assemble each slide's HTML with the caller-supplied markdown renderer. */
export async function renderDeckSlides(
  deck: ParsedDeck,
  render: (md: string) => Promise<string>
): Promise<DeckSlideHtml[]> {
  const out: DeckSlideHtml[] = [];
  for (const s of deck.slides) {
    let html = s.head ? await render(s.head) : '';
    if (s.layout === 'two-col') {
      const [a, b] = await Promise.all([render(s.parts[0] ?? ''), render(s.parts[1] ?? '')]);
      html += `<div class="cols"><div class="col">${a}</div><div class="col">${b}</div></div>`;
    } else {
      html += await render(s.parts[0] ?? '');
    }
    out.push({ layout: s.layout, html });
  }
  return out;
}
