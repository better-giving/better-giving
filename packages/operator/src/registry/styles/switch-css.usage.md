# switch-css

Registry item `switch-css` (files: `styles/switch-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `switch` item.

## Markup contract

Import `styles/variables.css` and `styles/switch-css.css`. The class goes on an `<input type="checkbox" role="switch">`; add `ds-switch-sm` for the small size:

```html
<label class="ds-switch-field">
  <span class="ds-switch-text">
    <span class="ds-switch-label" id="list-label">Show the supporter list</span>
    <span class="ds-switch-hint" id="list-hint">First names appear under the campaign.</span>
  </span>
  <input type="checkbox" role="switch" class="ds-switch" name="public_list"
    aria-labelledby="list-label" aria-describedby="list-hint" checked>
</label>

<label class="ds-switch-field">
  <span class="ds-switch-label" id="alerts-label">Gift alerts</span>
  <input type="checkbox" role="switch" class="ds-switch ds-switch-sm" name="alerts"
    aria-labelledby="alerts-label">
</label>
```

- `ds-switch-field` is the row: the words, then the switch at the end, in a two-column grid with a 16px gap. A medium row is at least 50px tall with 12px above and below, top-aligned; a row holding a `ds-switch-sm` is the compact list row, at least 24px tall with 6px above and below, centered.
- `ds-switch-text` stacks `ds-switch-label` (14px medium) over `ds-switch-hint` (12px, gray-11). A row with no hint can hold `ds-switch-label` alone.
- Point `aria-labelledby` at the label and `aria-describedby` at the hint: the hint is inside the same `<label>`, and without them it becomes part of the name.
- The row carries no margin and no divider; a list draws its own lines between rows.

## States

- Off: a `--gray-9` track with an inner shadow and a `--primary-fg` thumb with a small shadow; hover steps the track to `--gray-10`.
- On: a `--primary` track, the thumb at the far end; hover takes `--primary-hover`.
- Focus-visible: a 2px `--ring` outline 2px off the track, for keyboard focus only.
- Disabled: a `--gray-3` track with a 1px `--hairline` inset edge; the thumb is `--gray-7` off and `--gray-11` on; the row's words mute to gray-11 and it takes the not-allowed cursor.
- The thumb slides at `--duration-fast`, which `variables` collapses under `prefers-reduced-motion`.
- Forced colors: the track draws a `CanvasText` outline, the thumb `CanvasText` off, `Highlight` on and `GrayText` disabled.

## Accessibility

- A native checkbox: one tab stop, Space toggles it, a press on the row toggles it, and it posts with its form (`name=on` when on). It is a form value, read on submit, not applied on click.
- `role="switch"` makes it read as on or off; write no `aria-checked`, the checked state is native.

## Theming

Reads roles and gray steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, easing, field height and the two shadows Tailwind owns are declared on the classes as `--ds-*` with the same values. Sizes are in rem, so the switch and its row follow the reader's browser font size. A test holds the look equal to the React `switch` in light and dark, in the default and example themes.
