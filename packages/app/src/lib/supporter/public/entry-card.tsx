import { useId } from 'react';
import * as copy from './copy';

// the ask to start a fundraiser, on the Donation page and every live campaign, after the page's
// whole layout, its messages included. one secondary press: the donation box stays the page's one
// primary. drawn only while Supporter fundraisers is on; off, nothing stands in its place
// ($lib/donate/page-view.tsx decides). its rules are in $lib/donate/page.css, the sheet every donor
// page links.

export function FundraiserEntryCard({ orgName }: { readonly orgName: string }) {
	const headingId = useId();
	return (
		<section className="page-fundraise" aria-labelledby={headingId}>
			<h2 className="page-fundraise-heading" id={headingId}>
				{copy.entryHeading(orgName)}
			</h2>
			<p>{copy.entryBody(orgName)}</p>
			<div className="page-fundraise-act">
				<a className="ds-btn ds-btn-secondary ds-btn-sentence" href={copy.START_HREF}>
					{copy.ENTRY_ACTION}
				</a>
				<p className="page-fundraise-note">{copy.ENTRY_NOTE}</p>
			</div>
		</section>
	);
}
