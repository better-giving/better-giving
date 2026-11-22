# site-nav-css

Registry item `site-nav-css` (files: `styles/site-nav-css.css`; depends on `variables`, `button-css` and `bare-icon-button-css`). Plain CSS: no Tailwind. The look of the React `site-nav` item.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css`, `styles/bare-icon-button-css.css` (for the announcement's dismiss) and `styles/site-nav-css.css`.

```html
<a class="ds-site-nav-skip" href="#main">Skip to content</a>
<header class="ds-site-nav">
  <div class="ds-site-nav-bar">
    <a class="ds-site-nav-brand" href="/"><span class="ds-site-nav-name">Acme</span></a>
    <nav class="ds-site-nav-links" aria-label="Main">
      <ul>
        <li><a class="ds-site-nav-link" href="/colors">Colors</a></li>
        <li><a class="ds-site-nav-link" href="/components" aria-current="page">Components</a></li>
      </ul>
    </nav>
    <button type="button" class="ds-btn ds-btn-ghost ds-btn-field ds-btn-icon ds-site-nav-toggle"
            aria-label="Menu" aria-expanded="false" aria-controls="site-menu">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>
      </svg>
    </button>
  </div>
  <nav id="site-menu" class="ds-site-nav-menu" aria-label="Main" hidden>
    <ul>
      <li><a class="ds-site-nav-menu-link" href="/colors">Colors</a></li>
      <li><a class="ds-site-nav-menu-link" href="/components" aria-current="page">Components</a></li>
    </ul>
  </nav>
