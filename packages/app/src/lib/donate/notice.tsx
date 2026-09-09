import * as copy from './copy';

// what a donor gets where the address names no form this deployment can draw.
//
// the page's own dress rather than the card's: there is no form here, so there is nothing for the
// form's sheets to paint and nothing about the organisation's brand to state. it is also not the
// operator error panel — the reader is a person holding a link that did not work, not somebody who
// administers this deployment, and the sentence they get names no form id and no deployment.
//
// `orgName` is the heading the page states above a card, kept here because this screen replaces a
// card rather than sitting beside one. a refused configuration carries no organisation name at all,
// so the ordinary no-form case passes `null` and the notice names nobody.

export type DonateNoticeProps = {
	readonly orgName: string | null;
};

export function DonateNotice({ orgName }: DonateNoticeProps) {
	return (
		<div className="notice">
			{orgName === null ? null : <h1 className="org-name">{orgName}</h1>}
			<p>{copy.NO_FORM}</p>
		</div>
	);
}
