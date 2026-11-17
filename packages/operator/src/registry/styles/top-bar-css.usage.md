# top-bar-css

Registry item `top-bar-css` (files: `styles/top-bar-css.css`; depends on `variables`, `button-css`, `avatar-css` and `menu-css`). Plain CSS: no Tailwind, no React. The look of the `top-bar` item, its `Crumbs` and its `RouteProgress`, for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css` (the bar pads its labelled `ds-btn` buttons under 48rem), `styles/avatar-css.css` and `styles/menu-css.css` (the account and its menu) and `styles/top-bar-css.css`, with `styles/bare-icon-button-css.css` for what else sits in the bar.

```html
<header class="ds-topbar">
  <div class="ds-route-progress" role="progressbar" aria-label="Loading page"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="45" style="--ds-route-progress: 45%">
    <div class="ds-route-progress-bar"></div>
  </div>
  <div class="ds-topbar-lead">
    <nav class="ds-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/campaigns">Campaigns</a><svg aria-hidden="true">…</svg></li>
        <li><span aria-current="page">Spring clean-up fund</span></li>
      </ol>
    </nav>
    <div class="ds-topbar-narrow">
      <a class="ds-btn ds-btn-ghost ds-btn-icon" href="/campaigns" aria-label="Back to Campaigns"><svg aria-hidden="true">…</svg></a>
      <p class="ds-topbar-name">Spring clean-up fund</p>
    </div>
  </div>
  <div class="ds-topbar-actions">
    <div class="ds-topbar-secondary">
      <button type="button" class="ds-icon-bare" aria-label="Notifications">…</button>
    </div>
    <button type="button" class="ds-btn ds-btn-primary">New campaign</button>
    <button type="button" class="ds-avatar" aria-label="Amara Lindqvist"
            aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu">
      <span aria-hidden="true">AL</span>
    </button>
  </div>
</header>
```

- `ds-topbar`: the `<header>`, 4rem tall on `--background` with a 1px `--hairline` under it, 40px in; under 48rem 12px in, its parts 8px apart, and a labelled `ds-btn` in it takes 16px of padding.
- `ds-topbar-lead`: where you are, taking the room: a brand, the `ds-crumbs`, or a `ds-topbar-title` (a `<p>`, the display face at 18px on the tight tracking, cut with an ellipsis). Under 48rem the crumbs leave and `ds-topbar-narrow` shows: a ghost icon back button (`ds-btn ds-btn-ghost ds-btn-icon`, lucide's `arrow-left`, mirrored under `rtl`, named "Back to <page>") and `ds-topbar-name`, the current page's name at 16px, cut with an ellipsis.
- `ds-topbar-actions`: the actions at the end, 8px apart: the primary button and the account. `ds-topbar-secondary` inside it holds what leaves under 48rem, a notification bell (`ds-icon-bare`) or a secondary button.
- The account is a 32px `ds-avatar` button (`avatar-css`) with `aria-haspopup="menu"`, opening a `ds-menu` (`menu-css`) under it, ends aligned. While the session is unknown put an empty `<span class="ds-topbar-account" aria-hidden="true">` in its place: it holds the avatar's 32px, so nothing shifts when it lands. Signed out, the slot holds "Log in" and the sign-up button, and the lead a brand.
- `ds-crumbs`: the trail, a `<nav aria-label="Breadcrumb">` with an `<ol>`. Links (`<a>`) in `--gray-11`, `--gray-12` hovered where the pointer can hover, 14px, 4px either side of a 14px lucide `chevron-right` as an `<svg aria-hidden="true">`, mirrored under `rtl`; the current page last, a `<span aria-current="page">` in `--gray-12` at 600, cut with an ellipsis while the links keep their width. The `<ol>` clips for the ellipsis and is padded 4px (a -4px margin takes it back), so a link's ring is drawn whole. Used on its own too, above a page header's title.
- `ds-route-progress`, holding a `ds-route-progress-bar`: the route-load line, 2px of `--primary` across the top of the nearest positioned ancestor (`ds-topbar` is one), `z-index: 100`. Set `--ds-route-progress` on it (0% to 100%) with `aria-valuenow`; the line grows to it over `--duration-slow`, and at `aria-valuenow="100"` it fades out over the same speed. Remove it once faded. Under `prefers-reduced-motion` the speed collapses and the line steps.

## Behavior

No script ships with the item. The page drives the line: 5% when a navigation starts, toward 95% while it runs, 100% when it lands, removed 300ms later. The account menu's behavior and its portal are the page's, as the `menu-css` note says.

## Accessibility

- One `<header>` (the banner landmark). The crumbs are a `<nav>` named "Breadcrumb"; the current page carries `aria-current="page"` and is not a link.
- What leaves under 48rem is `display: none`, so it is not read or tabbed to.
- The line is `role="progressbar"` named "Loading page", with `aria-valuemin`, `aria-valuemax` and `aria-valuenow`.
- Focus on a crumb link shows the 2px `--ring` outline 2px out.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weights, the tracking and the easing Tailwind owns are declared on `ds-topbar`, `ds-crumbs` and `ds-route-progress` as `--ds-*` with the same values; the sizes are in rem, so the bar follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 48rem breakpoint stays in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `TopBar` in light and dark, in the default and the example themes, wide and at 375.
