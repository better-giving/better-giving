# table-css

Registry item `table-css` (files: `styles/table-css.css`; depends on `variables` and `badge-css`). Plain CSS: no Tailwind. The look of the `tokens` item's `table` classes and the React `table` item.

## Markup contract

Import `styles/variables.css`, `styles/table-css.css` and, for the status badge, `styles/badge-css.css`.

```html
<div class="ds-table-scroll" role="region" aria-label="Campaigns" tabindex="0">
  <table class="ds-table">
    <thead>
      <tr>
        <th scope="col">Campaign</th>
        <th scope="col">Status</th>
        <th scope="col" class="ds-num">Raised</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">Spring clean-up fund</th>
        <td><span class="ds-badge ds-badge-primary">Active</span></td>
        <td class="ds-num">$6,580</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3"><button type="button">Load more</button></td></tr>
    </tfoot>
  </table>
</div>
```

- `ds-table` is the table and its shell: the `--card` fill, a `--hairline` edge, the control corner. Header labels sit on `--panel` at 14px medium in gray-11; body rows are 14px, split by `--hairline`; every cell is 12px by 16px. A `<th scope="row">` in the body is gray-12 at 600. A body row tints to gray-4 on hover, every cell of it, over `--duration-fast`, where the pointer can hover. Tabular figures throughout (`tnum`), with the face's plain zero (`zero` off).
- `ds-num` on a figure column's header and cells right-aligns them.
- A `<button>` in the `<tfoot>` is the load-more row: full width, 8px, 12px semibold, transparent, gray-4 hovered, gray-5 pressed, the disabled fill when disabled; keyboard focus keeps the browser's ring, in `--ring`.
- `ds-table-scroll` is the frame a wide table scrolls in: it takes the shell from a `ds-table` directly inside, scrolls sideways with a thin scrollbar, keeps cells from wrapping and pins the first column on the `--card` fill (the header's on `--panel`, a hovered row's on gray-4). Under 640px the pinned column is at least 11rem. Focus is a 2px `--ring` outline 2px outside it.
- `ds-table-scroll-pin-end`, with `ds-table-scroll`, pins the last column too (a row's actions) from md (48rem): at the frame's end, on the same fills (`--card`, the header's `--panel`, a hovered row's gray-4), with a 1px `--hairline` on its start edge so the cut-off cell beside it does not run into it. Under md it is not pinned and draws no edge: it scrolls with the rest.
- Inside `ds-table-scroll`, a `<tbody>` or `<tfoot>` row of a single cell (`<td colspan>` across every column) is a span, with no class to add: the cell is left out of both pinned columns (no edge either), loses its padding, and its one child (the load-more `<button>`, or the empty row's title and hint, padded itself) is pinned to the frame's start at the frame's visible width (`100cqi`; the frame is an inline-size container). The button stays whole and clickable on a phone, at the start of the scroll and at the end, and the scroll ends at the table's last column. A footer row with more than one cell (a totals row) keeps its first cell pinned like every other row. A single cell holding text alone (a note such as "Showing 20 of 140") keeps its padding and scrolls with the table; it is still left out of the pinned column. The pinned button sits flush with the frame's edges, which clip an outer ring, so its keyboard ring is drawn inside it: 2px in `--ring`, 2px in from its edges. Outside a scroll frame, give the load-more cell `padding: 0` so the button runs to the table's edges.
- Inside a `ds-card` or a `[role="dialog"]`, the table and its scroller drop the fill, edge and corner: they are content of that surface.
- A status cell holds a badge-css badge.

## States

Loading, empty and error replace the whole table at the same width, with the state-card-css cards. A table with column filters keeps its header when nothing matches and shows the empty row instead: a `<tbody>` row of one cell, as above (rule 7 below).

## The standard data table

1. **Which tables filter.** A table of records someone narrows (a list that grows, with a status or category) filters from its column headers. Status and category columns carry a column filter; names, dates and figures don't. Filters never sit in a side panel or a modal. A short fixed table has none.
2. **Column order.**
   - First: the row's identity, which is pinned (a `<th scope="row">` when the cell names the row).
   - Second: the status as a badge-css badge.
   - Then descriptive columns, then figures (`ds-num`, right-aligned, header too), then the action column last.
   - Cells never wrap.
3. **Pinned columns.** The first column is always pinned. When the last column is an action column, add `ds-table-scroll-pin-end`: it is pinned from md up and scrolls with the rest below md. Both pinned cells take the row's fill.
4. **Full width.** The table fills its content area with no max-width wrapper. It scrolls sideways inside `ds-table-scroll` rather than squeezing cells.
5. **Filters.**
   - Every filter has a default, shown with no chip.
   - Unticking the last value snaps back to the default, so the table is never empty by accident.
   - From md the funnels sit in the headers; under md, plain triggers sit above the table and open the same lists.
   - Chips show only filters off their default; Clear filters comes last.
   - A column with more than about 30 values is not a column filter; use a multi-select above the table.
6. **Filters live in the URL.** They are comma lists (`?status=a,b`), defaults left out, parsed and written with `filter-params`. A change drops `cursor` and replaces history. Load more keeps the filters, so a view can be linked.
7. **Empty and load more.** A table with column filters keeps its header and chips when nothing matches and shows one pinned row ("No records match these filters"). The state-card-css swap is for tables without column filters. Load more is the `tfoot` button, with the filters kept.

## Accessibility

- The scroll frame is `role="region"` with `aria-label`, so a screen reader announces what it holds, and `tabindex="0"` while the table is wider than the frame, so a keyboard reaches it and scrolls it. A table that fits needs no tab stop: the React `TableScroll` drops it then, and these lines do the same for the plain markup (write `tabindex="0"` in the markup, so a wide table is reachable before the script runs):

```js
for (const frame of document.querySelectorAll(".ds-table-scroll")) {
  const measure = () => {
    if (frame.scrollWidth > frame.clientWidth) frame.tabIndex = 0;
    else frame.removeAttribute("tabindex");
  };
  const sizes = new ResizeObserver(measure);
  sizes.observe(frame);
  for (const child of frame.children) sizes.observe(child);
  measure();
}
```
- Column headers are `<th scope="col">`, row headers `<th scope="row">`.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes and weights Tailwind owns are declared on the classes as `--ds-*` with the same values. The spacing step and type sizes are in rem, and so is the phone breakpoint, so the table follows the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size, so a host's root size does not move them. The corner comes from `variables` and stays in rem.
