# field-css

Registry item `field-css` (files: `styles/field-css.css`; depends on `variables` and `button-css`). Plain CSS: no Tailwind. The look of the `input` item's field: container, label, hints, input, error and warning, the mono box and the row of buttons.

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
- `ds-field-err`: the message under the control, 4px below it, starting at the control's start edge (`text-align: start`). When it is empty it takes no room.
- `ds-field-warn`: a message that does not block, in the same slot as the error: warning ink and a 12px mark, the edge unchanged, never `aria-invalid`. Show one message at a time; when there is an error, leave the warning out. When it is empty it takes no room but stays rendered, so it stays a live region.
- `ds-field-help`: the hint under the control, 4px below the message (or the input), small and muted. When it is empty it takes no room.
- `ds-field-input-mono`: with `ds-field-input`, for a key, secret or id: the mono face, no ligatures, an ellipsis when it overflows, the same size. Read-only keeps the muted fill and takes full ink.
- `ds-sr-only`: text for assistive technology only, such as the "Warning: " before a warning.
- The label, the hint and both error classes set their own margins, so a `<p>` or `<label>` renders the same with or without a CSS reset.
- `ds-field-error`: the same message taken out of the flow, over the field's bottom edge, on the input's start edge. The container needs `position: relative`.

## A message and a hint

```html
<div class="ds-field">
  <label class="ds-label" for="slug">Campaign link</label>
  <input class="ds-field-input" id="slug" name="slug"
         aria-describedby="slug-err slug-warn slug-help">
  <p class="ds-field-err" id="slug-err"></p>
  <p class="ds-field-warn" id="slug-warn" aria-live="polite"><svg aria-hidden="true"><!-- a warning triangle --></svg><span><span class="ds-sr-only">Warning: </span>A campaign with this link ended in 2025.</span></p>
  <p class="ds-field-help" id="slug-help">Letters, numbers and dashes. It ends your public link.</p>
</div>
```

The message comes first and the hint under it, in the markup, on screen and in `aria-describedby`. Keep the warning's paragraph in the page while it is empty and fill it when the warning applies, so the polite live region reads it out.

## Errors stay with their input

An error sits directly under the input it belongs to, inside that input's column, aligned to the input's start edge. When a field shares a row with buttons, the row holds only the input and the buttons; the error and the hint go under the input, never under the row.

For a control with buttons beside it, put the row inside the field and the control in its own column; the hint and the error go in that column, under the input:

```html
<div class="ds-field">
  <label class="ds-label" for="link">Paste a link</label>
  <div class="ds-field-row">
    <div class="ds-field-control">
      <input class="ds-field-input" id="link" name="link" type="url"
             aria-describedby="link-err" aria-errormessage="link-err" aria-invalid="true">
      <p class="ds-field-err" id="link-err">Enter a full address.</p>
    </div>
    <div class="ds-field-action">
      <button type="button" class="ds-btn ds-btn-primary ds-btn-field">Add</button>
    </div>
  </div>
</div>
```

- `ds-field-row`: the row, `[control][action]`, wrapping.
- `ds-field-control`: the control's column. It takes the free width, and the input, the message and the `ds-field-help` all go inside it.
- `ds-field-action`: the button or buttons. Give each `ds-btn-field` (needs `button-css`) so it keeps the control's height. When `ds-field-row` is under 384px wide (its own width, not the viewport's, so a field in any container that narrow wraps too, and a dialog or a form column wider than that does not) the column takes the whole row, so the action wraps under the control. With two or more `ds-btn` buttons the row wraps under 576px (36rem), the buttons start-aligned under the input in DOM order; narrower than the buttons themselves, they wrap among themselves. The row takes its width from its parent, never its content: inside a shrink-to-fit parent such as an auto-width flex item, give the field a width.
- Anything else in `ds-field-action` (a status region) goes after the buttons and is not a `ds-btn`.
- The label stays above the row. A hint under the label goes between the label and the row.

## Copy and a done hold

A copy button is a secondary `ds-btn-field` with `data-done="false"`: the row reserves the width of its done label, so "Copied" does not shift the row. A `role="status"` region after the buttons reads the outcome out. On a successful copy set `data-done="true"`, swap the mark and the label, and fill the status; after 2000ms put all three back. The done look of `[data-done="true"]` comes from `button-css`.

```html
<div class="ds-field-action">
  <button type="button" class="ds-btn ds-btn-secondary ds-btn-field" data-done="false">Copy</button>
  <button type="button" class="ds-btn ds-btn-destructive-outline ds-btn-field">Regenerate</button>
  <span class="ds-sr-only" role="status"></span>
</div>
```

```js
button.addEventListener("click", async () => {
  await navigator.clipboard.writeText(input.value);
  button.dataset.done = "true";
  label.textContent = "Copied";
  status.textContent = "Copied to clipboard";
  setTimeout(() => {
    button.dataset.done = "false";
    label.textContent = "Copy";
    status.textContent = "";
  }, 2000);
});
```

Not included: the floating label and the select and table classes of `tokens`.

## States

- Hover darkens the edge, except on a disabled, read-only or invalid control.
- `disabled`, `readonly` and `aria-disabled="true"` show the disabled fill. `disabled` and `aria-disabled="true"` also stop pointer events; `readonly` stays selectable and copyable, with a text cursor and focus, and only its hover edge is withheld.
- `aria-invalid="true"` and `:user-invalid` draw the destructive edge. `:user-invalid` is the browser's own check of the native constraints (`required`, `step`, `min`, `max`, `pattern`), and it waits until the user has changed the value and left the field, so a required empty field is not red on first paint.
- `data-manual-invalid` on the input opts the field out of `:user-invalid`: it never takes the invalid look from the browser's check, and hover still darkens its edge. `aria-invalid="true"` still wins and draws the destructive edge. It works on `ds-field-input` and on the input inside `ds-field-input-container`. Use it when the constraint is not the field's rule, as on a money field that rounds a third decimal, which `step="0.01"` marks invalid; the field sets `aria-invalid="true"` itself when its own check fails:

```html
<input class="ds-field-input" id="amount" name="amount" type="number" step="0.01"
       data-manual-invalid aria-describedby="amount-err">
```
- Focus shows the ring color (`--ring`) as the outline.

## Accessibility

- Every control needs a `<label for>` or `aria-label`.
- Link the message and the hint with `aria-describedby`, message first, and set `aria-invalid="true"` when the error shows, never for a warning.
- Give a mono input `spellcheck="false"`, `autocomplete="off"` and `autocapitalize="off"`.
- The star and "(optional)" are drawn by CSS with empty alt text (`content: " *" / ""`), so they stay out of the label's accessible name: a screen reader says "Email", not "Email star". Say that a field is required with `required` or `aria-required="true"` on the input, or in the label text.

## Theming

Reads roles and scale steps from `variables` (`--surface`, `--input`, `--input-hover`, `--destructive`, `--destructive-subtle-fg`, `--warning-subtle-fg`, `--gray-11`, `--gray-12`, `--font-mono`), so `data-theme`, `.dark` and `.light` recolor it. The spacing, type sizes and control height Tailwind owns are declared on the classes as `--ds-*` with the same values. They are in rem, so the field follows the reader's browser font size, while its edge and ring stay in px. A test holds the look equal to the Tailwind field in light and dark, in the default and example themes. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The 24rem and 36rem container-query widths at which the row wraps stay in rem, since a `@container` condition cannot read a custom property; under a host root of another size they move with it. The corner comes from `variables` and stays in rem.
