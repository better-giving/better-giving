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
      <tr><td colspan="3" style="padding: 0"><button type="button">Load more</button></td></tr>
    </tfoot>
  </table>
</div>
```

- `ds-table` is the table and its shell: the `--card` fill, a `--hairline` edge, the control corner. Header labels sit on `--panel` at 14px medium in gray-11; body rows are 14px, split by `--hairline`; every cell is 12px by 16px. A `<th scope="row">` in the body is gray-12 at 600. A body row tints to gray-4 on hover, every cell of it, over `--duration-fast`, where the pointer can hover. Tabular figures with a slashed zero throughout.
- `ds-num` on a figure column's header and cells right-aligns them.
- A `<button>` in the `<tfoot>` is the load-more row: full width, 8px, 12px semibold, transparent, gray-4 hovered, gray-5 pressed, the disabled fill when disabled; keyboard focus keeps the browser's ring, in `--ring`.
- `ds-table-scroll` is the frame a wide table scrolls in: it takes the shell from a `ds-table` directly inside, scrolls sideways with a thin scrollbar, keeps cells from wrapping and pins the first column on the `--card` fill (the header's on `--panel`, a hovered row's on gray-4). Under 640px the pinned column is at least 11rem. Focus is a 2px `--ring` outline 2px outside it.
- Inside a `ds-card` or a `[role="dialog"]`, the table and its scroller drop the fill, edge and corner: they are content of that surface.
- A status cell holds a badge-css badge.

## States

Loading, empty and error replace the whole table at the same width, with the state-card-css cards.

## Accessibility

- The scroll frame is `role="region"` with `aria-label` and `tabindex="0"`: a keyboard reaches it and scrolls it, and a screen reader announces what it holds.
- Column headers are `<th scope="col">`, row headers `<th scope="row">`.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes and weights Tailwind owns are declared on the classes as `--ds-*` with the same values. The spacing step and type sizes are in rem, and so is the phone breakpoint, so the table follows the reader's browser font size.
