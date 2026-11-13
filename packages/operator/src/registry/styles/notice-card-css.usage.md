# notice-card-css

Registry item `notice-card-css` (files: `styles/notice-card-css.css`; depends on `variables` and `button-css`). Plain CSS: no Tailwind. The look of the React `notice-card` item.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css` and `styles/notice-card-css.css`.

```html
<section class="ds-notice-card ds-notice-card-warning" aria-labelledby="expiry-title">
  <span class="ds-notice-card-icon">
    <!-- lucide TriangleAlert, width="20" height="20", aria-hidden="true" -->
  </span>
  <div class="ds-notice-card-content">
    <div class="ds-notice-card-text">
      <p class="ds-notice-card-title" id="expiry-title">This connection expires in 3 days</p>
      <div class="ds-notice-card-body">Reconnect before then or new gifts will stop syncing.</div>
    </div>
    <div class="ds-notice-card-actions">
      <button type="button" class="ds-btn ds-btn-secondary">Remind me later</button>
      <button type="button" class="ds-btn ds-btn-primary">Reconnect</button>
    </div>
  </div>
</section>
```

- `ds-notice-card` is the card: 24px padding (16px under 640px), a 1px tone edge, the card corner, the tone fill and gray-12 text. Add one tone class: `ds-notice-card-info` (Info glyph), `ds-notice-card-success` (CircleCheck), `ds-notice-card-warning` (TriangleAlert) or `ds-notice-card-destructive` (CircleAlert).
- Each tone class sets `--ds-tone-fill`, `--ds-tone-edge` and `--ds-tone-ink`: `--secondary`, accent-6 and accent-11 for info; `--success-subtle`, success-6 and success-11; `--warning-subtle`, warning-6 and warning-11; `--destructive-subtle`, destructive-6 and destructive-11.
- `ds-notice-card-icon` is the glyph's 24px-high box in the tone ink, so a 20px glyph lines up with the title's first line.
- `ds-notice-card-content` holds `ds-notice-card-text` (the title and body, 4px apart) and `ds-notice-card-actions` 16px under it.
- `ds-notice-card-title` is 16px semibold; `ds-notice-card-body` 14px.
- `ds-notice-card-actions` sets the buttons right-aligned side by side from 640px and stacks them at full width under it. Leave it out when there are none. On the destructive tone the confirm is `ds-btn-destructive`.

## Accessibility

- `aria-labelledby` names the card by its title; the glyph is `aria-hidden`.
- A card your script inserts after load takes `role="status"` (info, success) or `role="alert"` (warning, destructive); one on the page from the start takes neither.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes and weight Tailwind owns are declared on the classes as `--ds-*` with the same values. The spacing step and type sizes are in rem, so the card follows the reader's browser font size.
