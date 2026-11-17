# bare-icon-button-css

Registry item `bare-icon-button-css` (files: `styles/bare-icon-button-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `bare-icon-button` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/bare-icon-button-css.css`. A bare icon button is a `<button type="button">` with `ds-icon-bare`, an `aria-label`, and a lucide glyph as an `<svg aria-hidden="true">` child:

```html
<button type="button" class="ds-icon-bare" aria-label="Close">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">…</svg>
</button>
<button type="button" class="ds-icon-bare ds-icon-bare-sm" aria-label="More actions for Spring clean-up fund"
        aria-haspopup="menu" aria-expanded="false">…</button>
```

- Sizes: bare `ds-icon-bare` draws the glyph at 20px; `ds-icon-bare-sm` at 16px. The glyph fills the button whatever size it sets. No fill, edge or padding.
- Copy each glyph's paths from lucide (`ellipsis`, `x`, `copy`, `star`, `check`, `loader-circle`, `panel-left`); never draw one by hand.

## States

- Rest `--gray-11`; hovered (where the pointer can hover) and pressed `--gray-12`; pressed also nudges 1px down.
- Held open, `aria-expanded="true"`: `--accent-11`, hovered too. Under forced colors, which drop the ink, a 2px `Highlight` outline 2px out marks it.
- Toggle on, `aria-pressed="true"`: `--accent-11`, and the glyph is filled with it.
- `disabled`, or `aria-disabled="true"` on a button that must keep focus: opacity .6, `not-allowed`, no hover ink. Stop an `aria-disabled` button's click in script.
- In flight, `aria-busy="true"` (with `aria-disabled="true"`, so focus stays): swap the glyph for lucide's `loader-circle` as `<svg class="ds-icon-bare-spin" aria-hidden="true">`. The button takes no pointer; the glyph turns on `ds-spin` once a second and stands still under `prefers-reduced-motion: reduce`.
- Done, `data-done="true"`: swap the glyph for lucide's `check`; `--success-subtle-fg`, no pointer. Ignore the click in script while it shows, say the outcome in a `role="status"` region, and after 2000ms put the glyph back and `data-done="false"`.
- Focus shows a 2px `--ring` outline 2px outside, on the `--radius` corner.

## Accessibility

- The name is `aria-label`; the glyph is `aria-hidden="true"`.
- The name also shows as a tooltip on hover and on keyboard focus. This item ships none: draw it with the page's own tooltip on a `--popover` fill, a 1px `--hairline` edge, `--shadow-floating`, the `--radius-card` corner and a 16px inset, opened on `mouseenter` and `focus`, closed on `mouseleave`, `blur` and Escape. Render it at the end of `<body>` (or in the top layer, as a `popover`), so an ancestor's `overflow: hidden` does not clip it.
- Hit area: a `::after` `--ds-hit-target` square (24px, 44px on a coarse pointer; declared by `variables`), centred on the glyph, without changing its drawn size or the layout. The button is `position: relative` for it. Where two neighbours' areas meet, the later one takes the tap.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The glyph sizes are in rem, so the button follows the reader's browser font size; each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset, and an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The easing Tailwind owns is declared on the class as `--ds-ease-in-out` with the same value. A test holds the look equal to the React `BareIconButton` in light and dark, in the default and the example themes.
