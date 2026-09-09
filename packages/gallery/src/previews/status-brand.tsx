import { Button } from '@better-giving/operator/components/controls/Button';
import { Brand } from '@better-giving/operator/components/status/Brand';

/*
 * the one company logo an operator surface draws, in both of the shapes it has.
 *
 * there is no set to read off here the way src/previews/status-mark.tsx reads `MARK_NAMES`:
 * `BrandName` is one member and is closed on purpose, so this page draws that one and a second
 * brand arrives with a line in this file beside the ones it takes in the component and the sheet.
 *
 * the two shapes look identical and that is why both are drawn. with a label the logo is
 * `role="img"` carrying the company's name, which is what a logo standing *where* the name would
 * have stood has to be; without one it is out of the accessibility tree, which is what a logo
 * standing *beside* that name in the same control has to be — the button below is the console's own
 * press and says `Cloudflare` in its words, so a label there would announce the company twice.
 *
 * inside a button it needs nothing placing it: `.adm-btn` is a flex row with its own gap in
 * packages/operator/src/styles/adm.css, and the logo takes the mark box `.adm-brand` gives it in
 * packages/operator/src/styles/base.css.
 */
export default function StatusBrandPreview() {
	return (
		<div className="adm-stack">
			<p>
				<Brand name="cloudflare" label="Cloudflare" /> A labelled logo, which is an image carrying
				the company's name.
			</p>
			<div className="adm-actions">
				<Button>
					<Brand name="cloudflare" />
					Connect to Cloudflare
				</Button>
			</div>
		</div>
	);
}
