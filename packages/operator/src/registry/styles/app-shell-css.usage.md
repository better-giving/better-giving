# app-shell-css

Registry item `app-shell-css` (files: `styles/app-shell-css.css`; depends on `variables`, `nav-list-css`, `top-bar-css`, `site-nav-css`, `avatar-css`, `menu-css`, `bare-icon-button-css` and `button-css`). Plain CSS: no Tailwind, no React. The look of the `app-shell` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/lead-css.css`, `styles/badge-css.css`, `styles/nav-list-css.css` (the links), `styles/button-css.css` and `styles/top-bar-css.css` (the bar), `styles/site-nav-css.css` (the skip link's chip), `styles/bare-icon-button-css.css`, `styles/avatar-css.css` and `styles/menu-css.css` (the toggle, the drawer's close, the account and its menu) and `styles/app-shell-css.css`.

```html
<div class="ds-shell">                       <!-- data-collapsed: the rail -->
  <a class="ds-site-nav-skip" href="#main">Skip to content</a>
  <aside class="ds-shell-sidebar" id="sidebar">
    <div class="ds-shell-head">
      <div class="ds-shell-mark"><a href="/" aria-label="Home"><img src="…" alt="" height="36"></a></div>
      <div class="ds-shell-mark-rail"><a href="/" aria-label="Home"><img src="…" alt="" height="36"></a></div>
    </div>
    <nav class="ds-nav-list ds-shell-nav" aria-label="Sidebar">…</nav>
    <div class="ds-shell-account">
      <button type="button" class="ds-shell-account-btn" aria-haspopup="menu" aria-expanded="false">
        <span class="ds-avatar" aria-hidden="true"><span aria-hidden="true">AL</span></span>
        <span class="ds-shell-account-text">
          <span class="ds-shell-account-name">Amara Lindqvist</span>
          <span class="ds-shell-account-org">Greenfield Food Bank</span>
        </span>
        <svg aria-hidden="true">…</svg>
      </button>
    </div>
  </aside>
  <header class="ds-topbar">
    <div class="ds-topbar-lead">
      <button type="button" class="ds-btn ds-btn-ghost ds-btn-icon ds-shell-menu" aria-label="Menu"
              aria-expanded="false" aria-controls="drawer"><svg aria-hidden="true">…</svg></button>
      <button type="button" class="ds-icon-bare ds-shell-toggle" aria-label="Collapse sidebar"
              aria-expanded="true" aria-controls="sidebar"><svg aria-hidden="true">…</svg></button>
      <p class="ds-topbar-title">Greenfield Food Bank</p>
    </div>
    <div class="ds-topbar-actions">…</div>
  </header>
  <main class="ds-shell-main" id="main" tabindex="-1">…</main>
  <dialog class="ds-shell-drawer" id="drawer" aria-label="Menu">
    <div class="ds-shell-head">
      <div class="ds-shell-mark">…</div>
      <button type="button" class="ds-icon-bare" aria-label="Close menu" autofocus>…</button>
    </div>
    <nav class="ds-nav-list ds-shell-nav" aria-label="Sidebar">…</nav>
    <div class="ds-shell-account">…</div>
  </dialog>
