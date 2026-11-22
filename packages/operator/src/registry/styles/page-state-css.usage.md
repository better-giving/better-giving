# page-state-css

Registry item `page-state-css` (files: `styles/page-state-css.css`; depends on `variables`, `spinner-css` and `bare-icon-button-css`). Plain CSS: no Tailwind, no React. The look of the `page-state` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/spinner-css.css` (the loading ring), `styles/bare-icon-button-css.css` (the reference's copy button) and `styles/page-state-css.css`, with `styles/button-css.css` and `styles/text-button-css.css` for the actions.

```html
<div class="ds-page-state ds-page-state-error">
  <p class="ds-page-state-code">500</p>
  <div class="ds-page-state-message" role="alert">
    <h1 class="ds-page-state-title" tabindex="-1">Something went wrong</h1>
    <p class="ds-page-state-body">This page could not load. Nothing was lost.</p>
  </div>
  <div class="ds-page-state-actions">
    <button type="button" class="ds-btn ds-btn-primary">Try again</button>
    <button type="button" class="ds-btn ds-btn-secondary">Contact support</button>
  </div>
  <p class="ds-page-state-ref">
    Reference <span class="ds-page-state-ref-value">8F2C-41AA</span>
    <button type="button" class="ds-icon-bare ds-icon-bare-sm" aria-label="Copy reference"><svg aria-hidden="true">…</svg></button>
    <span role="status" class="…visually hidden…"></span>
  </p>
</div>

<div class="ds-page-state">
  <h2 class="ds-page-state-title" tabindex="-1">No campaigns yet</h2>
  <p class="ds-page-state-body">Campaigns you create show up here.</p>
  <div class="ds-page-state-actions"><button type="button" class="ds-btn ds-btn-primary">Create a campaign</button></div>
  <p class="ds-page-state-aside"><button type="button" class="ds-text-btn ds-text-btn-primary">How campaigns work</button></p>
</div>

<div class="ds-page-state ds-page-state-loading" role="status" aria-live="polite">
  <span class="ds-spinner" aria-hidden="true"></span>
  <span>Loading campaigns…</span>
</div>
```

- `ds-page-state`: a column that centres its content in what the user sees, a little above the middle: the first child's top margin and the last child's bottom margin are `auto`, `align-items: safe center`, and content taller than the view starts at the top. The view is the viewport below the bar: on a bare page `min-block-size` is `calc(100svh - var(--ds-bar-h, 0px))`, and in an app shell's `<main>`, which sets `--ds-page-min: 0px` and `--ds-view-h` (`100dvh` less the bar), `flex: 1` takes the rest of the page. 56px above, 56px plus `--ds-view-lift` (0.2, declared by `variables`; fallback 0.2) of the view's height below (the block's middle sits at 40% of the view, between 38% and 42%), 20px at the sides, its parts 8px apart, `--gray-11`.
- `ds-page-state-code`: the 12px mono code, on the error states only (404, 403, 500); empty and filtered states have none.
- `ds-page-state-title`: an `h1` where the state is the page, an `h2` under the page's own header; the display face, bold, 24px, `--gray-12`, `tabindex="-1"` so script can focus it on a route change (it draws no ring then).
- `ds-page-state-body`: 16px, 28rem at most. A command or value in it is a `<code>`: mono at 0.875em on `--gray-3`, gray-12, 2px by 6px, the control corner. A long command wraps, with the corner and padding repeated on each wrapped line, and one press selects all of it to copy.
- `ds-page-state-error` on the root: the 500. The title takes `--destructive-subtle-fg` and the body `--gray-12`.
- `ds-page-state-message`: on the 500, the title and the body in a `role="alert"` wrapper, 8px apart as everywhere else. The code, the actions, the reference and its status stay outside it, so they are not read as part of the alert and "Copied" or a retry does not set it off again.
- `ds-page-state-actions`: the buttons, 16px further down, 12px apart, wrapping.
- `ds-page-state-aside`: one text button on its own 14px row, 4px under the actions.
- `ds-page-state-ref` holding `ds-page-state-ref-value`: the 500's reference in 12px mono, the value selected whole by one press, and a 16px `ds-icon-bare ds-icon-bare-sm` copy button (lucide's `copy`).
- `ds-page-state-loading` on the root, with `role="status"` and `aria-live="polite"`: a `ds-spinner` and its 14px line.

## Behavior

No script ships with the item. The page wires the copy (write the value to the clipboard, doing nothing where `navigator.clipboard` is absent, as off a secure origin; on success set `data-done="true"` on the button for 2000ms, with the check glyph, and write "Copied" into a visually hidden `role="status"` beside it), `aria-busy="true"` on the root while a retry runs, and focus to the title when a navigation lands on the state. Write the loading line into the status region after it is on the page, so it is announced.

## Accessibility

- The 500's title and body are an alert; loading is a polite status; the others have no live role, and focusing the title is how a screen reader finds them after a navigation.
- The copy button is named by `aria-label`.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weight and the tracking Tailwind owns are declared on `ds-page-state` as `--ds-*` with the same values; the sizes are in rem, so the state follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `PageState` in light and dark, in the default and the example themes, wide and at 375.
