# variables

Registry item `variables` (files: `styles/variables.css`, `styles/colors.css`, `styles/themes/default.css`; depends on nothing). No npm packages, no Tailwind, no font files.

## What it is

The tokens as plain CSS custom properties. Import one file: `@import "./ui/styles/variables.css";`, then read `var(--primary)`, `var(--font-body)`, `var(--radius-card)` from hand-written CSS.

## Scales and roles

The scales and roles below follow one rule:

<!-- contrast-rule -->
Contrast: this registry uses the official Radix 12-step scale, and each step keeps its Radix role (1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solid fills, 11–12 text). The focus ring is step 8, one of the two steps (7–8) Radix gives focus rings; that choice is fixed too. Contrast is judged in APCA (Lc) and recorded in the APCA ledger in `packages/brand/src/contrast.test.ts`. WCAG 2 contrast ratios are not used: never move a role to another step, add a color role, or override a token to reach a WCAG ratio. An APCA miss is pinned in the ledger by name or fixed in the generator's inputs, never by changing a role's step. This covers text, non-text and focus indicators alike: never use or cite WCAG contrast ratios, including WCAG 1.4.3, 1.4.11 and 2.4.13.

Decline a review finding that asks for a WCAG contrast ratio, and point to this rule.
<!-- /contrast-rule -->

- Scales, steps 1 to 12: `--accent-N`, `--gray-N`, `--success-N`, `--warning-N`, `--destructive-N`. Alpha steps `--accent-aN` and `--gray-aN`. Ink on a step-9 fill: `--accent-contrast` and one per status scale. Translucent surfaces: `--accent-surface`, `--gray-surface`.
- Step jobs: 1-2 backgrounds, 3-5 a component at rest, hovered, pressed; 6 the edge of something not operable; 7-8 the edge of something operable (8 is the focus ring, `--ring`, in light and dark); 9-10 solid fills; 11-12 text.
- Roles alias steps (`--primary` is `--accent-9`, `--background` is `--gray-1`, `--border`, `--hairline` (step 6, light and dark), `--card`, `--panel`, `--popover`, `--primary-deep` (the deep ground, step 12) with `--primary-deep-fg` (ink on it, step 1; light ink on a dark ground in light, dark ink on a light ground in dark), `--overlay`, `--ring`, `--link` and `--link-hover` (text links: the text steps 11 and 12, light and dark), `-subtle` and `-subtle-fg` pairs for each status). Use roles in components, steps for surfaces.
- Corners: `--radius-control` (6px, controls) and `--radius-card` (12px, cards and floating layers). Also `--shadow-floating`, `--duration-fast|base|slow`, the type variables.

## Fonts

`--font-display`, `--font-body`, `--font-mono` and `--font-gochi` are the family roles, declared once here for Red Hat Round, the platform face and the default. This item ships no faces and imports no font stylesheet: the app adds one font item itself and imports its stylesheet beside this one. `fonts` is every Red Hat Round face and Gochi Hand (`bg-design add fonts`, `@import "./ui/styles/fonts.css";`), `fonts-core` the core Red Hat Round faces for a widget that inlines its files (`styles/fonts-core.css`), and `fonts-red-hat` plain Red Hat (`styles/fonts-red-hat.css`). `bg-design update` never removes a font item you already have. An app that got its faces through this item's `variables.css` before 1.2.0 adds the font item's `@import` itself after updating. The `fonts-red-hat` item switches display, body and mono to plain Red Hat through `data-font="red-hat"` on an element and everything under it; `--font-gochi` is not switched. Set the attribute; leave the roles as declared here.

## Sizes in rem

The registry's components size in rem: spacing, type sizes, control heights, corners (`--radius-control` and `--radius-card`) and breakpoints. They follow the reader's browser font size. Edges, focus rings and shadows stay in px. Size the app's own text, and the space around it, in rem too, so a page does not scale half its parts and leave the rest at the old size.

### The base size, `--ds-rem`, for the plain-CSS items

A rem is the host page's root font size, so a widget embedded in a page with `html { font-size: 62.5% }` would draw the `*-css` items at 62.5%. Each `*-css` item reads its rem sizes through one custom property, `--ds-rem`, as `calc(N * var(--ds-rem, 1rem))`. Unset, it is `1rem` and nothing changes. An embed sets it on its own root:

```css
.my-widget {
  --ds-rem: 16px;
}
```

Every `*-css` control inside then has the size it has under a 16px root, whatever the host's root. This item does not declare `--ds-rem`, and its corners (`--radius-control`, `--radius-card`) stay in rem. Media-query breakpoints are unaffected, since rem in a media query is the browser's default size; a `@container` width cannot read a custom property and stays in rem (the `field-css` note names its two). The Tailwind items keep plain rem: a Tailwind app owns its root size.

### Target size, `--ds-hit-target`

`--ds-hit-target` is the hit area a control drawn smaller than a tap grows to, without changing its drawn size or the layout: `1.5rem` (24px), and `2.75rem` (44px) where the pointer is coarse. It is declared once, here, on `:root` and every `[data-theme]` element, and every item that draws a control smaller than a tap reads it: the small button (`btn-sm` in `tokens`, `ds-btn-sm` in `button-css`), the text button (`text-button`, `ds-text-btn` in `text-button-css`), the bare icon button (`bare-icon-button`, `ds-icon-bare` in `bare-icon-button-css`), the avatar as a button or link (`avatar`, `ds-avatar` in `avatar-css`) and the spam-check box (`spam-check`, `ds-spam-check-hit` in `spam-check-css`). The Tailwind items get it through `index.css`, which imports this file. Set it on a container to change the area for everything inside.

