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

## Routing

TanStack Router, not react-router. Define the route tree in code rather than
adding the file-based routing plugin, so there is no codegen step in the build.

## Layout

Every route renders inside the shadcn `Sidebar`. Add it with
`pnpm dlx shadcn@latest add sidebar` and use `SidebarProvider`, `Sidebar`,
`SidebarInset` and `SidebarTrigger` as composed, rather than hand-rolling a nav
column.

Sidebar navigation: Board, Rules, Sources. Its footer shows the sim clock and the
world name.

Three routes:

- `/` is the board: every onboarded patient and their pipeline stage.
- `/patient/:id` splits source documents against the extracted record with
  `ResizablePanelGroup`. Clicking a claim highlights its source span.
- `/patient/:id/review` shows the three confidence columns, each row naming its
  destination in the sim.

## Finding a patient

A `Dialog` over the board, opened from a button in the board's header. Not a
route, because selection is a transient action that ends by returning to the
board, and on stage a navigation away and back is a chance to be on the wrong
screen.

Not a `Command` palette either. The flow is search or roll, read the record size,
choose a country, then commit, which is a small form rather than a one-shot pick.

The dialog is wide and holds a compact data table over the simulator's patients,
a random pick, the record size, and the country select. Onboarding is the
dialog's confirm action, and the dialog closes onto the board with the new row
already present.

Per `docs/adr/0012-patient-selection-is-arbitrary-and-visible.md`, re-rolling
stays inside the dialog and in view.

## Tables

The board and the patient finder are both tables, driven by TanStack Table
through the shadcn data table. Add it with `pnpm dlx shadcn@latest add
data-table` and read the `tanstack-table` skill for the library API.

Column definitions carry sorting, filtering and cell rendering. Do not filter or
sort a row array by hand before passing it in, and do not render a table as a
list of `Card`s.

## Pagination

`pnpm dlx shadcn@latest add pagination`. Compose `Pagination`,
`PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`,
`PaginationNext` and `PaginationEllipsis`. The active page is `isActive` on
`PaginationLink`.

The parts render anchors and take `href`. The patient finder is a dialog and
pages in place, so swap the element with Base UI's `render` prop rather than
leaving `href="#"` to navigate.

There is no built-in disabled state on `PaginationPrevious` or `PaginationNext`.
Disable them on the first and last page yourself.

The simulator pages server-side: fixed page size of 30, `offset` only, and a
`total` in the response. Set `manualPagination: true` and pass `pageCount` to
TanStack Table. The default is client-side paging, which would page the 30 rows
already fetched and silently hide the other 49,970.

50,000 patients is over 1,600 pages, so render a window of pages around the
current one with `PaginationEllipsis` rather than every number. Paging to page
1,412 is not a real journey. Search and the random pick are how a patient is
found, and pagination exists to make the list feel finite.

## Density

This is an operational tool, so it should look like one. A wall of evenly spaced
`Card`s with an icon and a heading in each is the house style of generated UI and
reads as exactly that.

Tabular data goes in a table. A `Card` is for one bounded thing that is genuinely
its own object, such as a single document or a single recommendation. Grouped
detail is `Tabs`, a `Sheet` or a description list, not three cards in a row.

Reach for `Empty` for empty states rather than a centred card with an icon.

## Pending states

Nothing may freeze. Every button that starts a request goes disabled and shows a
`Spinner` until it settles, keeping its label so the row does not reflow.

Data loading in a table or a panel uses `Skeleton` shaped like the content it
replaces, not a centred spinner on an empty page.

Any wait that can exceed a second gets a `Progress` or a spinner with a sentence
naming what is happening. "Reading the record from the simulator." Degradation
and extraction both exceed a second.

Convex queries expose `undefined` while loading. Render the skeleton on
`undefined` rather than treating it as empty.

## Copy

Write empty states as specific sentences: "No patients have completed document
processing yet."

Label buttons with the verb and its object: "Write 4 actions to the record".

Run every user-facing string through the `unslop` skill. Plain words, no em
dashes, no emoji.
