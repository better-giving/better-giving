import * as copy from './copy';

// what a donor gets where a donor page refuses — /donate, a campaign's address, or its preview.
//
// the page's own dress rather than the card's: there is no form here, so there is nothing for the
// form's sheets to paint and nothing about the organisation's brand to state. it is also not the
// operator error panel — the reader is a person holding a link that did not work, not somebody who
// administers this deployment, and the sentence they get names no form id and no deployment.

export function DonateNotice() {
	return (
		<div className="notice">
			<p>{copy.NO_FORM}</p>
		</div>
	);
}