</div>
```

- `ds-shell`: the root, a grid at least the viewport tall on `--background`. It declares `--ds-sidebar-w` (16rem), `--ds-sidebar-w-collapsed` (3.5rem) and `--ds-bar-h` (4rem). `data-collapsed` on it is the icon-only rail. Under 48rem it is one column.
- `ds-site-nav-skip` (`site-nav-css`): the skip link, first, hidden until focused, then a chip at the top start; it moves focus to `<main>`.
- `ds-shell-sidebar`: the sidebar, the first column across both rows, the viewport's height and pinned, on `--card` with a 1px `--hairline` end edge. Not drawn under 48rem.
- `ds-shell-head`: the bar's height, 16px in, in the sidebar and in the drawer alike (the drawer declares `--ds-bar-h` too): `ds-shell-mark` (the app's mark, linking home; the registry ships no logo), `ds-shell-mark-rail` (the symbol alone, at most 1.75rem wide and 2.25rem tall, linking home; drawn only in the rail, so the sidebar's copy is never read twice; leave it out when the app has no symbol). The sidebar's head holds nothing else; the drawer's adds its close button.
- `ds-shell-nav`, on the `ds-nav-list` (`nav-list-css`): the links, scrolling their own height, 8px over, 16px under, 12px in.
- `ds-shell-account`: the foot, on a hairline, 12px in. `ds-shell-account-btn` holds a 32px `ds-avatar`, `ds-shell-account-text` (`ds-shell-account-name` 14px semibold, `ds-shell-account-org` 12px `--gray-11`, each on one line) and lucide's `chevrons-up-down`; `--gray-4` hovered where the pointer can hover, `--gray-5` with `aria-expanded="true"`, the ring 2px inside. It opens a `ds-menu` (`menu-css`) above it, starts aligned.
- `ds-shell-toggle` on a 20px `ds-icon-bare` (`bare-icon-button-css`, lucide's `panel-left`) in the bar's `ds-topbar-lead`, after the menu button and before the title: the sidebar's collapse toggle, the bar's first control from 48rem, 12px before the title (the lead's 8px and 4px of its own), in the bell's inks whether the sidebar is open or a rail (`--gray-11`, `--gray-12` hovered): `app-shell-css` outranks `bare-icon-button-css`'s held-open accent and forced-colors ring on `.ds-shell .ds-shell-toggle` alone, so every other `ds-icon-bare` keeps them. Hidden under 48rem, where the menu button takes the bar's start; the hide is scoped to `.ds-shell` like the menu button's.
- `ds-topbar` (`top-bar-css`) as a child of the shell pins at the top. `ds-shell-menu` on a 36px `ds-btn ds-btn-ghost ds-btn-icon` (lucide's `menu`) at the start of its lead: shown under 48rem only. The hide is scoped to `.ds-shell`, so it holds whichever stylesheet loads last; keep the button inside the shell.
- `ds-shell-main`: `<main>`, 24px by 20px, 32px by 40px from 48rem, its blocks 20px apart. It sets `--ds-page-min: 0px` and `--ds-view-h` (`100dvh` less the bar), so a page state in it fills the rest of the page instead of the viewport less the bar.
- `ds-shell-drawer`: a native `<dialog>` holding a second copy of the head (with a close button, lucide's `x`), the links and the account: 18rem or 85% of the viewport, the full height at the inline start, on `--card` with a hairline end edge and `--shadow-floating`, over the `--overlay` scrim. It slides in from its own edge over `--duration-base` and back; closed, the browser keeps it off the page. Open, it carries no translate, so a `position: fixed` panel inside, such as a `menu-css` panel without `popover`, is placed against the viewport and not moved with the drawer.
- A parent row (`nav-list-css`'s `ds-nav-parent` over its `ds-nav-sub`) is a link over its list in the open sidebar and in the drawer. For the rail, its `<li>` also holds, after the list, the two parts the rail draws in its place, both hidden everywhere else:

  ```html
  <li>
    <a class="ds-nav-link ds-nav-parent" href="/settings/profile" aria-expanded="true" aria-controls="settings-sections">…</a>
    <ul class="ds-nav-sub" id="settings-sections" aria-label="Settings sections">…</ul>
    <a class="ds-nav-link ds-shell-rail-parent" href="/settings/profile" aria-current="true"
       aria-expanded="false" aria-controls="settings-flyout">
      <svg aria-hidden="true">…</svg>
      <span class="ds-nav-label">Settings</span>
    </a>
    <nav class="ds-shell-flyout" id="settings-flyout" aria-label="Settings sections">
      <p class="ds-shell-flyout-title" aria-hidden="true">Settings</p>
      <ul>
        <li><a class="ds-nav-link ds-nav-sublink" href="/settings/profile">…</a></li>
        <li><a class="ds-nav-link ds-nav-sublink" href="/settings/notifications" aria-current="page">…</a></li>
        …
      </ul>
    </nav>
  </li>
  ```

  `ds-shell-rail-parent`: a link to the first child, `aria-current="true"` (and filled) while one of the children is the page, a disclosure of the flyout: `aria-controls` naming it and `aria-expanded` that the page keeps equal to it being shown, and no `aria-haspopup`, whose values name a menu, listbox, tree, grid or dialog and never a `nav`. `ds-shell-flyout`: the children as a `nav` named like the list, the floating shell (`--popover`, a hairline edge, `--shadow-floating`, the card corner) 8px in and at least 12rem wide, `position: fixed`; `ds-shell-flyout-title`, the parent's label at 14px 600 on the rows' 8px by 12px, so its text starts on their glyphs' edge. The rail's rules for its labels and rows stop at the flyout, so its labels and counts show; a row with a count carries its `ds-nav-dot` as on the open sidebar, hidden there too. It shows while its `<li>` is hovered (where the pointer can hover and is fine) or holds keyboard focus, on its link or in the flyout, but not for the focus a tap or a click leaves on either (not `:focus-visible`): that press only follows the link it was on. Tab from the link moves into its links, and a strip back over the gap keeps the pointer in the `<li>` on its way across.
- `ds-shell-tip`: the rail's tooltip, the floating shell (`--popover`, a hairline edge, `--shadow-floating`, the card corner, 16px in, 14px text) for a script to place, 8px past the rail's edge and centred on the hovered or focused link. Its text is the link's name, its count after a middle dot ("Gifts · 12"). Render the tip where no ancestor's `overflow: hidden` can clip it: in the top layer as a `popover` (shown with `showPopover()`, so it also clears a `z-index` stack), or at the end of `<body>`.

## Migrating from 1.x

2.0 moves the collapse toggle into the top bar and the section links into the sidebar.

- The toggle: delete the `ds-icon-bare` collapse toggle from each `ds-shell-head` (the sidebar's; the drawer's close button stays). Put one `<button class="ds-icon-bare ds-shell-toggle" aria-controls="sidebar" aria-expanded aria-label>` in the bar's `ds-topbar-lead`, after the menu button and before the title; your script flips it as before.
- The rail's head: `ds-shell-mark-rail` is a 1.75rem by 2.25rem box now (it was 2.25rem square): give the rail a symbol no wider than 1.75rem.
- A section's links (Settings over Profile, Page, …): move them from `settings-layout-css`'s section nav into the sidebar, as a `nav-list-css` `ds-nav-parent` link over a `ds-nav-sub`, and add the rail's `ds-shell-rail-parent` link and `ds-shell-flyout` beside them in the same `<li>`, with the flyout script under Behavior.

## The rail

With `data-collapsed` on `ds-shell` the sidebar is 3.5rem: each `ds-nav-label` (and the count in it), each `ds-nav-title` and `ds-shell-account-text` leave sight but stay in the accessible names; each `ds-nav-link` centres its glyph, the links 14px in from each side, so the mark and every glyph share the rail's centre line; `nav-list-css` shows each `ds-nav-dot`; groups part on a hairline 12px above the next; the head stays the bar's height and holds `ds-shell-mark-rail` alone, a 1.75rem by 2.25rem box centred in it (14px above and below, its middle level with the bar's title), and `ds-shell-mark` leaves (`display: none`), so a word mark never shows cut to the rail's width; without a `ds-shell-mark-rail` the head is empty; the account shows its avatar. The toggle's label becomes "Expand sidebar" and its `aria-expanded` `false`. A parent row shows as its `ds-shell-rail-parent` link with its flyout. The rail's rules reach only `ds-shell-sidebar`, and stop at a `ds-shell-flyout`: a drawer opened while `data-collapsed` is set keeps the full head, labels and counts, and draws no `ds-nav-dot`.

## Behavior

No script ships with the item. The page wires:

- The toggle: flip `data-collapsed`, its label and `aria-expanded`, and keep the choice in the app's own storage.
- The drawer: `showModal()` from the menu button (set its `aria-expanded`), which moves focus to the close button (`autofocus`); give that button no tooltip, as focus lands on it while the drawer opens; Escape is the browser's. Close it (`close()`) from the close button, a press on the scrim (a click whose target is the dialog itself) and a press on any of its links; the browser returns focus to the menu button. Close it when the window widens past 48rem.
- The account button's menu, as the `menu-css` note says; inside the drawer, render the menu inside the `<dialog>`, which keeps the rest of the page inert.
- The tooltip on the rail's links, as above.
- A parent's link: `aria-expanded="true"` while one of its children is the page, `"false"` otherwise, from the route alone.
- A parent's flyout in the rail: place it, keep its link's `aria-expanded` equal to it being shown, and close it on Escape, whether the pointer or focus opened it, unless something else already handled that Escape, and on Enter on one of its links, focus back on the link where the page stays. Focus moves back to the link only from inside the flyout; with focus elsewhere (the pointer opened it) it stays where it is. The `<li>` takes `data-dismissed` to keep it shut until focus arrives from outside it, focus leaves it, or the pointer comes back:

  ```js
  for (const li of document.querySelectorAll(".ds-shell-sidebar li:has(> .ds-shell-flyout)")) {
    const link = li.querySelector(".ds-shell-rail-parent");
    const flyout = li.querySelector(".ds-shell-flyout");
    // aria-expanded follows what the stylesheet shows, a frame later
    const sync = () => requestAnimationFrame(() =>
      link.setAttribute("aria-expanded", String(getComputedStyle(flyout).display !== "none")));
    for (const type of ["pointerenter", "pointerleave", "focusin", "focusout"]) li.addEventListener(type, sync);
    const place = () => {
      const row = link.getBoundingClientRect();
      const rail = li.closest(".ds-shell-sidebar").getBoundingClientRect();
      const rtl = getComputedStyle(li).direction === "rtl";
      // the flyout's top 8px above the row's, its title 1px under it
      flyout.style.insetBlockStart = `${row.top - 8}px`;
      flyout.style.insetInlineStart = `${rtl ? innerWidth - rail.left + 8 : rail.right + 8}px`;
    };
    li.addEventListener("pointerenter", () => { delete li.dataset.dismissed; place(); });
    // focus arriving from outside clears the hold, so it cannot stick when an
    // Escape left focus elsewhere and focus never entered the <li>
    li.addEventListener("focusin", (e) => { if (!li.contains(e.relatedTarget)) delete li.dataset.dismissed; place(); });
    li.addEventListener("focusout", (e) => { if (!li.contains(e.relatedTarget)) delete li.dataset.dismissed; });
    // Escape closes it however it opened, hovered or holding focus: heard on
    // the document, as focus may be anywhere. only focus inside the flyout
    // moves to the link; focus elsewhere (in a field, say) stays put
    li.ownerDocument.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !li.isConnected || "dismissed" in li.dataset) return;
      if (getComputedStyle(flyout).display === "none") return;
      li.dataset.dismissed = "";
      if (flyout.contains(li.ownerDocument.activeElement)) link.focus();
      sync();
    });
    // Enter on one of its links follows it and closes it as Escape does,
    // focus back on the link where the page stays (a click from the
    // keyboard has no pointer detail; a pointer's click closes it as the
    // pointer leaves)
    flyout.addEventListener("click", (e) => {
      if (e.detail !== 0 || !e.target.closest("a[href]")) return;
      li.dataset.dismissed = "";
      link.focus();
      sync();
    });
  }
  ```

## Accessibility

- Landmarks: the `<nav aria-label="Sidebar">`, the bar's `<header>`, `<main>`; in the rail a parent's flyout is a `nav` of its own, its list in the open sidebar a named list. The drawer is a modal `<dialog>` named "Menu"; the page under it is inert and does not scroll.
- The toggle and the menu button carry `aria-expanded` and `aria-controls`.
- What leaves under 48rem is `display: none`, so it is not read or tabbed to.
- Under forced colors `ds-shell-account-btn` with `aria-expanded="true"` draws a 2px `Highlight` ring 2px inside in place of its fill.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weight, the line-height, the z rungs and the easings Tailwind owns are declared on `ds-shell`, `ds-shell-drawer`, `ds-shell-tip` and `ds-shell-flyout` as `--ds-*` with the same values; the sizes are in rem, so the shell follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 48rem breakpoint stays in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `AppShell` in light and dark, in the default and the example themes, wide, as a rail, at 375 and with the drawer open.
