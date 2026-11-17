# site-footer-css

Registry item `site-footer-css` (files: `styles/site-footer-css.css`; depends on `variables` and `button-css`). Plain CSS: no Tailwind. The look of the React `site-footer` item.

## Markup contract

Import `styles/variables.css`, `styles/button-css.css` and `styles/site-footer-css.css`.

```html
<footer class="ds-site-footer">
  <div class="ds-site-footer-inner">
    <div class="ds-site-footer-grid">
      <div>
        <img src="/logo-white.svg" alt="Acme" height="40">
        <div class="ds-site-footer-about"><p>Open-source tools for community funds.</p></div>
      </div>
      <nav aria-labelledby="f-product">
        <h2 id="f-product" class="ds-site-footer-title">Product</h2>
        <ul class="ds-site-footer-list">
          <li><a href="/payments">Payments</a></li>
          <li><a href="/pricing">Pricing</a></li>
        </ul>
      </nav>
      <nav aria-labelledby="f-company">…the same…</nav>
      <div>
        <h2 id="f-news" class="ds-site-footer-title">Stay in the loop</h2>
        <form class="ds-site-footer-form" aria-labelledby="f-news" novalidate>
          <div class="ds-site-footer-field">
            <label class="ds-site-footer-label" for="f-email">Email address</label>
            <input class="ds-site-footer-input" id="f-email" name="email" type="text" inputmode="email"
                   autocomplete="email" placeholder="you@example.org" aria-describedby="f-err f-ok">
            <p class="ds-site-footer-alert" id="f-err" role="alert"></p>
            <p class="ds-site-footer-status" id="f-ok" role="status"></p>
          </div>
          <button type="submit" class="ds-btn ds-btn-secondary ds-btn-field">Subscribe</button>
        </form>
        <ul class="ds-site-footer-social">
          <li><a href="https://example.social/@acme">Mastodon</a></li>
        </ul>
      </div>
    </div>
    <div class="ds-site-footer-art"><img src="/hills.svg" alt=""></div>
    <div class="ds-site-footer-legal">
      <p>© 2026 Acme.</p>
      <nav aria-label="Legal"><ul><li><a href="/privacy">Privacy policy</a></li></ul></nav>
    </div>
  </div>
</footer>

<footer class="ds-site-footer-compact">
  <div class="ds-site-footer-compact-row">
    <p>© 2026 Acme</p>
    <nav aria-label="Footer"><ul><li><a href="/docs">Docs</a></li><li><a href="/terms">Terms</a></li></ul></nav>
  </div>
</footer>
```

- `ds-site-footer`: the full footer, the `--primary` fill with `--primary-fg` ink at full strength. Inside it `--ring` is `--primary-ring` and `--border` is `--primary-border`. Every `<a>` in it keeps the ink, underlines on hover where the pointer can hover, and draws a 2px ring 2px outside on focus.
- `ds-site-footer-inner`: the page shape (a 20px gutter, 40px from 48rem, capped at 80rem from 80rem and 96rem from 96rem), 48px over and 32px under.
- `ds-site-footer-grid`: one column, two from 40rem, `1.4fr 1fr 1fr 1.3fr` from 64rem, 40px apart. Put the mark's column first, then two link columns, then the newsletter's.
- `ds-site-footer-about`: the lines under the mark, 16px down, 12px apart, 14px at line height 1.5.
- `ds-site-footer-title`: a column's `<h2>`, the body face at 14px bold, 12px over its list. `ds-site-footer-list`: the links, 14px, 8px apart.
- `ds-site-footer-form`: the field and its button on one row, 8px apart, the button wrapping under the field when the column is narrow. `ds-site-footer-field` is the field's column (at least 12rem); `ds-site-footer-label` hides its label visually; `ds-site-footer-input` is the 50px field, `--surface` fill, a 1px `--primary-border` edge, 2px when `aria-invalid="true"`.
- `ds-site-footer-alert` (with `role="alert"`) and `ds-site-footer-status` (with `role="status"`): the messages under the field, empty and taking no room until you write a line in. Filled, the alert is `--destructive-subtle-fg` on `--destructive-subtle`, the status `--success-subtle-fg` on `--success-subtle`, 8px by 12px on the control corner, 8px under the field. Show one at a time.
- `ds-site-footer-social`: text links at 12px, 500, 16px apart, 16px under the form.
- `ds-site-footer-art`: the app's art, 40px under the grid.
- `ds-site-footer-legal`: the legal row, 40px down, under a 1px `--primary-border` rule with 24px over the text, 12px at line height 1.5; the line at the start and its links 20px apart at the end, wrapping when narrow.
- `ds-site-footer-compact`: one row on `--background` with a 1px `--hairline` top, the text in gray-11. `ds-site-footer-compact-row` is its page shape, 20px over and under, 14px; its links are `--link` at 600, `--link-hover` and underlined on hover, 20px apart.

## Behavior

The stylesheet draws; your script submits. Check the address on submit; on a failure set `aria-invalid="true"` and `aria-errormessage="f-err"` on the field, write the message into the alert, and move focus to the field. Do that on every refused submit, the same error included: empty the alert and write the message again (or replace the element), so it is announced again. From then on check it on each input and clear the message and the attribute when it is good. On success write the line into the status and leave the alert empty. While the request runs set `aria-busy="true"` and `aria-disabled="true"` on the button and ignore a second submit. Move focus and rewrite the alert when the reply arrives, not at the submit: the error left from the last submit is not this one's answer.

## Accessibility

- Each link column is a `<nav>` labelled by its `<h2>`; the legal links a `<nav aria-label>`.
- The form is named by its heading; the field has its own label and lists both messages in `aria-describedby`. Keep the two live regions in the page while empty.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, leading, weights, control height and page widths Tailwind owns are declared on the classes as `--ds-*` with the same values, in rem, so the footer follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size. A test holds the look equal to the React `SiteFooter` in light and dark, in the default and the example themes.
