# menu-css

Registry item `menu-css` (files: `styles/menu-css.css`; depends on `variables`, `lead-css` and `checkbox-css`). Plain CSS: no Tailwind, no React. The look of the `menu` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/lead-css.css`, `styles/checkbox-css.css` and `styles/menu-css.css`.

```html
<button type="button" class="ds-icon-bare ds-icon-bare-sm" id="row-more"
        aria-label="More actions for Spring clean-up fund"
        aria-haspopup="menu" aria-expanded="false" aria-controls="row-menu">…</button>

<div class="ds-menu" id="row-menu" role="menu" tabindex="-1" aria-labelledby="row-more" popover>
  <button type="button" class="ds-menu-item" role="menuitem" tabindex="-1">
    <span class="ds-lead-1lh"><svg aria-hidden="true">…</svg></span>
    <span>Edit</span>
  </button>
  <button type="button" class="ds-menu-item" role="menuitem" tabindex="-1" aria-disabled="true">…<span>Archive</span></button>
  <hr class="ds-menu-separator">
  <button type="button" class="ds-menu-item ds-menu-item-destructive" role="menuitem" tabindex="-1">…<span>Delete campaign</span></button>
</div>

<div class="ds-menu" role="menu" tabindex="-1" aria-labelledby="account" popover>
  <div class="ds-menu-header" role="presentation">
    <span class="ds-menu-header-title">Amara Lindqvist</span>
    <span class="ds-menu-header-meta">amara@example.org</span>
  </div>
  <hr class="ds-menu-separator">
  <div class="ds-menu-group" role="group" aria-labelledby="acct-label">
    <div class="ds-menu-label" id="acct-label">Account</div>
    <a class="ds-menu-item" role="menuitem" tabindex="-1" href="/settings">…<span>Account settings</span></a>
  </div>
</div>

<div class="ds-menu" role="menu" tabindex="-1" aria-labelledby="status-filter" popover>
  <div class="ds-menu-item ds-menu-check" role="menuitemcheckbox" aria-checked="mixed" tabindex="-1">
    <span class="ds-lead-1lh"><input type="checkbox" class="ds-checkbox" tabindex="-1" aria-hidden="true" readonly></span>
    <span>All statuses</span>
  </div>
  <hr class="ds-menu-separator">
  <div class="ds-menu-scroller" role="presentation">
    <div class="ds-menu-item ds-menu-check" role="menuitemcheckbox" aria-checked="true" tabindex="-1">
      <span class="ds-lead-1lh"><input type="checkbox" class="ds-checkbox" tabindex="-1" aria-hidden="true" readonly checked></span>
      <span>Active</span>
    </div>
    …
  </div>
