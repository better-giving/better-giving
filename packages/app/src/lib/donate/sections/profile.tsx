import type { DonateProfile } from '../profile';

// the Donation page's profile head at /donate: the banner, the logo or a badge of the name's
// initials, and the name and the EIN. each part draws only where the organisation has what it
// shows; ../page-view.tsx picks the layout the parts stand in ($lib/page/profile-shape.ts) and works
// out the initials and the name's length, which it shares with the masthead and the title.

/**
 * the saved banner, in the card and the letter: edge to edge in the card, framed on a plane in the
 * letter. decoration, so out of the reading.
 */
export function ProfileBanner({
	banner
}: {
	readonly banner: NonNullable<DonateProfile['banner']>;
}) {
	return (
		<div className="page-profile-banner" data-area="banner" aria-hidden="true">
			<img className="page-photo" src={banner.src} alt="" />
		</div>
	);
}

/**
 * the feature's cover: the saved banner as a photo the scrim lies over (`data-cover="photo"`), or
 * with none the brand's own ground, which takes no scrim (`data-cover="none"`). decoration, so out
 * of the reading.
 */
export function ProfileCover({ banner }: { readonly banner: DonateProfile['banner'] }) {
	return (
		<div
			className="page-profile-cover"
			data-area="banner"
			data-cover={banner === null ? 'none' : 'photo'}
			aria-hidden="true"
		>
			{banner === null ? null : <img className="page-photo" src={banner.src} alt="" />}
		</div>
	);
}

/**
 * the logo, named for the organisation (`{name} logo`); with none, the badge of the name's initials,
 * which says nothing of its own beside the name; with no letter in the name to make a badge,
 * nothing.
 */
export function ProfileMark({
	name,
	logo,
	wide,
	letters
}: {
	readonly name: string;
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
				alt={`${name} logo`}
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
