# button-css

Registry item `button-css` (files: `styles/button-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `button` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/button-css.css`. A button is a `<button>` or `<a>` with `ds-btn`, one variant class and, optionally, one size class:

```html
<button type="button" class="ds-btn ds-btn-primary">Save</button>
<a href="/next" class="ds-btn ds-btn-secondary ds-btn-sm">Next</a>
```

- Variants (pick one): `ds-btn-primary`, `ds-btn-secondary`, `ds-btn-ghost`, `ds-btn-outline`, `ds-btn-destructive`, `ds-btn-success`, `ds-btn-warning`, `ds-btn-inverse` (on a `--primary` fill), `ds-btn-form-primary` (a fill from the `--form-*` slots).
- Sizes: bare `ds-btn` is the md tier (36px). `ds-btn-sm` (24px), `ds-btn-lg` (52px), `ds-btn-field` (50px, the height of a form field, for a button beside one). `ds-btn-md` is a name only, for stepping back to md after another size.
- Modifiers: `ds-btn-icon` squares a button on its tier's height (icon only; add an `aria-label`). `ds-btn-sentence` keeps the label's case.
- Every class carries the `ds-` prefix, so it does not collide with the `btn-*` classes of `tokens`.

## States

- Hover and press come from the class. `ds-btn-inverse` has no disabled or busy look, as the Tailwind `btn-inverse` has none. A press nudges filled variants 1px down.
- `disabled` on a `<button>`, or `aria-disabled="true"` on an `<a>`, shows the disabled fill and ink. Anchors that are `aria-disabled` also stop taking pointer events; block the click in script, because the attribute alone does not stop keyboard activation.
- `aria-busy="true"` is the in-flight state: the disabled fill, no pointer events, and no hover look even while the pointer is still on it. It does not disable the control, so the label can say what is happening and focus stays put. Set `disabled` as well if it must not be submitted twice.
- Focus shows a 2px outline in `--ring` with a 2px offset (`--primary-ring` on `ds-btn-inverse`, `--form-ring` on `ds-btn-form-primary`).

## Accessibility

- Use a `<button>` for an action and an `<a href>` for navigation.
- An icon-only button needs `aria-label`.
- Target size: `ds-btn-sm` is 24px, the WCAG 2.2 minimum; use md or larger for touch.

## Theming

Reads only roles and scale steps from `variables` (`--primary`, `--gray-3`, `--ring`, `--radius` and so on), so `data-theme`, `.dark` and `.light` recolor it. The spacing and type sizes Tailwind owns are declared on the class as `--ds-*` with the same values. A test holds the look equal to the Tailwind `.btn` in light and dark, in the default and example themes.
