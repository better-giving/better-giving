# settings-layout-css

Registry item `settings-layout-css` (files: `styles/settings-layout-css.css`; depends on `variables` and `button-css`). Plain CSS: no Tailwind, no React. The look of the `settings-layout` item for a page that has only `variables`: a settings section's stack of cards. The section links have moved to the sidebar (`nav-list-css`'s parent row and its children, in `app-shell-css`), so the layout holds no nav, and nothing in it pins.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css` (Discard and Save) and `styles/settings-layout-css.css`, with `styles/card-css.css`, `styles/field-css.css` and `styles/switch-css.css` for the cards.

```html
<div class="ds-settings">
  <section class="ds-card" aria-labelledby="profile-title">
    <header class="ds-card-header">…</header>
    <form id="profile" class="ds-card-body">…</form>
    <footer class="ds-card-footer">
      <div class="ds-settings-save">
        <button type="button" class="ds-btn ds-btn-secondary">Discard</button>
        <button type="submit" form="profile" class="ds-btn ds-btn-primary">Save changes</button>
      </div>
      <span role="status" class="…visually hidden…"></span>
    </footer>
  </section>
  …
</div>
```

- `ds-settings`: the section's cards (`card-css`), one column 24px apart at every width.
- `ds-settings-save`: Discard and Save at the end of a card's footer, 12px apart; under 48rem they share the row in equal halves.

## Migrating from 1.x

2.0 removes the section nav and its column. The section links move into the sidebar, as the Settings row's children.

- Delete the `<nav class="ds-nav-list ds-nav-list-section ds-settings-nav">` from your copy's markup, and unwrap the cards from `ds-settings-main`: they go straight into `ds-settings`. `ds-settings-nav`, `ds-settings-main` and `--ds-settings-nav-w` are no longer in the stylesheet. Markup that keeps them still draws: the nav is `nav-list-css`'s section variant (its rows from 48rem, a sideways-scrolling row of tabs under it) above the cards, no longer in a column and no longer pinned, and the cards in a kept `ds-settings-main` stack with no gap between them, as the 24px gap is `ds-settings`'s and falls between its own children.
- Give the section links to the sidebar: `nav-list-css` 1.1.0's `ds-nav-parent` link over a `ds-nav-sub` of `ds-nav-sublink` rows, with `app-shell-css` 2.0's rail link and flyout (see those notes).
- Name the section in the page header: a hidden `<h1 class="ds-sr-only">` with its title and nothing else (no crumbs, no visible title or description): a section has a sidebar entry, so the sidebar and the tab title say where the reader is (`page-header-css` 2.0.0).

## The save states

Drawn with `button-css` attributes; the page sets them:

Discard is in the footer in every state but saved: pressing it makes the form pristine, so it never leaves under its own press.

- Pristine: Discard and Save both `aria-disabled="true"` (focusable; stop their clicks, and with Save's the submit).
- Dirty: Discard and Save.
- Saving: Save `aria-busy="true"` and `aria-disabled="true"` with the spinner and "Saving…", Discard `aria-disabled="true"`.
- Saved: Save alone in the row, `data-done="true"` with a check before "Saved" (the success tint); remove Discard from the row (`hidden` loses to `ds-btn`'s `display`), and if it had focus move focus to Save first, since a removed button drops focus on `<body>`. Write "Saved" into a visually hidden `role="status"` in the footer that is always in the page. Hold it 2000ms, then back to pristine. Never for a failed save.

The danger card is a plain `ds-card` whose body holds the consequence and a `ds-btn ds-btn-destructive-outline`.

## Accessibility

- The layout holds no nav: the sidebar's parent row and its list named "Settings sections" lead to each section.
- Save is never `disabled`, so focus stays on it from the press to "Saved".

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on `ds-settings` and `ds-settings-save` as `--ds-spacing` with the same value, in rem, so the layout follows the reader's browser font size. It is `calc(0.25 * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 48rem breakpoint stays in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `SettingsLayout` and `SaveActions` in light and dark, in the default and the example themes, wide and at 375, with no nav and nothing pinned.
