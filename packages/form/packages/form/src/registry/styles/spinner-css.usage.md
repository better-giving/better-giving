# spinner-css

Registry item `spinner-css` (files: `styles/spinner-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the React `spinner` item.

## Markup contract

Import `styles/variables.css` and `styles/spinner-css.css`.

```html
<div role="status" aria-live="polite" style="display: flex; align-items: center; gap: 0.5rem">
  <span class="ds-spinner" aria-hidden="true"></span>
  Loading campaigns...
</div>

<span class="ds-spinner ds-spinner-sm" aria-hidden="true"></span>
```

- `ds-spinner` is the ring: an `inline-block` 20px circle, a 2px gray-6 ring with a `--primary` arc, turning every 0.8s, linear. Beside a line of text, put both in a flex row with `align-items: center`, as above: an inline ring sits on the text's baseline and rides above the line's middle.
- `ds-spinner-sm` on the same element makes it 14px.
- `ds-state-card-spinner` and `ds-video-frame-spinner` draw the same 20px ring: they are the names `state-card-css` and `video-frame-css` 1.0 gave it, kept so markup written against them still draws it. New markup writes `ds-spinner`.

## States

Under `prefers-reduced-motion` the ring stands still (`animation: none`): a loop at a collapsed duration would jitter rather than stop. Under forced colors (Windows High Contrast) the ring is drawn in `CanvasText` and the arc in `Highlight`.

## Accessibility

The ring is `aria-hidden`; the line beside it, in a `role="status"` region, is what is announced.

## Theming

Reads `--gray-6` and `--primary` from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step and the loop Tailwind owns are declared on the class as `--ds-*` with the same values; the stylesheet carries its own `ds-spin` keyframes, the same turn as Tailwind's `spin` under a prefixed name, so a host's own keyframes cannot collide. The sizes are in rem, so the ring follows the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note).
