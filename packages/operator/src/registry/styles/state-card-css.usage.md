# state-card-css

Registry item `state-card-css` (files: `styles/state-card-css.css`; depends on `variables` and `button-css`). Plain CSS: no Tailwind. The look of the React `state-card` item.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css` and `styles/state-card-css.css`.

```html
<div class="ds-state-card">
  <p class="ds-state-card-title">No campaigns yet</p>
  <div class="ds-state-card-body">Campaigns you create show up here with their progress.</div>
  <div class="ds-state-card-action"><a class="ds-btn ds-btn-primary" href="/campaigns/new">Create a campaign</a></div>
</div>

<div class="ds-state-card ds-state-card-loading" role="status" aria-live="polite">
  <span class="ds-state-card-spinner" aria-hidden="true"></span>
  Loading campaigns...
</div>

<div class="ds-state-card ds-state-card-error" role="alert">
  <p class="ds-state-card-title">Something went wrong</p>
  <div class="ds-state-card-body">We couldn't load your campaigns. Check your connection and try again.</div>
  <button type="button" class="ds-btn ds-btn-secondary ds-state-card-action">Try again</button>
</div>
```

- `ds-state-card` is the card: a centered column, 8px gap, 32px by 16px padding, the `--card` fill, a `--hairline` edge, the card corner, the full width of its container.
- `ds-state-card-title` is the title, gray-12 at 16px semibold; `ds-state-card-body` a sentence, 14px, up to 28rem wide.
- `ds-state-card-action` puts an action or a retry a further 8px down: on a wrapper round the action, or on the button itself.
- `ds-state-card-loading` sets its line at 14px, beside `ds-state-card-spinner`, a 20px gray-6 ring with a `--primary` arc turning every 0.8s.
- `ds-state-card-error` takes the `--destructive-subtle` fill and a destructive-6 edge; its title is `--destructive-subtle-fg` and its sentence gray-12.

## States

Empty draws the title, and a sentence and the one primary action when there are some. Loading always draws its line. Error is titled "Something went wrong"; draw the retry only when something can retry. Under `prefers-reduced-motion` the spinner stands still (`animation: none`). Under forced colors (Windows High Contrast) its ring is drawn in `CanvasText` and its arc in `Highlight`.

## Accessibility

- Loading is `role="status"` with `aria-live="polite"`, the spinner `aria-hidden`; error is `role="alert"`; empty has no live role.
- Swap one card for the next as the load moves on, rather than changing a card's role in place.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, weight, column width and the spinner's loop Tailwind owns are declared on the classes as `--ds-*` with the same values; the stylesheet carries its own `ds-spin` keyframes, the same turn as Tailwind's `spin` under a prefixed name, so a host's own keyframes cannot collide. The spacing step, type sizes and column width are in rem, so the states follow the reader's browser font size.
