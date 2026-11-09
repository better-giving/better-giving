# card-css

Registry item `card-css` (files: `styles/card-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `card` item.

## Markup contract

Import `styles/variables.css` and `styles/card-css.css`:

```html
<section class="ds-card">
  <header class="ds-card-header"><h2>Plan</h2></header>
  <div class="ds-card-body">Seats, billing and usage.</div>
  <footer class="ds-card-footer"><button type="button">Upgrade</button></footer>
</section>
```

- `ds-card`: the container on the 12px corner, the card fill and a hairline edge, no shadow. It clips overflow so a slot's rule stays inside the corner.
- `ds-card-header`: a rule below it, 24px by 16px padding. A heading directly inside it has no margin and takes the header's size and weight, so the header is the same height with or without a CSS reset. For a heading size, give the heading a class of your own, declared after `card-css.css`.
- `ds-card-body`: 24px by 20px padding.
- `ds-card-footer`: the actions row, on the well fill one rung in from the card, with a rule above it. It is a flex row with a 12px gap.
- Use the slots you need. Use `<section>`, `<header>`, `<footer>` as above, or `<div>` for any of them.

## Accessibility

Give a section card a heading, or an `aria-label`, so it is a named region. A card is not interactive.

## Theming

Reads roles from `variables` (`--card`, `--panel`, `--hairline`, `--radius-card`), so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on each class as `--ds-spacing` with the same value. A test holds the look equal to the React `card` in light and dark, in the default and example themes.
