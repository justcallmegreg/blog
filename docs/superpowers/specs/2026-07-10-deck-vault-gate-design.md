# Deck vault gate — design

Date: 2026-07-10
Status: approved (brainstorming)

## Summary

When presenting a deck (the Pip-Boy presenter at `/decks/<slug>`), the first thing
shown is a **sealed vault gate** inside the CRT: the Fallout gear door with a
prominent **`[ OPEN ]`** control. Activating OPEN plays the vault-door open
animation and reveals the deck's first slide. It is a one-time entry gate — once
opened it does not return.

Decisions from brainstorming:
- **Presenter-native gate** (not a port of the full-page room scene) — the gear
  door + roll-away, rendered inside the CRT viewport in the Pip-Boy green palette.
- **Every deck** by default; opt out per deck via frontmatter.
- **One-time entry gate** (not a navigable slide 0).

## Reuse: shared `buildDoor`

The gear-door SVG is currently drawn by a `buildDoor(svg)` function inlined in
`src/components/VaultDoorIntro.astro`'s client script. Extract it verbatim into a
shared module **`src/lib/vault-door.ts`** (`export function buildDoor(svg, opts)`,
where `opts` carries the vault number — today read from `dataset.vault`). Both the
blog intro and the presenter import it, so the two draw the identical door and it
can't drift.

In the presenter the (steel-grey) door SVG is rendered green to match the CRT via
a CSS duotone **filter** (the same technique as the Terminal avatar:
`grayscale(1) sepia(1) hue-rotate(...) saturate(...)`) — no SVG recolour needed,
`buildDoor` stays untouched.

## Component: the gate (in `Presenter.astro`)

A `.vault-gate` overlay absolutely covering `.viewport`, layered above the slides
and below the CRT scan/vignette overlays. Contents:
- the gear-door `<svg>` (filled by `buildDoor`),
- a `VAULT NN // SEALED` label,
- a prominent Pip-Boy-styled **`[ OPEN ]`** button.

The device chrome (tabs, knob, gauge, plate) stays visible around it — the device
is "showing" a sealed vault with an OPEN control.

## Behaviour (one-time entry gate)

1. On load the gate covers slide 1. The presenter's nav controls are **armed to
   open**: clicking `[ OPEN ]`, or pressing `►` / `Space` / `PageDown`, or the
   right hotzone / `NEXT` / the rotary **knob**, all trigger the open sequence
   (every "begin" affordance funnels to OPEN). `◄`/PREV do nothing while sealed.
2. **Open sequence:** a brief unseal spin of the gear → the door rolls away within
   the CRT → the gate fades → slide 1 (`idx 0`) is revealed → normal presenting
   begins. The gate element is then inert/removed and never shown again; `PREV`
   from slide 1 stays on slide 1.
3. **Reduced motion** (`prefers-reduced-motion: reduce`): OPEN hides the gate and
   shows slide 1 immediately, no animation.
4. While sealed, the counter shows a locked state (e.g. `-- / NN`) and the needle
   sits at 0; after opening they behave as today.

## Scope & data

- **Every deck** renders the gate unless opted out.
- **Frontmatter** (`src/lib/deck.ts`, `DeckFrontmatterSchema`):
  - `vaultIntro: z.boolean().default(true)` — set `false` to skip the gate (slide
    1 shows immediately, i.e. today's behaviour).
  - `vault: z.number().int().positive().optional()` — door number; defaults to
    `94` in the presenter when unset.
- **`Deck` type** (`src/lib/content-store.ts`): add `vaultIntro: boolean` and
  `vault?: number`, populated from `parsed.meta` in the build (alongside
  `title`/`subtitle`/…).
- **`Presenter.astro`**: when `deck.vaultIntro !== false`, render the gate with
  door number `deck.vault ?? 94`; otherwise render as today (no gate).

## Files

- `src/lib/vault-door.ts` — new; extracted `buildDoor`.
- `src/components/VaultDoorIntro.astro` — import `buildDoor` from the module
  instead of the inline copy (no behaviour change).
- `src/lib/deck.ts` — two new frontmatter fields.
- `src/lib/content-store.ts` — two new `Deck` fields + propagation.
- `src/layouts/Presenter.astro` — gate markup + CSS (green-filtered door, OPEN
  button, roll-away/reveal animation) + script (buildDoor call, arm-nav-until-open,
  open sequence, reduced-motion + opt-out handling).

## Error handling & edge cases

- **Opt-out** (`vaultIntro: false`): no gate rendered; the presenter is exactly as
  today.
- **No-JS**: the presenter already requires JS to navigate. The gate is JS-driven;
  with JS off the deck is non-interactive regardless — acceptable and unchanged in
  spirit. (The slides are still server-rendered in the DOM.)
- **Single-slide deck**: OPEN still reveals slide 1; NEXT is a no-op afterwards
  (existing behaviour).

## Testing

- **`deck.ts`**: `parseDeckSource` unit tests — `vaultIntro` defaults to `true`,
  `false` parses, `vault` parses as a positive int (and rejects invalid).
- **`vault-door.ts`**: unit test that `buildDoor` populates the SVG (e.g. renders
  the 24 gear teeth / the vault number text) so the extraction is verified.
- **`content-store`**: the built `Deck` carries `vaultIntro`/`vault` from
  frontmatter (extend an existing deck store test).
- **UI**: `npm run build` + a dev smoke test — gate shows by default; OPEN reveals
  slide 1; `vaultIntro:false` shows slide 1 with no gate. (The animation itself has
  no unit test, consistent with the existing presenter.)

## Out of scope (YAGNI)

- Porting the full-page room scene (walls, steam, debris, boot HUD, skip link).
- Per-slide transitions beyond the existing wipe.
- Making the vault a navigable slide.
- A settings/config surface beyond the two frontmatter fields.
