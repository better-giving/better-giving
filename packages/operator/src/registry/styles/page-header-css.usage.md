# page-header-css

Registry item `page-header-css` (files: `styles/page-header-css.css`; depends on `variables`, `lead-css`, `top-bar-css`, `button-css` and `menu-css`). Plain CSS: no Tailwind, no React. The look of the `page-header` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/lead-css.css`, `styles/top-bar-css.css` (for `ds-crumbs`), `styles/button-css.css` and `styles/menu-css.css` (the actions and More's menu) and `styles/page-header-css.css`, with `styles/badge-css.css` for a status.

```html
<header class="ds-page-header">
  <nav class="ds-crumbs" aria-label="Breadcrumb">…</nav>
  <div class="ds-page-header-row">
    <div class="ds-page-header-text">
      <div class="ds-page-title-row ds-lead-row">
        <h1 class="ds-page-title">Spring clean-up fund</h1>
        <span class="ds-lead-1lh"><span class="ds-badge ds-badge-success">Live</span></span>
      </div>
      <p class="ds-page-desc">Ends 30 Nov · 13 supporters</p>
    </div>
    <div class="ds-page-actions">
      <a class="ds-btn ds-btn-secondary ds-ph-secondary" href="/campaigns/spring/preview">Preview</a>
      <div class="ds-ph-primary"><button type="button" class="ds-btn ds-btn-primary">Publish</button></div>
      <button type="button" class="ds-btn ds-btn-secondary ds-btn-icon" aria-label="More actions"
              aria-haspopup="menu" aria-expanded="false">…</button>
    </div>
  </div>
  <div class="ds-page-tabs">
    <div class="ds-page-tablist" role="tablist" aria-label="Campaign sections">
      <button type="button" role="tab" class="ds-page-tab" aria-selected="true">Overview</button>
      <button type="button" role="tab" class="ds-page-tab" aria-selected="false" tabindex="-1">Updates</button>
    </div>
  </div>
</header>
```

- `ds-page-header`: the header, its parts 12px apart. Every part but the title is optional; leave out what you do not have.
- `ds-crumbs` (from `top-bar-css`): the pages above, the current one last, cut with an ellipsis.
- `ds-page-header-row`: the title block and the actions, 24px apart; the actions wrap under the title when the row runs out of room.
- `ds-page-header-text`: the title row and the line under it, 4px apart.
- `ds-page-title-row`, with `ds-lead-row`: carries the title's size, 30px (24px under 40rem), so the status's `ds-lead-1lh` box is one of its lines and the status sits on the title's first line, right after it.
- `ds-page-title`: the `h1`, the display face, bold, on the tight tracking, wrapping balanced.
- `ds-page-desc`: the line under it, 16px (14px under 40rem) in `--gray-11`, 44rem at most.
- `ds-page-actions`: the secondary buttons (`ds-ph-secondary`), the primary in a `ds-ph-primary` wrapper, and More, a secondary icon button (`ds-btn ds-btn-secondary ds-btn-icon`, lucide's `ellipsis`) that opens a `ds-menu`. Under 40rem the `ds-ph-secondary` buttons leave (the hide is scoped to `.ds-page-actions`, so it holds whichever stylesheet loads last) and the primary fills the row beside More: list those actions first in the More menu, above its own rows and ahead of the destructive one, and show More whenever it has rows.
- `ds-page-tabs`, holding a `ds-page-tablist` of `ds-page-tab` buttons: the page's sections, 16px under the title and actions (the header's 12px gap and 4px more). The selected tab (`aria-selected="true"`) is underlined 2px in `--primary` and inked `--accent-11`; the others are `--gray-11`, `--gray-12` hovered where the pointer can hover; a disabled one is at opacity .6. The row scrolls sideways when it runs out of room, and under 40rem its end fades out over 28px (the left end under `dir="rtl"`). The row is padded 4px (negative margins take it back), so a tab's ring is drawn whole. Its hairline is the header's only rule. The registry has no plain-CSS tabs item; this is the React `tabs` item's look, held to it by this item's test.

## Behavior

No script ships with the item. The tab row is the WAI-ARIA tabs pattern: one tab stop on the selected tab, the arrow keys move between tabs and skip a disabled one, each `tabpanel` named by its tab. The More menu's behavior and its portal are the page's, as the `menu-css` note says; under 40rem (`matchMedia("(width < 40rem)")`) put the secondary actions in it.

## Accessibility

- One `h1`, the title; the status reads after it, in source order.
- The More button carries `aria-haspopup="menu"` and `aria-expanded`.
- The secondary buttons are `display: none` under 40rem, where their actions are the menu's rows instead, so each is reached once.
- Focus on a tab shows the 2px `--ring` outline 2px out.
- Under forced colors the selected `ds-page-tab` keeps its underline in `Highlight` and the others take `Canvas`.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weights, the tracking and the easing Tailwind owns are declared on `ds-page-header` as `--ds-*` with the same values; the sizes are in rem, so the header follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 40rem breakpoint stays in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `PageHeader` and `Tabs` in light and dark, in the default and the example themes, wide and at 375.
