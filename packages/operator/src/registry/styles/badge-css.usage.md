# badge-css

Registry item `badge-css` (files: `styles/badge-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `badge` item.

## Markup contract

Import `styles/variables.css` and `styles/badge-css.css`:

```html
<span class="ds-badge ds-badge-success">Paid</span>
```

- `ds-badge` alone is the neutral chip.
- Variants: `ds-badge-neutral`, `ds-badge-primary`, `ds-badge-success`, `ds-badge-warning`, `ds-badge-destructive`. Each is a tinted chip on the subtle fill with its subtle ink; none is a solid fill.
- Use a `<span>`. The class sets `display: inline-flex`, so an icon and text sit in a row with a 4px gap.
- `ds-badge-on-photo`, added beside a variant, is the look for a badge laid over an image: a solid fill with its `-fg` ink, a 1px ring in `--background`, and an 8px `::before` mark in the ink, 6px before the label. The mark's shape follows the variant: success a filled circle, warning a hollow ring, neutral (and a bare `ds-badge-on-photo`) a filled square, primary a filled diamond, destructive a filled cross.
- The class carries no position. Place it from the cover box: `position: absolute` at 12px from the top and left of a `position: relative; overflow: hidden` box. Live maps to `ds-badge-success`, draft to `ds-badge-warning`, ended to `ds-badge-neutral`:

```html
<div class="cover">
  <img src="cover.jpg" alt="">
  <span class="ds-badge ds-badge-success ds-badge-on-photo">Live</span>
</div>
```

## Accessibility

A badge is not interactive: use a button for an action. Colour is not the only carrier of meaning, so the text should say the status ("Overdue"), not rely on the tint. On a photo, each ink sits on its variant's solid fill (recorded in APCA in the brand contrast test: Lc 60 or more but for warning in light, the warning button's accepted miss), and the mark is a pseudo-element with empty content, so it stays out of the accessible name.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The type size and weight Tailwind owns are declared on the class as `--ds-*` with the same values. The type size is in rem, so the badge follows the reader's browser font size. A test holds the look equal to the React `badge`, with and without `on_photo`, in light and dark, in the default and example themes.
