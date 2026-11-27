# combobox-css

Registry item `combobox-css` (files: `styles/combobox-css.css`; depends on `variables` and `select-css`). Plain CSS: no Tailwind, no build step. The look of the `combobox` item for a page that has only `variables`. The behavior is the page's: filtering, the highlight, `aria-activedescendant`, the keys and opening and closing.

## Markup contract

Import `styles/variables.css`, `styles/field-css.css`, `styles/select-css.css` and `styles/combobox-css.css`, in that order: `combobox-css` loads after `select-css`, whose `.ds-option` rows it builds on.

```html
<div class="ds-combobox ds-combobox-popover">
  <label class="ds-sr-only" for="cur">Currency</label>
  <div class="ds-combobox-box">
    <svg aria-hidden="true"><!-- lucide search --></svg>
    <input id="cur" class="ds-combobox-input" role="combobox" aria-expanded="true"
      aria-autocomplete="list" aria-controls="cur-list" aria-activedescendant="cur-eur" placeholder="Currency">
  </div>
  <p class="ds-sr-only" role="status" aria-live="polite">2 results</p>
  <div class="ds-combobox-list" id="cur-list" role="listbox">
    <div role="group" aria-labelledby="cur-fiat">
      <div class="ds-combobox-heading" id="cur-fiat">Currencies</div>
      <div class="ds-option ds-combobox-option" id="cur-eur" role="option" aria-selected="true" data-highlighted>
        <span class="ds-combobox-mark" aria-hidden="true"><!-- the app's mark --></span>
        <span class="ds-combobox-text">
          <span class="ds-combobox-line">
            <span class="ds-option-label">Euro</span>
            <span class="ds-combobox-badge">Fiat</span>
          </span>
          <span class="ds-option-meta">Eurozone</span>
        </span>
        <span class="ds-combobox-tick" aria-hidden="true"><svg><!-- lucide check --></svg></span>
      </div>
    </div>
    <div role="group" aria-labelledby="cur-none" aria-describedby="cur-none-msg">
      <div class="ds-combobox-heading" id="cur-none">Coins</div>
      <p class="ds-combobox-message" id="cur-none-msg">No match for "xyz"</p>
    </div>
  </div>
</div>
```

- `ds-combobox`: the root. With `ds-combobox-popover` it draws the floating fill (`--popover`), a 1px `--hairline` edge, `--shadow-floating`, the card corner and a 4px inset; without, nothing. Where it sits is yours.
- `ds-combobox-box`: the 50px search box, a `--input` edge on `--surface`, a 12px side inset and the 2px `--ring` outline it always draws while open. Its `<svg>` is the 20px gray-11 search glyph. `ds-combobox-input` is the bare input at 16px, weight 400.
- `ds-combobox-list`: the list, 4px under the box, at most `min(30rem, 70vh)` tall, scrolling inside without chaining.
- `ds-combobox-heading`: a group's heading, 12px weight 600 gray-11. `ds-combobox-message`: a no-match or failed line, 14px gray-11; give the group `aria-describedby` for it and mirror its text into the live region.
- A row is `ds-option` (from `select-css`) with `ds-combobox-option`, at least 48px: `ds-combobox-mark` (32px, `aria-hidden`; your mark), `ds-combobox-text` holding `ds-combobox-line` (the `ds-option-label` and the optional `ds-combobox-badge` at its end) and the `ds-option-meta` line, and `ds-combobox-tick`, a 16px slot that is always there and holds the check only on the picked row.
- Picked is `aria-selected="true"` (`--secondary-active`), the row the arrow keys are on is `data-highlighted` (`--secondary-hover`), both is `--secondary-active`, and `aria-disabled="true"` is gray-11 with the mark in grayscale and no pointer. The meta line steps to gray-12 on a highlighted or picked row. Under forced colors the highlighted row draws a 2px `CanvasText` outline inside its edge. `select-css` owns these states.

## Accessibility

- The input is `role="combobox"` with `aria-expanded="true"`, `aria-autocomplete="list"`, `aria-controls` and `aria-activedescendant` set to the highlighted row.
- Groups are `role="group"` named by their heading; rows are `role="option"`.
- The label is `ds-sr-only`; the status line is a polite live region.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the field height and the type sizes Tailwind owns are declared on the classes as `--ds-*` with the same values; the sizes are in rem, so it follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `Combobox` in light and dark, in the default and the example themes.
