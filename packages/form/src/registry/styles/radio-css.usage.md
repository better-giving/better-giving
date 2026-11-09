# radio-css

Registry item `radio-css` (files: `styles/radio-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `radio` utility of `tokens`.

## Markup contract

Import `styles/variables.css` and `styles/radio-css.css`. The class goes on the wrapper, a `<label>` or a `<div>`, around the `<input type="radio">`:

```html
<fieldset>
  <legend>Plan</legend>
  <label class="ds-radio"><input type="radio" name="plan" value="free" checked> Free</label>
  <label class="ds-radio"><input type="radio" name="plan" value="team"> Team</label>
</fieldset>
```

- `ds-radio` is a flex row with a 16px gap. The input inside it is drawn as a 16px ring with a 10px dot; checked, the dot fills with `--primary`.
- `data-required="true"` on the wrapper adds a star after the text. The star has empty alt text, so it stays out of the radio's accessible name; mark the group required with `required` on its inputs.

## States

Hover darkens the edge; a disabled checked dot takes the disabled fill (the Tailwind `radio` does the same, so it is faint). Under forced colors (Windows High Contrast) the dot is drawn in the system ink, `CanvasText`. Focus-visible shows a 2px outline in `--ring`, for keyboard focus only.

## Accessibility

- The input is native, so arrow keys move within a group that shares `name`.
- Group radios in a `<fieldset>` with a `<legend>`.
- The wrapper label names each input.

## Theming

Reads roles from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on the class as `--ds-spacing` with the same value. A test holds the look equal to the Tailwind `radio` in light and dark, in the default and example themes, except disabled: the Tailwind `radio` keeps the resting fill and edge there and mutes the checked dot to the disabled fill, where it can't be seen.
