import { formatOffer } from '@better-giving/form/money';
import type { DonateProfile } from '../profile';

// the Donation page's profile head at /donate: the banner or the brand's band over it, the logo or
// a badge of the name's initials, the name and the EIN, and what the organisation has raised. each
// part draws only where the organisation has what it shows; ../page-view.tsx picks the layout the
// parts stand in and works out the initials and the name's length, which it shares with the
// masthead and the title.

/** the banner, or with none the band in the brand's step 3; decoration, so out of the reading. */
export function ProfileBanner({ banner }: { readonly banner: DonateProfile['banner'] }) {
	if (banner === null) {
		return <div className="page-profile-band" data-area="banner" aria-hidden="true" />;
	}
	return (
		<div className="page-profile-banner" data-area="banner" aria-hidden="true">
			<img className="page-photo" src={banner.src} alt="" />
		</div>
	);
}

/**
 * the logo or, with none, the badge of the name's initials; either stands beside the name, which is
 * always drawn, and says nothing of its own. with no letter in the name to make a badge, nothing.
 */
export function ProfileMark({
	logo,
	wide,
	letters
}: {
	readonly logo: DonateProfile['logo'];
	/** the logo is a wordmark, drawn whole at its own shape rather than in the square. */
	readonly wide: boolean;
	/** the name's initials, `''` where it holds no letter. */
	readonly letters: string;
}) {
	if (logo !== null) {
		return (
			<img
				className="page-profile-logo"
				src={logo.src}
				alt=""
				width={logo.width}
				height={logo.height}
				data-wide={wide ? '' : undefined}
			/>
		);
	}
	if (letters === '') return null;
	return (
		<span className="page-profile-badge" aria-hidden="true">
			{letters}
		</span>
	);
}

/** the name, a step smaller where it is long and never cut, and the EIN where one is stated. */
export function ProfileName({
	name,
	taxId,
	long
}: {
	readonly name: string;
	readonly taxId: string | null;
	readonly long: boolean;
}) {
	return (
		<div className="page-profile-names">
			<h1 className="page-profile-name" data-long={long ? '' : undefined} data-area="title">
				{name}
			</h1>
			{taxId === null ? null : (
				<p className="page-profile-ein">
					EIN <span className="page-profile-ein-number">{taxId}</span>
				</p>
			)}
		</div>
	);
}

/**
 * what has been raised, in full and never abbreviated, and from how many gifts; at nothing, the
 * invitation in its place, with no figure and no count.
 */
export function ProfileRaised({
	raised,
	money
}: {
	readonly raised: DonateProfile['raised'];
	readonly money: DonateProfile['money'];
}) {
	if (raised.raisedMinor <= 0) {
		return (
			<p className="page-profile-first" data-area="raised">
				Be the first to give.
			</p>
		);
	}
	const gifts = new Intl.NumberFormat(money.locale).format(raised.gifts);
	return (
		<p className="page-profile-raised" data-area="raised">
			<span className="page-profile-raised-figure">
				{formatOffer(raised.raisedMinor, money.locale, money.currency)}
			</span>{' '}
			<span className="page-profile-raised-label">
				raised from {raised.gifts === 1 ? '1 gift' : `${gifts} gifts`}
			</span>
		</p>
	);
}
