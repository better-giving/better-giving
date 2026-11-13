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

Hover darkens the edge, except on a disabled or invalid radio. Disabled takes the `--gray-3` fill and a `--hairline` edge, and a checked dot mutes to gray-11, as the checkbox does. `aria-invalid="true"` on the input takes the `--destructive` edge; for a group refused as a whole, put it on every radio in the group and the predicate once under the `<fieldset>`. Under forced colors (Windows High Contrast) the dot is drawn in the system ink, `CanvasText`. Focus-visible shows a 2px outline in `--ring`, for keyboard focus only.

## Accessibility

- The input is native, so arrow keys move within a group that shares `name`.
- Group radios in a `<fieldset>` with a `<legend>`.
- The wrapper label names each input.

## Theming

Reads roles from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on the class as `--ds-spacing` with the same value. It is in rem, so the radio and its dot follow the reader's browser font size.
