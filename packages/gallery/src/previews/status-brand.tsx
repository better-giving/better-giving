import { Button } from '@better-giving/operator/components/controls/Button';
import { Brand } from '@better-giving/operator/components/status/Brand';

/*
 * every company logo an operator surface draws, in both of the shapes each of them has.
 *
 * there is no set to read off here the way src/previews/status-mark.tsx reads `MARK_NAMES`:
 * `BrandName` is closed on purpose, so this page draws its three members and a fourth brand arrives
 * with a line in this file beside the ones it takes in the component and the sheet.
 *
 * the two shapes look identical and that is why both are drawn. with a label the logo is
 * `role="img"` carrying the company's name, which is what a logo standing *where* the name would
 * have stood has to be; without one it is out of the accessibility tree, which is what a logo
 * standing *beside* that name in the same control has to be — each press below says the company in
 * its own words, so a label there would announce it twice.
 *
 * inside a button it needs nothing placing it: `.adm-btn` is a flex row with its own gap in
 * packages/operator/src/styles/adm.css, and the logo takes the mark box `.adm-brand` gives it in
 * packages/operator/src/styles/base.css.
 *
 * the three do not share a width, and this page is where that is visible: every rule spends the one
 * mark height and takes its width from its own file, so Cloudflare's wide wordmark runs several
 * times the width of the two square marks standing at the same height beside it.
 */
export default function StatusBrandPreview() {
	return (
		<div className="adm-stack">
			<p>
				<Brand name="cloudflare" label="Cloudflare" />{' '}
				<Brand name="quickbooks" label="QuickBooks" /> <Brand name="xero" label="Xero" /> Three
				labelled logos, each an image carrying its company's name.
			</p>
			<div className="adm-actions">
				<Button>
					<Brand name="cloudflare" />
					Connect to Cloudflare
				</Button>
				<Button>
					<Brand name="quickbooks" />
					Connect to QuickBooks
				</Button>
				<Button>
					<Brand name="xero" />
					Connect to Xero
				</Button>
			</div>
		</div>
	);
}
