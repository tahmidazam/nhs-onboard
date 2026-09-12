---
name: ui-conventions
description: This repo's rules for shadcn components, Tailwind, and which of Toast, Alert, Dialog and Sheet to reach for. Use when building or reviewing any UI, choosing a component, styling anything outside src/components/ui, or writing user-facing copy.
---

# UI conventions

The product is a clinical review tool. It should read as software a GP practice
bought, so every choice below favours the ordinary over the expressive.

## The preset

Already initialised. Never run `shadcn init`, and never pass `--overwrite` to
`add`.

| Setting | Value |
|---|---|
| style | `base-luma` |
| base | `base`, meaning **Base UI, not Radix** |
| base colour | `neutral`, CSS variables |
| icons | `lucide` |
| font | Inter Variable, imported in `src/index.css` |

Base UI component APIs differ from the Radix ones most training data describes.
Run `pnpm dlx shadcn@latest docs <component>` and fetch the URLs it returns
before writing a component.

`src/lib/utils.ts` exports `cn()`. Fonts and colour tokens are wired in
`src/index.css`. Do not add font imports or redefine tokens.

Inter carries Latin, Greek, Cyrillic and Vietnamese. It has no Bengali or
Devanagari, so a PresentedDocument in those scripts falls back to a system font.
Load Noto Sans Bengali and Noto Sans Devanagari on the document surface before
relying on how it renders.

## Tailwind

shadcn components carry colour, typography, radius and shadow. Outside
`src/components/ui/`, use layout utilities only: `flex`, `grid`, `gap-*`,
`w-*`, `max-w-*`, `p-*`, `m-*`. Space children with `gap-*` rather than
`space-*`, and size square elements with `size-*`.

Semantic tokens carry everything else. Muted text is `text-muted-foreground`.
Surfaces are `bg-card` and `bg-muted`. Edges are `border-border`.

Audit with a grep before submission. Any `-gray-`, `-blue-`, `-red-`,
`rounded-lg` or `font-semibold` outside `ui/` is a bug:

```bash
grep -rnE '(text|bg|border)-(gray|slate|zinc|blue|red|green|amber)-[0-9]' src --include='*.tsx' | grep -v 'components/ui'
```

## Component choice

Each of these has one job. Reaching for the wrong one is the most common way a UI
starts reading as generated.

**Toast** is Base UI's `toast`, since the preset uses Base UI. Do not install
`sonner`, which is the Radix and Aria choice. It reports the outcome of an async
action the user just started, which they would otherwise not see finish. "Call
connected." "Four actions written to the sim."

**Alert**, inline, states a persistent condition, placed next to what it
describes. "Four medications could not be resolved to a UK equivalent." It lives
in the column it belongs to.

**Dialog** confirms a decision with consequence: approving the action set before
it writes to the sim.

**Sheet** shows detail, opened from a table row.

## Typography

`Typeset` renders the foreign-language source documents, so a Bengali discharge
summary reads as a document rather than a stack of divs.

Numbers get `tabular-nums`. Dates render as `12 Sep 2026`.

## Badges

Badge variants map to the three confidence buckets from
`docs/adr/0003-three-confidence-buckets.md` and are used nowhere else, so one
colour means one thing across the whole app.

| Bucket | Variant |
|---|---|
| `document-evidenced` | `default` |
| `patient-reported` | `secondary` |
| `uncertain-mapping` | `outline` |

## Layout

Sidebar holds app navigation: Board, Rules, Sources. Its footer shows the sim
clock and world name. Patients live in the table.

Three surfaces:

- `/` is the board. TanStack Table, status column, and the search that lets a
  judge pick any patient.
- `/patient/:id` splits source documents against the extracted record with
  `ResizablePanelGroup`. Clicking a claim highlights its source span.
- `/patient/:id/review` shows the three confidence columns, each row naming its
  destination in the sim.

## Copy

Write empty states as specific sentences: "No patients have completed document
processing yet."

Label buttons with the verb and its object: "Write 4 actions to the record".

Run every user-facing string through the `unslop` skill. Plain words, no em
dashes, no emoji.