</header>
<main id="main" tabindex="-1">...</main>
```

- `ds-site-nav-skip` is the skip link: hidden until focused, then a chip 12px in from the top start corner (top left in a left-to-right page) with the `--popover` fill, `--shadow-floating`, the control corner, 8px by 16px and 14px semibold text.
- `ds-site-nav` is the header: sticky at the top, z 30, the `--background` fill, a `--hairline` bottom edge. It resets its lists' bullets and spacing. A page holding it gets `--ds-bar-h` on `:root` as the header's height (4rem and the 1px edge), so a `page-state-css` under it centers in what is left of the viewport; with an announcement band, run the script in the announcement section so the band's height counts too.
- `ds-site-nav-bar` is the page shape inside it: 64px high, a 20px gutter, 40px from 48rem, capped at 80rem from 80rem wide and 96rem from 96rem.
- `ds-site-nav-brand` is the home link: the full bar height, the display face at 20px bold with tight tracking, its 8px inset taken back by a margin. Wrap the name in `ds-site-nav-name`: one line, cut with an ellipsis, because the bar's height is fixed and page centring reads it. The mark shrinks before the links do and stops growing at 28rem from 40rem, but only when it holds a `ds-site-nav-name` box: a mark whose name is bare text, as in 1.2.2, is unchanged. A logo goes before the name as `<img class="ds-site-nav-logo" src="…" alt="">`: 32px high, at most 10rem wide, contained, on the control corner, 8px from the name; the empty `alt` is because the name beside it names the link.
- `ds-site-nav-solo` goes beside `ds-site-nav` on a header with one link and no actions or account: under 40rem the link stays in the bar at 12px a side and the toggle and the panel are hidden. Anything else folds as before. Not on a `ds-site-nav-fold-nav` header.
- `ds-site-nav-links` is the `<nav>` of the bar, hidden under 40rem; `ds-site-nav-link` each link: the full height, 16px side padding, 4px apart, 14px semibold gray-11, gray-12 on hover where the pointer can hover. `aria-current="page"` draws a 2px `--primary` underline and `--accent-11` ink.
- `ds-site-nav-toggle` hides the menu button from 40rem; the button itself is button-css's 50px ghost icon button. The glyph is lucide's `Menu` (above) closed and its `X` open: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`.
- `ds-site-nav-menu` is the panel, hung under the bar across its width: `--popover`, `--shadow-floating`, a `--hairline` bottom edge (the bar's hairline is its top edge), 8px top and bottom, scaling in over `--duration-fast`. The `hidden` attribute closes it. `ds-site-nav-menu-link` is a row, 50px high with 20px side padding; the current one has a 2px `--primary` start edge and the `--secondary` fill.
- Under forced colors the fills flatten and every edge would paint, so the links' and rows' edges take `Canvas` and the current one's `Highlight`.
- Focus on the mark, a link or a row is a 2px `--ring` outline 4px inside it.

## The announcement, the actions, the account and the nav fold

```html
<a class="ds-site-nav-skip" href="#main">Skip to content</a>
<aside class="ds-site-nav-announce" aria-label="Announcement">
  <div class="ds-site-nav-announce-row">
    <p>The spring release is out. <a href="/news">Find out more<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a></p>
    <button type="button" class="ds-icon-bare ds-icon-bare-sm" aria-label="Dismiss announcement">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  </div>
</aside>
<header class="ds-site-nav ds-site-nav-fold-nav">
  <div class="ds-site-nav-bar">
    <a class="ds-site-nav-brand" href="/"><span class="ds-site-nav-name">Acme</span></a>
    <nav class="ds-site-nav-links" aria-label="Main"><ul>…six links…</ul></nav>
    <div class="ds-site-nav-end">
      <div class="ds-site-nav-actions">
        <a class="ds-btn ds-btn-secondary" href="/login">Log in</a>
        <a class="ds-btn ds-btn-primary" href="/join">Join</a>
      </div>
      <button type="button" class="ds-btn ds-btn-ghost ds-btn-field ds-btn-icon ds-site-nav-toggle"
              aria-label="Menu" aria-expanded="false" aria-controls="site-menu">…</button>
    </div>
  </div>
  <nav id="site-menu" class="ds-site-nav-menu" aria-label="Main" hidden>
    <ul>…the same links as ds-site-nav-menu-link…</ul>
    <div class="ds-site-nav-menu-actions">
      <a class="ds-btn ds-btn-secondary" href="/login">Log in</a>
      <a class="ds-btn ds-btn-primary" href="/join">Join</a>
    </div>
  </nav>
</header>
```

- `ds-site-nav-announce` is the band above the header: the `--primary` fill and `--primary-fg` ink at full strength; inside it `--ring` is `--primary-ring` and `--border` is `--primary-border`. Render it only until the reader dismisses it; your app stores that and leaves the band out after. The stylesheet's own `--ds-bar-h` counts the band as one line, which paints at once; a page state under the header centers in what is left of the viewport only if it counts the band's real height. This script keeps `--ds-bar-h` equal to the header's height plus the band's (and to the header's alone once the band leaves), and `--ds-header-h`, the header alone. It does nothing on a page with no `ds-site-nav`, and follows a band added or removed later. Load it with `defer`, so it runs after the header is parsed and before the first paint, as `<script defer src="site-nav-bar.js"></script>` at the end of the page's head:

```js
const root = document.documentElement;
const header = document.querySelector(".ds-site-nav");
if (header) {
  const band = () => document.querySelector(".ds-site-nav-announce");
  const sizes = new ResizeObserver(() => measure());
  let watched = null;
  function measure() {
    const now = band();
    if (now !== watched) {
      if (watched) sizes.unobserve(watched);
      watched = now;
      if (now) sizes.observe(now);
    }
    root.style.setProperty("--ds-header-h", `${header.offsetHeight}px`);
    root.style.setProperty(
      "--ds-bar-h",
      `${header.offsetHeight + (now?.offsetHeight ?? 0)}px`
    );
  }
  sizes.observe(header);
  new MutationObserver(measure).observe(header.parentNode, { childList: true });
  measure();
}
```
- `ds-site-nav-announce-row` is its page shape (the bar's gutter and caps), 8px top and bottom, 12px text at line height 1.5. Its `<p>` takes the free width with balanced lines; its link is bold in the band's ink, underlined on hover where the pointer can hover, with lucide's `chevron-right` at 12px. The dismiss is a `ds-icon-bare ds-icon-bare-sm` (16px, lucide's `x`), held in the band's ink when hovered and pressed. The link and the dismiss draw a 2px `--primary-ring` outline 2px outside on the control corner.
- `ds-site-nav-end` is the end of the bar, 16px after the links, which it pushes to meet it: the actions, the account control and the menu button, 8px apart. The account control (an `avatar-css` `<button class="ds-avatar">` with `aria-haspopup="menu"`, signed in, beside a "My dashboard" action) goes straight inside it, after `ds-site-nav-actions`, and shows at every width.
- `ds-site-nav-actions` holds the buttons or links, 8px apart; it is hidden under the fold.
- `ds-site-nav-menu-actions` repeats them in the panel after the rows: a `--hairline` rule, 8px under the rows, the buttons stacked full width 8px apart, 12px under the rule and 20px in from the sides. A press on one closes the panel, as a row's does.
- `ds-site-nav-fold-nav` on the header moves the fold from 640px (40rem) to 75rem: under it the links and the actions fold behind the menu button, and from it the button and the panel go. The links take 12px a side and no gap so six of them and two buttons fit. A media query cannot read a variable, so 75rem is written out in the stylesheet, the theme's `nav` breakpoint.

## Behavior

The stylesheet draws; your script opens and closes. With the nav fold, close the panel when the window widens to 75rem, as at 40rem without it. A press on the dismiss removes the band and moves focus on to `ds-site-nav-brand`, since the button leaves with it. The button toggles `aria-expanded` and the panel's `hidden`, and swaps the glyph. While the panel is open, Escape pressed in the panel or on the button closes it and moves focus to the button (leave an Escape in any other field to that field), and a press on a row, a `pointerdown` anywhere outside the panel and the button, or focus moving from the panel to an element other than the button (a `focusout` whose `relatedTarget` is outside both) closes it: the panel hangs over the page, so left open it would cover the control focus moved to. It is a disclosure: no focus trap.

## Accessibility

- The skip link is the first tab stop; the target `<main>` takes `tabindex="-1"`.
- Both lists sit in a `<nav aria-label="Main">`; only one is drawn at any width.
- The menu button has `aria-label="Menu"`, `aria-expanded` and `aria-controls`; the glyph is `aria-hidden`.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it; dark is the app's own `.dark` class, with no theme toggle. The spacing step, type sizes, weight, tracking, z rungs, page widths and the popup's easing Tailwind owns are declared on the classes as `--ds-*` with the same values; the stylesheet carries its own `ds-popup-in` keyframes, the same frames as Tailwind's `popup-in` under a prefixed name, so a host's own keyframes cannot collide. The spacing step, type sizes, page widths and breakpoints are in rem, so the header follows the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size, so a host's root size does not move them. The corner comes from `variables` and stays in rem.
