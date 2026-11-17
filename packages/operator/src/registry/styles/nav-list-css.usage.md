# nav-list-css

Registry item `nav-list-css` (files: `styles/nav-list-css.css`; depends on `variables`, `lead-css` and `badge-css`). Plain CSS: no Tailwind, no build step. The look of the `nav-list` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/lead-css.css`, `styles/badge-css.css` and `styles/nav-list-css.css`.

The sidebar's rows, in groups:

```html
<nav class="ds-nav-list" aria-label="Sidebar">
  <ul class="ds-nav-group">
    <li>
      <a class="ds-nav-link" href="/inbox">
        <svg aria-hidden="true">…</svg>
        <span class="ds-nav-label ds-lead-row">
          <span>Inbox</span>
          <span class="ds-lead-1lh"><span class="ds-badge">12</span></span>
        </span>
        <span class="ds-nav-dot" aria-hidden="true"></span>
      </a>
    </li>
    <li><a class="ds-nav-link" href="/campaigns" aria-current="page">…</a></li>
  </ul>
  <div class="ds-nav-group" role="group" aria-labelledby="nav-manage">
    <h2 class="ds-nav-title" id="nav-manage">Manage</h2>
    <ul>…</ul>
  </div>
</nav>
```

A parent row over a section's pages (Settings over Profile, Page, …), in a group's `<ul>`:

```html
<li>
  <a class="ds-nav-link ds-nav-parent" href="/settings/profile" aria-expanded="true" aria-controls="settings-sections">
    <svg aria-hidden="true">…</svg>
    <span class="ds-nav-label ds-lead-row"><span>Settings</span></span>
    <svg class="ds-nav-chev" aria-hidden="true">…chevron-right…</svg>
  </a>
  <ul class="ds-nav-sub" id="settings-sections" aria-label="Settings sections">
    <li><a class="ds-nav-link ds-nav-sublink" href="/settings/profile" aria-current="page"><svg aria-hidden="true">…</svg><span class="ds-nav-label ds-lead-row"><span>Profile</span></span></a></li>
    …
  </ul>
</li>
```

A page's own section nav:

```html
<nav class="ds-nav-list ds-nav-list-section" aria-label="Settings sections">
  <ul>
    <li><a class="ds-nav-link" href="/settings/profile" aria-current="page"><span class="ds-nav-label ds-lead-row"><span>Profile</span></span></a></li>
    …
  </ul>
</nav>
```

- `ds-nav-list`: the `<nav>`, groups 20px apart. Name it with `aria-label`.
- `ds-nav-group`: a list of rows 2px apart, as a `<ul>`, or a `role="group"` wrapper holding a `ds-nav-title` heading (an `h2` naming the group: 12px, bold, uppercase on the label tracking, `--gray-11`) and its `<ul>`.
- `ds-nav-link`: a row, 36px (2.25rem) at least: 8px by 12px, 14px medium `--gray-12`, the 6px corner. A lucide glyph as its first child, an `<svg aria-hidden="true">`, is 16px in the label's ink, centred on the label's first line, 12px before it.
- `ds-nav-label`: the label, taking the rest of the row. Give it `ds-lead-row` too, so a count in a `ds-lead-1lh` box (a `ds-badge`) sits on the label's first line at the row's end when the label wraps. Draw the count only when it is above 0.
- `ds-nav-parent`: on a `ds-nav-link` to the parent's first child: a parent row over its children. Give it `aria-expanded` and `aria-controls` (the list's id); the page renders `aria-expanded="true"` while one of its children is the page and `"false"` otherwise, from the route alone: a press follows the link and toggles nothing. Open, it is 600 with no fill; its last child, a 16px chevron-right glyph with `ds-nav-chev`, turns down (it is mirrored under `dir="rtl"` while closed).
- `ds-nav-sub`: the parent's children, a `<ul>` right after the parent's link, named with `aria-label` ("Settings sections": a named list, not a second landmark). Rows 2px apart, 4px under the parent, with no indent, no padding and no edge, so the children's glyphs and labels sit on the top-level rows' edges and their fills are as wide. Hidden while the parent's link says `aria-expanded="false"`; a page that leaves the list out instead drops `aria-controls` with it.
- `ds-nav-sublink`: a child, on a `ds-nav-link`: `--gray-11` glyph and label at rest, `--gray-12` hovered or current.
- `ds-nav-dot`: an 8px `--primary` dot at the row's top end that stands in for the count. It is hidden, and shows under an ancestor with `data-collapsed`: the hook an app shell's icon-only rail uses, which draws the rest of that look (the label and the count out of sight but kept in the accessible name). Draw it with the count, `aria-hidden="true"`.
- `ds-nav-list-section`: the section variant. From 768px its list is the rows above, stacked. Under 768px it is a sideways-scrolling row on a hairline, its end under a 28px fade (the left end under `dir="rtl"`), scrollbar hidden: the `<nav>` scrolls and its list, as wide as its links, draws the hairline, so the current link's underline covers it whole and the row never scrolls up and down; 44px links, 14px semibold `--gray-11`, the current one underlined 2px in `--primary` and inked `--accent-11`, no hover fill.

## States

- Hovered (where the pointer can hover): `--gray-4`, except the current row.
- Current, `aria-current="page"`: `--secondary-active`, hovered too (the section's narrow row: the underline above). `aria-current="true"` fills the same: an icon-only rail's link to a parent whose child is the page (`app-shell-css`).
- Inks: a top-level row and a parent, glyph and label `--gray-12` at rest, hovered or current; a `ds-nav-sublink`, `--gray-11` at rest and `--gray-12` hovered or current; the section variant's glyphs `--gray-11`, `--gray-12` on the current row. In the example theme's dark look a child's resting `--gray-11` on the sidebar's `--card` measures Lc 59.8, a miss pinned by name in the APCA ledger.
- Focus: a 2px `--ring` outline 2px inside the row.

## Accessibility

- Links, not tabs: the current page is `aria-current="page"`. Tab moves through them.
- A link's name is its label and its count; the glyph and the dot are `aria-hidden`.
- A parent is a link with `aria-expanded`; its list is named, so it needs no landmark of its own.
- Under forced colors the current row (`aria-current="page"`, or `"true"`) draws a 2px `Highlight` ring 2px inside in place of its fill, giving way to the focus ring while it has focus. The narrow section row draws no ring: its underline is `Highlight` on the current link and `Canvas` on the others.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The label tracking is `--ds-tracking-label` from `variables`, so an override of that role reaches the group titles too. The spacing step, the type sizes, the weights and the easing Tailwind owns are declared on `ds-nav-list` as `--ds-*` with the same values; the sizes are in rem, so the list follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `NavList` in light and dark, in the default and the example themes, at a desktop and a phone width.