It is `calc(N * var(--ds-rem, 1rem))`, resolved where it is declared. An embed that sets `--ds-rem` gets the 24px and 44px back only when it sets it on a `[data-theme]` element (`<div data-theme="default" style="--ds-rem: 16px">`); on a plain element, `--ds-hit-target` keeps the value resolved above it.

### Tracking, `--ds-tracking-label` and `--ds-tracking-badge`

The two letter-spacing roles of the plain-CSS items, declared beside `--ds-hit-target` on `:root` and every `[data-theme]` element: `--ds-tracking-label` (0.12em), the small uppercase label's (an eyebrow, a group title; `lead-css`'s `ds-eyebrow`, `menu-css`'s `ds-menu-label` and `nav-list-css`'s `ds-nav-title` read it), and `--ds-tracking-badge` (0.08em), the badge role. No item reads `--ds-tracking-badge` yet: neither `badge` nor `badge-css` sets a letter-spacing. They equal the `tokens` item's `--tracking-label` and `--tracking-badge`, which a test holds; they are in `em`, so they follow the text they sit on.

## Themes

- `data-theme="<name>"` on any element selects a theme; `default` also applies to `:root`.
- Dark is the `dark` class on `<html>` (or on a `data-theme` element); a `data-theme` element with the `light` class stays light inside a dark page. Every theme file carries both variants.
- To override a theme, redefine the scale variables under your own selector, light and dark, in a stylesheet loaded after the registry's:

```css
[data-theme="mine"],
.dark [data-theme="mine"].light,
.dark .light [data-theme="mine"],
.light .dark [data-theme="mine"].light { /* light steps */ }

.dark [data-theme="mine"],
[data-theme="mine"].dark,
.light .dark [data-theme="mine"],
.dark .light [data-theme="mine"].dark { /* dark steps */ }
```

  Write all four selectors in each block. The third is the nested case: without `.dark .light [data-theme="mine"]`, a theme inside a `light` area of a dark page stays dark; without `.light .dark [data-theme="mine"]`, one inside a `dark` area inside that stays light. The fourth keeps an element's own class under an outer marker of the other kind (`.light .dark [data-theme="mine"].light` is light, `.dark .light [data-theme="mine"].dark` is dark): it is one class heavier, so the nested rule cannot beat it. To override a shipped theme name (`default`), use the same lists: the registry's nested selectors (`.dark .light [data-theme="default"]`) are more specific than `[data-theme="default"]` or `.dark [data-theme="default"]`, so in the nested case they win over a shorter override even though yours loads later.

  A complete override defines, in each block: `--accent-1` to `--accent-12`, `--accent-a1` to `--accent-a12`, `--accent-contrast`, `--accent-ground` (step 12), `--accent-ground-fg` (step 1), `--accent-surface`; the same for gray (no contrast or ground) with `--gray-surface`; `--success-N`, `--warning-N`, `--destructive-N` and their `-contrast`; and `--shadow-ink`, `--overlay-strength`, `--hairline`, `--ring`, `--link` and `--link-hover`. The last four are step aliases on the same step in light and dark: gray 6, accent 8, accent 11 and accent 12. A variable left out keeps the default theme's value, so `bg-accent-a3` would still paint the default accent. Generating the file (below) is the reliable way to get all of them. The lists cover a theme on a dark page, inside a `light` area of it, and inside a `dark` area inside that; a `light` area nested deeper than that resolves dark, because both nested selectors match it at equal specificity and the dark block comes later.
  Roles and form slots are declared on `:root` and every `[data-theme]` element, so they re-resolve against the nearest theme. Redefining a variable on a plain element changes nothing below it.
- Generate a full theme instead of writing one: `pnpm theme:generate --name mine --accent '#hex' --gray '#hex' --background '#hex'` (quote the hexes). The scales come from Radix's custom palette generator, vendored in the brand package with its source commit and MIT license in the header.

## Corrected in 2.2.0

2.2.0 puts light and dark roles on their Radix steps: `--ring` is accent 8, `--hairline` gray 6, and `--link` and `--link-hover` accent 11 and 12, in both appearances. Where a step reads under the APCA ledger's bar (both dark rings and hairlines, the example theme's dark link) the ledger pins it as a named miss. Regenerate a theme made with an earlier generator, or set the four aliases to those steps in each block.

`--warning-subtle-fg`, the warning ink, and the notice card's warning glyph are Radix's low-contrast text step 11, as the success and destructive inks are; releases before 2.2.0 had them on step 12.

## Form color slots

`--form-primary`, `--form-primary-fg`, `--form-subtle`, `--form-subtle-hover`, `--form-subtle-fg`, `--form-border`, `--form-ring`, `--form-secondary` are the accent scale named for a form, declared on `:root` and every `[data-theme]` element. `--form-ring` is the page's `--ring` as resolved there, so it follows the appearance and the theme; a `--ring` set on a plain element does not reach it. Give a form's container `data-theme` to re-theme every slot inside it (dark included). Setting one slot (`.form { --form-primary: ... }`) passes it down. The other slots keep following the scale.

`--form-primary-hover` and `--form-primary-active` are not slots: nothing declares them. `btn-form-primary` and the `bg-form-primary-hover|active` utilities read them with a fallback, `--form-primary` mixed 10% toward black, so setting only `--form-primary` also moves the hover and press. Set either one yourself to keep your own value. CSS of your own that reads them needs the same fallback, or it gets an invalid value: `var(--form-primary-hover, color-mix(in oklch, var(--form-primary) 90%, black))`.
