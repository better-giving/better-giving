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

## Accessibility

A badge is not interactive: use a button for an action. Colour is not the only carrier of meaning, so the text should say the status ("Overdue"), not rely on the tint.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The type size and weight Tailwind owns are declared on the class as `--ds-*` with the same values. A test holds the look equal to the React `badge` in light and dark, in the default and example themes.
