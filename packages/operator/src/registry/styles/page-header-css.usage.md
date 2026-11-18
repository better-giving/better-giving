# page-header-css

Registry item `page-header-css` (files: `styles/page-header-css.css`; depends on `variables`, `lead-css`, `top-bar-css`, `field-css`, `button-css` and `menu-css`). Plain CSS: no Tailwind, no React. The look of the `page-header` item for a page that has only `variables`.

**No visible page title.** The tab title and the active sidebar row say where the reader is, so a page with a sidebar entry (a top-level page, or a sub-item such as Settings › Profile) shows no title, no status line and no crumbs: its `h1` is in the page, visually hidden (`ds-sr-only`), and the header is one end-aligned row of actions with the tabs under it. A nested or hidden page has a trail and no separate title: the current crumb, at 14px, is the page's one `h1`.

## Markup contract

Import `styles/variables.css`, `styles/lead-css.css`, `styles/top-bar-css.css` (for `ds-crumbs`), `styles/field-css.css` (for `ds-sr-only`), `styles/button-css.css` and `styles/menu-css.css` (the actions and More's menu) and `styles/page-header-css.css`, with `styles/badge-css.css` for a status.

```html
<!-- a nested page -->
<header class="ds-page-header">
  <div class="ds-page-header-row">
    <div class="ds-page-header-text">
      <nav class="ds-crumbs ds-crumbs-heading" aria-label="Breadcrumb">
        <ol>
          <li>
            <a href="/campaigns">Campaigns</a>
            <svg aria-hidden="true">…</svg>
          </li>
          <li>
            <div class="ds-page-title-row ds-lead-row">
              <h1 class="ds-page-title" aria-current="page">Spring clean-up fund</h1>
              <span class="ds-lead-1lh"><span class="ds-badge ds-badge-success">Live</span></span>
            </div>
          </li>
        </ol>
      </nav>
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

<!-- a page with a sidebar entry: no visible title -->
<header class="ds-page-header">
  <h1 class="ds-sr-only">Campaigns</h1>
  <div class="ds-page-header-row">
    <div class="ds-page-actions">…</div>
  </div>
  <div class="ds-page-tabs">…</div>
</header>
```

With no actions and no tabs a page with a sidebar entry has no header at all: only `<h1 class="ds-sr-only">`, so the main area's own gap adds no stray row.

- `ds-page-header`: the header, its parts 12px apart. Every part but the title is optional; leave out what you do not have.
- `ds-page-header-row`: the trail block (the trail and the status line under it) and the actions, 24px apart, the actions centered on that block (on the trail alone when there is no status line); they wrap under it when the row runs out of room. A row with no `ds-page-header-text` (a page with a sidebar entry) puts its actions at the end.
- `ds-page-header-text`: the trail and the status line under it, 4px apart.
- `ds-crumbs ds-crumbs-heading` (from `top-bar-css` 1.1.0): the pages above, each an `<li>` of a link (or plain text for a parent with no link) and a chevron, then a last `<li>` holding the title row, so the current crumb is the `h1`, with `aria-current="page"` on it. Parents are 14px `--gray-11`, a 14px chevron, 8px between link, chevron and name, on first baselines. Nothing folds and nothing is cut: a parent keeps its width on the first line (wrapping inside its link only when it is wider than the line), and a long name wraps hanging under its own first word. The name's item has an 8rem basis, so it drops under the parents when less than that is left on their line. Never put the current page in the parents.
- `ds-page-title-row`, with `ds-lead-row`: no size of its own; it inherits the trail's 14px, so the status's `ds-lead-1lh` box is one of the name's lines and the status sits on its first line, right after it.
- `ds-page-title`: the `h1` in the trail, the body face at 600 in `--gray-12`, wrapping and never cut.
- `ds-page-desc`: the status line under the trail, 14px in `--gray-11`.
- `ds-sr-only` (from `field-css`): the hidden `h1` of a page with a sidebar entry.
- `ds-page-actions`: the secondary buttons (`ds-ph-secondary`), the primary in a `ds-ph-primary` wrapper, and More, a secondary icon button (`ds-btn ds-btn-secondary ds-btn-icon`, lucide's `ellipsis`) that opens a `ds-menu`. Under 40rem the `ds-ph-secondary` buttons leave (the hide is scoped to `.ds-page-actions`, so it holds whichever stylesheet loads last) and the primary fills the row beside More: list those actions first in the More menu, above its own rows and ahead of the destructive one, and show More whenever it has rows.
- `ds-page-tabs`, holding a `ds-page-tablist` of `ds-page-tab` buttons: the page's sections, 16px under the row of actions or the trail (the header's 12px gap and 4px more). The selected tab (`aria-selected="true"`) is underlined 2px in `--primary` and inked `--accent-11`; the others are `--gray-11`, `--gray-12` hovered where the pointer can hover; a disabled one is at opacity .6. The row scrolls sideways when it runs out of room, and under 40rem its end fades out over 28px (the left end under `dir="rtl"`). The row is padded 4px (negative margins take it back), so a tab's ring is drawn whole. Its hairline is the header's only rule. The registry has no plain-CSS tabs item; this is the React `tabs` item's look, held to it by this item's test.

## Migrating from 1.x

2.0.0 has two shapes (React renames `crumbs` to `parents`). Needs `top-bar-css` 1.1.0.

- Pages with a sidebar entry: replace the title row, the line under it and any `nav` with `<h1 class="ds-sr-only">` and, if there are actions, a `ds-page-header-row` holding only `ds-page-actions`; drop the status.
- Nested pages: move the `<nav class="ds-crumbs">` from above `ds-page-header-row` into `ds-page-header-text`, add `ds-crumbs-heading`, and replace the current page's `<li><span aria-current="page">` with an `<li>` holding the title row, so the `h1` is the current crumb (`aria-current="page"` on it). Drop the old title row and the 30px sizes; the status line `ds-page-desc` stays under the trail.
- When the page header shows the trail, the top bar shows only its `ds-topbar-title`: drop the `<nav class="ds-crumbs">` and `ds-topbar-narrow` from `ds-topbar-lead`. A 3.x page that kept both has two `Breadcrumb` navs, the page's name twice and two back controls on a phone.

## Behavior

No script ships with the item. The tab row is the WAI-ARIA tabs pattern: one tab stop on the selected tab, the arrow keys move between tabs and skip a disabled one, each `tabpanel` named by its tab. The More menu's behavior and its portal are the page's, as the `menu-css` note says; under 40rem (`matchMedia("(width < 40rem)")`) put the secondary actions in it.

## Accessibility

- One `h1`, the title, in both shapes: hidden with `ds-sr-only` on a page with a sidebar entry, and the trail's last item, with `aria-current="page"` on it, on a nested page. Without a trail there is no `<nav>` and no `aria-current`. The status reads after the current crumb, in source order.
- Focus on a parent shows the 2px `--ring` outline 2px out; the 8px between link, chevron and name keeps the ring off the chevron.
- The More button carries `aria-haspopup="menu"` and `aria-expanded`.
- The secondary buttons are `display: none` under 40rem, where their actions are the menu's rows instead, so each is reached once.
- Focus on a tab shows the 2px `--ring` outline 2px out.
- Under forced colors the selected `ds-page-tab` keeps its underline in `Highlight` and the others take `Canvas`.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type size and the weight Tailwind owns are declared on `ds-page-header` as `--ds-*` with the same values; the sizes are in rem, so the header follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 40rem breakpoint stays in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `PageHeader` and `Tabs` in light and dark, in the default and the example themes, wide and at 375.
