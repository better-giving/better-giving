# checkbox-css

Registry item `checkbox-css` (files: `styles/checkbox-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `checkbox` and `check-field` utilities of `tokens`.

## Markup contract

Import `styles/variables.css` and `styles/checkbox-css.css`. The class goes on the `<input type="checkbox">`:

```html
<input type="checkbox" class="ds-checkbox" id="news" name="news">
<label for="news">Send me updates</label>
```

`ds-check-field` lays a box, its label and an error line in a grid. The box inside it is styled without a class of its own:

```html
<div class="ds-check-field">
  <input type="checkbox" id="terms" name="terms" aria-describedby="terms-err">
  <label for="terms" data-required="true">I accept the terms</label>
  <p data-error id="terms-err">You need to accept to continue.</p>
</div>
```

- The input comes first, the label second; `data-required="true"` on the label adds a star, with empty alt text so it stays out of the box's accessible name. An element with `data-error` spans both columns and sets its own margin, so a `<p>` needs no reset.
- The box is 16px on the control corner, with an edge in `--input`. Checked, it fills with `--primary` and draws the check in `--primary-fg`.

## States

Hover darkens the edge (or the checked fill); disabled shows the disabled fill and a muted check; focus-visible shows a 2px outline in `--ring`. Keyboard focus only: a pointer press does not ring the box.

- Indeterminate: set the input's `indeterminate` property from script (there is no attribute for it), which the browser announces as mixed, so the input takes no `aria-checked`; the box takes the checked fill with a flat bar, and hover steps it as it does a checked box.
- `aria-invalid="true"` on the input takes the `--destructive` edge. On an unchecked box hover leaves it alone; a checked or indeterminate box shows it at rest, and under the pointer takes the `--primary-hover` fill and edge as any filled box does.

## Accessibility

- The box is a native input, so it keeps its role, keyboard use and form value.
- Every box needs a label.
- Link an error with `aria-describedby` on the input.

## Theming

Reads roles from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step and type size Tailwind owns are declared on the classes as `--ds-*` with the same values. Both are in rem, so the box and its label follow the reader's browser font size. A test holds the look equal to the Tailwind `checkbox` and `check-field` in light and dark, in the default and example themes.
