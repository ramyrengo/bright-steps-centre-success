# Centre Success frontend design system

Practical guidance for building Centre Success screens. It is deliberately
short. If a rule here conflicts with a page you are writing, change the page.

Centre Success uses the shared Bright Steps **Greenhouse** visual language,
the same one shipped in the Bright Steps Site Launch Planner: deep garden
green anchored on a light mist ground, mint as support, one dark contrast
surface, burgundy reserved for critical. A person moving between the two
products should feel they are in one suite.

Centre Success is plain CSS with semantic class names and **no Tailwind**. The
Planner expresses the same tokens through Tailwind's `@theme`. Keep the values
identical; do not import Tailwind here to close the gap.

Everything lives in `frontend/src/app/globals.css` (tokens plus classes) and
`frontend/src/components/design-system.tsx` (primitives).

## Palette

Retheme by editing the `:root` block in `globals.css` and nothing else.

| Token | Value | Use |
| --- | --- | --- |
| `--color-mist` | `#f5f6f2` | Page ground. The only page background. |
| `--color-panel` | `#ffffff` | Raised surfaces: cards, panels, rows. |
| `--color-line-soft` | `#f0f2ed` | Quiet fills inside a card. |
| `--color-ink` | `#1d211e` | Body and heading text. |
| `--color-mut` | `#656c63` | Secondary text, labels, captions. |
| `--color-line` | `#e4e7e0` | Default border. |
| `--color-garden` | `#1f4a38` | Primary action, links, focus ring. |
| `--color-garden-deep` | `#163828` | Primary hover. |
| `--color-mint` | `#bfe3cb` | Accent on dark: brand mark, active nav, lead labels. |
| `--color-tint` | `#e7f2ea` | Soft supporting surface. |
| `--color-night` | `#1b2a22` | The one dark contrast surface: app bar, hero. |
| `--color-ok` / `-bg` | `#2e7d5b` / `#e7f2ea` | Positive state. |
| `--color-warn` / `-bg` | `#8f5e11` / `#f7eddb` | Warning state. |
| `--color-crit` / `-bg` | `#a93636` / `#f5e2e2` | Critical state only. |
| `--color-info` / `-bg` | `#4e6456` / `#edf1ec` | Informational state. |

Use colour intentionally. A screen should read as mist, white and ink, with
garden on the actions and exactly one dark surface. If a page has more than a
couple of coloured areas, remove some.

Greenhouse has **no orange**. The Bright Steps orange `#F47B20` is a brand
asset but is not part of this interface palette; adding it back is a
one-token change if the Product Owner wants it, but do not introduce it
piecemeal on individual components.

## Surfaces and elevation

- Page: `--surface-canvas` (mist). Never white.
- Card: white, `1px solid var(--border-default)`, `--shadow-card`.
- Dark surface: `--surface-dark`, at most one per screen. It is the hero or
  the app bar, not both competing.
- `--shadow-lifted` is for overlays only. Cards do not float.

Radius: `--radius-medium` / `--radius-large` = `15px` for cards and panels,
`--radius-small` = `8px` for controls, `999px` for pills.

## Typography

Avenir Next, falling back to Segoe UI and the system stack.

| Token | Use |
| --- | --- |
| `--type-display` | The one `h1` per page. |
| `--type-title` | Hero statement inside a dark surface. |
| `--type-section` | `h2` / `h3` section headings. |
| `--type-body` | Body copy. |
| `--type-small` | Meta, facts, captions. |
| `--type-label` | Uppercase eyebrows and metric labels, `0.06em`–`0.13em` tracking. |

Every page answers four questions in order: where am I (eyebrow), what is the
situation (`h1` plus one summary line), what needs attention (the first
section), what next (a dominant action). Do not open a page with ten
equal-weight tiles.

Numerals in data positions use tabular figures — the `.tnum` class, already
applied to metrics, scores and history.

## Spacing

`--space-1` `0.25rem` through `--space-8` `4rem`. Use the scale; do not invent
intermediate values. Section rhythm is `--space-7`, card padding `--space-5`,
gaps inside a card `--space-3`.

## Cards

A card communicates meaning, not decoration.

- One idea per card, one dominant action.
- Severity uses `data-severity` on the card, which draws a left edge. It is
  never the only signal — pair it with a `StatusBadge` and words.
- Do not nest a card inside a card.
- `.card--feature` is the single most important card on a page.

## Metrics

