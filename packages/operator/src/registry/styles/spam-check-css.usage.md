# spam-check-css

Registry item `spam-check-css` (files: `styles/spam-check-css.css`; depends on `variables`, `field-css`, `spinner-css` and `text-button-css`). Plain CSS: no Tailwind, no React. The look of the `spam-check` item; the page runs the provider and its script.

## Markup contract

Import `styles/variables.css`, `styles/field-css.css`, `styles/spinner-css.css`, `styles/text-button-css.css` and `styles/spam-check-css.css`.

```html
<div class="ds-spam-slot">
  <div class="ds-spam-check" data-state="unverified" tabindex="-1">
    <span class="ds-spam-check-target">
      <input type="checkbox" class="ds-spam-check-box" id="human"
             aria-describedby="human-err">
      <label class="ds-spam-check-hit" for="human" aria-hidden="true"></label>
    </span>
    <label class="ds-spam-check-label" for="human">I'm not a robot</label>
    <span class="ds-spam-check-by">Protected by <a href="https://altcha.org/">ALTCHA</a></span>
  </div>
  <p class="ds-field-err" id="human-err" role="alert"></p>
  <p class="ds-sr-only" role="status"></p>
  <p class="ds-sr-only" role="alert"></p>
</div>
```

- `ds-spam-slot`: the form's last block before the actions, the full width of the form column; the box, then the message, 4px apart.
- `ds-spam-check`: the box, at least 65px tall (4.0625rem, Turnstile's height) so mounting the widget does not move the page: a 1px `--input` edge on `--surface`, the control corner, 12px by 16px padding, `text-sm`, its parts 12px apart. A direct `svg` child is the 20px glyph that stands in for the checkbox once it is pressed (lucide `circle-check` verified, `circle-x` failed); while checking, a `spinner-css` `ds-spinner` stands there.
- `ds-spam-check-target`: holds the box and its hit area, in the box's place in the row.
- `ds-spam-check-box`: the 22px native checkbox, `--input` edge (`--input-hover` hovered), the house ring on focus.
- `ds-spam-check-hit`: the box's hit area, an empty `aria-hidden` `<label>` whose `for` names the box, at least `--ds-hit-target` square (24px, 44px on a coarse pointer), centred on the box, which keeps its drawn size; the row leaves room for it. A label, not a `::after` on the `<input>`, which Firefox does not draw.
- `ds-spam-check-label`: the line, weight 500, taking the free width. A Try again or Reload `ds-text-btn ds-text-btn-destructive` goes inside it, after the line.
- `ds-spam-check-by`: the provider's line at the end, `text-xs` gray-11, its link `--link` at weight 600. Under 768px it wraps under the label, on the label's start edge. Alone in the slot (`invisible` providers) it sits on the start edge.
- `ds-spam-widget`: a box for a widget that draws itself (Turnstile's iframe, ALTCHA's element) in place of `ds-spam-check`; it keeps the 65px.
- The message under the slot is `field-css`'s `ds-field-err`; `ds-sr-only` is field-css's too.

## States

Set `data-state` on `ds-spam-check`:

- `unverified`: the checkbox, the label, the provider's line.
- `verifying`: the `ds-spinner` in place of the checkbox and the line in gray-11; add `aria-busy="true"`.
- `verified`: `--success-subtle` fill, `--success-6` edge, `--success-subtle-fg` ink, with the `circle-check` glyph.
- `error`: `--destructive-subtle` fill, `--destructive-6` edge, `--destructive-subtle-fg` ink, the `circle-x` glyph and Try again.
- `expired`: the unverified look with "Verification expired. Check the box again."
- `unavailable` (the script was blocked or failed): the error look, "The check couldn't load." and Reload.
- `data-invalid` (sent before a pass): the `--destructive` edge. Write "Confirm you're not a robot before sending." into the `ds-field-err`, set `aria-invalid="true"` on the checkbox and move focus to it. Never disable the send button.

## Accessibility

- Name the checkbox with its `<label for>`; keep glyphs `aria-hidden`.
- When the checkbox is replaced and it had focus, move focus to what the new state offers (the checkbox again, Try again, Reload) or to the box itself (`tabindex="-1"`).
- Keep the two `ds-sr-only` regions mounted and write into them only on a change: the status for checking, verified and expired, the alert for a failure.
- Load the provider's script on the first `focusin` inside the form, once, so a form nobody touches pays nothing.

## Theming

Reads roles from `variables` (`--surface`, `--input`, `--input-hover`, `--gray-11`, `--gray-12`, `--success-subtle`, `--success-6`, `--success-subtle-fg`, `--destructive-subtle`, `--destructive-6`, `--destructive-subtle-fg`, `--destructive`, `--ring`, `--link`, `--radius`), so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes and weights Tailwind owns are declared on the classes as `--ds-*` with the same values. Those sizes are in rem, so the box and its text follow the reader's browser font size, while its edges stay in px. Each rem size is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 48rem query width stays in rem, since a media condition cannot read a custom property. The ALTCHA variable mapping for a widget in `ds-spam-widget` is in the `spam-check` note; check the names against the version you install.
