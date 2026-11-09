# field-css

Registry item `field-css` (files: `styles/field-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `input` item's field: container, label, hint, input and error.

## Markup contract

Import `styles/variables.css` and `styles/field-css.css`:

```html
<div class="ds-field">
  <label class="ds-label" data-required="true" for="email">Email</label>
  <p class="ds-field-hint" id="email-hint">We only use it to sign you in.</p>
  <input class="ds-field-input" id="email" name="email" type="email"
         aria-describedby="email-hint email-err" aria-invalid="true">
  <p class="ds-field-err" id="email-err">Enter a valid address.</p>
</div>
```

- `ds-field`: the container; lets the field shrink inside a flex or grid row.
- `ds-label`: the label. `data-required="true"` adds a star; `data-required="false"` adds "(optional)". The label sits 4px above the control, or flush against a `ds-field-hint` that follows it.
- `ds-field-hint`: help text under the label.
- `ds-field-input`: the control, on an `<input>` or a `<textarea>`. Full width, at least 50px tall, the control corner.
- `ds-field-input-container`: a wrapper that carries the control's look around an input of its own (the ring and states follow the input inside it). Put a bare input in it: the class takes away the input's own edge, fill and focus outline and gives it the field's padding, so the container draws one edge and one ring.
- `ds-field-err`: the message under the control, 4px below it. When it is empty it takes no room.
- The label, the hint and both error classes set their own margins, so a `<p>` or `<label>` renders the same with or without a CSS reset.
- `ds-field-error`: the same message taken out of the flow, over the field's bottom edge. The container needs `position: relative`.

Not included: the floating label and the select and table classes of `tokens`.

## States

- Hover darkens the edge, except on a disabled, read-only or invalid control.
- `disabled`, `readonly` and `aria-disabled="true"` show the disabled fill and stop pointer events.
- `aria-invalid="true"` and `:user-invalid` draw the destructive edge. `:user-invalid` waits until the user has interacted, so a required empty field is not red on first paint.
- Focus shows the ring colour (`--ring`) as the outline.

## Accessibility

- Every control needs a `<label for>` or `aria-label`.
- Link the hint and the error with `aria-describedby`, and set `aria-invalid="true"` when the error shows.
- The star and "(optional)" are drawn by CSS with empty alt text (`content: " *" / ""`), so they stay out of the label's accessible name: a screen reader says "Email", not "Email star". Say that a field is required with `required` or `aria-required="true"` on the input, or in the label text.

## Theming

Reads roles and scale steps from `variables` (`--surface`, `--input`, `--input-hover`, `--destructive`, `--destructive-subtle-fg`), so `data-theme`, `.dark` and `.light` recolor it. The spacing, type sizes and control height Tailwind owns are declared on the classes as `--ds-*` with the same values. A test holds the look equal to the Tailwind field in light and dark, in the default and example themes.