`MetricRow` holds four or five `Metric` tiles. Column counts are explicit at
each breakpoint rather than `auto-fit`, because `auto-fit` produced phantom
zero-width tracks and trailing gaps on wide screens.

**At most one lead tile per row.** `emphasis` paints a tile solid garden; it is
the Planner's `StatCard` "lead" tone. Emphasising three tiles at once dilutes
all three — the first pass of the Compliance screen did exactly that and read
as noise. Pick the single most important figure, and only when it has
something to report. A row where nothing is outstanding has no lead tile at
all, which is the honest result.

Use `unavailable` when a value cannot be known, so the tile shows a written
"Not recorded" rather than a `0` that would assert something false.

## Buttons

| Class | Use |
| --- | --- |
| `.button` / `.workflow-button` | Default action: garden fill, white text. |
| `.button--accent` | The one lead action on a surface. Also garden, visually heavier by placement rather than hue. |
| `.button--secondary` | Everything else: white fill, garden text, line border. |
| `.workflow-button--danger` | Destructive only. |

One primary action per surface. If two things look equally primary, one of
them is secondary.

## Status and severity

`StatusBadge` with `tone` of `neutral`, `positive`, `warning`, `critical` or
`informational`. Each tone renders a mark (`✓ ▲ ! i`) **and** its written
label, so state never depends on colour. `Trend` does the same: the arrow is
decorative and the direction word is always present for assistive technology.

Product language stays direct and non-punitive: "Needs support", "Keep an eye
on", "Steady", "Waiting for verification", "Due today". Never rank centres
against each other and never use league-table words.

## Navigation

- The app bar is the dark surface. The active destination is marked with a
  mint underline and `aria-current="page"` — obvious, not heavy.
- Navigation is **role-aware and backend-derived**. Links come from the
  capability-derived `workspaceLinks` the backend returns; the browser never
  infers a destination from a role name. A System Administrator gains no
  business navigation from being a technical administrator.
- Never render a destination the principal is not authorised for. Frontend
  visibility is presentation only; every destination reauthorises server-side.
- Do not add a menu entry for a module that does not exist yet.

## States

Every asynchronous surface implements four states, all of them usable:

- **Loading** — `LoadingSkeleton`, which announces politely and sets
  `aria-busy`.
- **Empty** — `EmptyState`, which says what would appear here and why it is
  absent. An empty state is never a zero. "No finalised review yet" and
  "0%" mean different things.
- **Error** — `ErrorState`, which never implies an all-clear. If we could not
  check, we say we could not check.
- **Partial** — `Notice`, which names what was not checked rather than
  silently reporting a smaller number.

## Responsive

Design for laptop, tablet and phone. Verified breakpoints: 375, 768, 1024 and
1440.

- Single-column grids need `grid-template-columns: minmax(0, 1fr)`. An
  implicit grid column is sized `auto`, which resolves to **max-content**, and
  one wide child then pans the whole page sideways. This is load-bearing, not
  tidying: before the rule existed the shell measured 706px of scroll width at
  a 375px viewport.
- Flex and grid children that hold wide content need `min-width: 0` for the
  same reason.
- Card grids use `repeat(auto-fit, minmax(min(100%, 22rem), 26rem))` so one
  centre fills its row sensibly and twenty wrap evenly.
- Dense records use `DataList`, which is a readable list on a phone and an
  aligned grid from 768 up. Do not shrink a desktop table into a phone table.
- A horizontally scrolling strip (the nav) must scroll inside itself. The page
  itself never scrolls horizontally.

## Accessibility

- One `h1` per page; sections use `h2`/`h3` in order and are labelled.
- Interactive targets are at least 44px.
- Focus is visible everywhere: `2px solid var(--focus-ring)`, `2px` offset.
- Lists that lose their markers carry `role="list"`.
- Severity, trend and status always include words.
- A skip link precedes the app bar and targets `#centre-success-main`.
- `prefers-reduced-motion` disables the skeleton sweep and transitions;
  `forced-colors` keeps card and row boundaries visible.

## Primitives

From `components/design-system.tsx`: `PageHeader`, `Breadcrumb`, `Section`,
`StatusBadge`, `Metric` / `MetricRow`, `Trend`, `EmptyState`, `ErrorState`,
`LoadingSkeleton`, `Notice`, `SegmentedControl`, `DataList` / `DataListRow`.
From `components/app-shell.tsx`: `AppShell`, `AppBar`, `BusinessWorkspaceGate`.

Compose from these. If you need something new, add it here rather than
styling one page privately.