</div>
```

- `ds-menu`: the panel. `--popover`, a 1px `--hairline` edge, `--shadow-floating`, the `--radius-card` corner, 8px inside, rows 2px apart; at least 12rem wide, at most 20rem and the viewport less 16px; at most 24rem tall and the viewport less 16px, past which a `ds-menu-scroller` in it scrolls, or, without one, the panel itself does. It scales and fades in over `--duration-fast` (`ds-popup-in`) each time it is shown; it leaves at once. Hidden by the `hidden` attribute or, as a `popover`, while it is not open.
- `ds-menu-item`: a row, a `<button>` or an `<a>`, 36px tall at least (44px on a coarse pointer), 8px inside, 14px at weight 500 in `--gray-12`. Put its glyph (lucide's, as an `<svg aria-hidden="true">`) in a `ds-lead-1lh` box first, so it stays on the label's first line when the label wraps, and the label last. The glyph is 16px in `--gray-11`.
- `ds-menu-item-destructive`: a delete or a removal, `--destructive-subtle-fg` for the label and the glyph, highlighted on `--destructive-subtle`.
- `ds-menu-check`: with `ds-menu-item`, a row with a checkbox, `role="menuitemcheckbox"` with `aria-checked` `true`, `false` or `mixed`. Its box is a checkbox-css `ds-checkbox` in a `ds-lead-1lh` box, 12px before the label, `aria-hidden="true"`, `readonly` and `tabindex="-1"`: the row takes the click and is the control. For `mixed`, set the box's `indeterminate` from script. A ticked row is not tinted; the box carries the state.
- `ds-menu-scroller`: the rows of a long list, last in the panel: they scroll inside it (a grid, rows 2px apart, a thin scrollbar, its scroll kept from the page) while the rows before it, such as an All row and a separator, stay put. A list longer than about 30 values is no menu: use a multi-select.
- `ds-menu-separator`: an `<hr>`, a 1px `--hairline` line with 4px clear above and below.
- `ds-menu-group` and `ds-menu-label`: rows under a label (xs, bold, uppercase on the label tracking, `--gray-11`); name the `role="group"` with the label's id.
- `ds-menu-header`, `ds-menu-header-title` and `ds-menu-header-meta`: text at the top that is not a row (who is signed in), `role="presentation"`: the title sm and semibold, the meta xs in `--gray-11`, each cut to one line.

## States

- Highlighted: the row the arrow keys are on, marked `data-highlighted` while focus stays on the panel (an `aria-activedescendant` menu) or focused itself (a roving-focus menu), and the row under the pointer where the pointer can hover: `--gray-4`.
- From the keyboard the highlight adds a 2px `--ring` outline 2px inside the row: on a focused row that is `:focus-visible`, or on the `data-highlighted` row of a `:focus-visible` panel.
- Disabled, `aria-disabled="true"`: opacity .6, `not-allowed`, no highlight. Keep it in the menu, skip it with the arrow keys and ignore its click.

## Behavior

No script ships with the item. The menu button pattern is the page's: open on click, Enter, Space or ArrowDown on the trigger (set `aria-expanded="true"` on it, which draws a bare icon button or a button held open) with the first row highlighted; ArrowDown and ArrowUp move the highlight past disabled rows; Home and End jump; typing a label's first letters highlights it; Enter and Space activate the row and close the menu; Escape and Tab close it; every close puts focus back on the trigger. A list of checkbox rows stays open as Enter, Space or a click toggles a row: flip its `aria-checked` and its box's `checked`. Bring the row the keys highlight into view inside a `ds-menu-scroller` (scroll the scroller itself, not the page); leave the pointer's highlight where it is.

Render the panel where no ancestor's `overflow: hidden` can clip it: in the top layer as a `popover` (shown with `showPopover()`, so it also clears a `z-index` stack), or at the end of `<body>`. Either way position it yourself, 4px from the trigger: under it with the ends aligned for a row's "more", above it with the starts aligned for an account button. The class sets `margin: 0` and `inset: auto` (a `popover`'s own `inset: 0` would otherwise pin it to the viewport's right edge on a `dir="rtl"` page); set `top` and `left` from the trigger's box, which places it in either direction. A panel moved out of a themed area (`data-theme`, `.dark`, `.light`) loses that area's theme: give the panel the same attribute and class.

## Accessibility

- `role="menu"` on the panel, named by the trigger (`aria-labelledby`); `role="menuitem"` (or `menuitemcheckbox`) on each row, `tabindex="-1"`; the scroller is `role="presentation"`.
- The trigger carries `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`.
- A glyph is `aria-hidden="true"`; the label is the name. A trigger that repeats per row names its row: "More actions for <name>".
- Under forced colors a highlighted, focused or hovered row draws a 2px `CanvasText` ring 2px inside in place of its fill, as `select-css`'s options do.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The label tracking is `--ds-tracking-label` from `variables`, so an override of that role reaches the group labels too. The spacing step, the type sizes, the weights and the easing Tailwind owns are declared on `ds-menu` as `--ds-*` with the same values; the sizes are in rem, so the menu follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `Menu` in light and dark, in the default and the example themes.
