# state-card-css

Registry item `state-card-css` (files: `styles/state-card-css.css`; depends on `variables`, `button-css` and `spinner-css`). Plain CSS: no Tailwind. The look of the React `state-card` item.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css`, `styles/spinner-css.css` and `styles/state-card-css.css`.

```html
<div class="ds-state-card">
  <p class="ds-state-card-title">No campaigns yet</p>
  <div class="ds-state-card-body">Campaigns you create show up here with their progress.</div>
  <div class="ds-state-card-action"><a class="ds-btn ds-btn-primary" href="/campaigns/new">Create a campaign</a></div>
</div>

<div class="ds-state-card ds-state-card-loading" role="status" aria-live="polite">
  <span class="ds-spinner" aria-hidden="true"></span>
  <span aria-hidden="true">Loading campaigns...</span>
  <span class="ds-state-card-read"></span>
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
- `ds-state-card-loading` sets its line at 14px, beside spinner-css's `ds-spinner`, a 20px gray-6 ring with a `--primary` arc turning every 0.8s. Markup written against 1.0, with `ds-state-card-spinner`, still draws it: spinner-css keeps that name.
- `ds-state-card-error` takes the `--destructive-subtle` fill and a destructive-6 edge; its title is `--destructive-subtle-fg` and its sentence gray-12.

## States

Empty draws the title, and a sentence and the one primary action when there are some. Loading always draws its line. Error is titled "Something went wrong"; draw the retry only when something can retry. Under `prefers-reduced-motion` the spinner stands still (`animation: none`). Under forced colors (Windows High Contrast) its ring is drawn in `CanvasText` and its arc in `Highlight`.

## Accessibility

- Loading is `role="status"` with `aria-live="polite"`; error is `role="alert"`; empty has no live role.
- Loading holds its line twice. The drawn line is `aria-hidden`, so it can be in the page's first markup. The read copy goes in the empty `ds-state-card-read` span, which is visually hidden, after the card is in the page: a live region announces a change inside it, not the text it arrived holding, so copy written in with the card is never read. Write the same words into it from your script once the card has rendered (`card.querySelector(".ds-state-card-read").textContent = "Loading campaigns..."`). The spinner is `aria-hidden` too.
- Swap one card for the next as the load moves on, rather than changing a card's role in place.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, weight and column width Tailwind owns are declared on the classes as `--ds-*` with the same values; the ring and its loop are spinner-css's. The spacing step, type sizes and column width are in rem, so the states follow the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The corner comes from `variables` and stays in rem.
