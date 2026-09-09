import type { ReactNode } from 'react';
import facebook from '../assets/social/facebook.webp';
import github from '../assets/social/github.webp';
import instagram from '../assets/social/instagram.webp';
import linkedin from '../assets/social/linkedin.webp';
import x from '../assets/social/x.webp';
import youtube from '../assets/social/youtube.webp';

// the two ends of the strip this console stands at the foot of every screen it draws: which release
// of the console this is at one end, and where better.giving is at the other.
//
// **whose console it is stands in the head and not here** — ./head-strip.tsx draws the wordmark at
// the leading end of the strip at the top of the page, which is where a masthead reads as one. what
// is left at this end is the release, which is small print about this machine and belongs in the
// small print.
//
// **it holds only what is true before there is anything to read.** neither end turns on a cloudflare
// account, a deployment or a reading, which is what lets one strip stand under all of them — the
// panel the operator connects on, the gate, the deploy card, the two running faces, the shell home
// and the page that says the console has stopped.
//
// it is a fragment rather than a box, because the box is the slot's: `.adm-footstrip` in
// packages/operator/src/styles/adm.css stands two children at the two ends of a strip, and both
// ../routes/_index.tsx's shells and the panel route ./connect-panel.tsx draws take that slot on the
// same terms.

/* where better.giving is, for an operator standing on the console of a deployment it makes.

   they are the organisation's own addresses and stand at the trailing end of the foot, opposite the
   release: what the screens above are about is one cloudflare account and one deployment, and none
   of this is about either. there is no fold behind them — a run of marks is what a foot of small
   print is, and a heading over six links would be a section on a page that has none. every one of
   them leaves this machine, so each is the external idiom: the console is served from localhost and
   a link that replaced the tab would take the operator off it.

   **the six pictures are those companies' trademarks and are used to point at better.giving's own
   profile on each, and for nothing else** — not as decoration, not as a tone, and not to say that
   anything here is theirs. the files are ../assets/social/, each taken from the company's own
   published brand assets. the same bar packages/operator/src/components/status/Brand.jsx sets for
   the cloudflare mark it draws.

   each is the whole of its control, so the name a reader who cannot see it is given is the image's
   own `alt` and names the profile rather than the company. the box each mark is drawn in is
   `.adm-footstrip__social` in packages/operator/src/styles/adm.css and differs per mark; the two
   numbers on each element are that file's own pixels, which is what holds the row's height before
   the pictures have loaded. the run they stand in is `.adm-footstrip__socials` in that sheet, and
   it is one end of the strip rather than the whole of it — the strip's own step falls between the
   two ends and never between two marks. */
const SOCIALS = (
	<div className="adm-footstrip__socials">
		<a
			className="adm-footstrip__social"
			href="https://www.linkedin.com/company/better-giving/"
			target="_blank"
			rel="noreferrer"
		>
			<img src={linkedin} alt="better.giving on LinkedIn" width={50} height={43} />
		</a>
		<a
			className="adm-footstrip__social adm-footstrip__social--facebook"
			href="https://www.facebook.com/BetterGivingFB/"
			target="_blank"
			rel="noreferrer"
		>
			<img src={facebook} alt="better.giving on Facebook" width={50} height={50} />
		</a>
		<a
			className="adm-footstrip__social adm-footstrip__social--x"
			href="https://x.com/BetterDotGiving"
			target="_blank"
			rel="noreferrer"
		>
			<img src={x} alt="better.giving on X" width={50} height={51} />
		</a>
		<a
			className="adm-footstrip__social"
			href="https://www.youtube.com/@BetterDotGiving"
			target="_blank"
			rel="noreferrer"
		>
			<img src={youtube} alt="better.giving on YouTube" width={50} height={35} />
		</a>
		<a
			className="adm-footstrip__social adm-footstrip__social--instagram"
			href="https://www.instagram.com/better.giving"
			target="_blank"
			rel="noreferrer"
		>
			<img src={instagram} alt="better.giving on Instagram" width={50} height={50} />
		</a>
		<a
			className="adm-footstrip__social adm-footstrip__social--github"
			href="https://github.com/better-giving"
			target="_blank"
			rel="noreferrer"
		>
			<img src={github} alt="better.giving on GitHub" width={128} height={128} />
		</a>
	</div>
);

export type ProductFootProps = {
	/**
	 * the release this binary was built as, and empty where it names none — a console that names no
	 * release leaves this end of the strip empty rather than standing the word `ver.` in front of a
	 * hole. the error boundary is the one caller that always passes the empty string: it has no
	 * loader and nothing read it.
	 */
	version: string;
};

export function ProductFoot({ version }: ProductFootProps): ReactNode {
	return (
		<>
			{/* the leading end, and it is drawn whether or not it says anything: the strip stands its
			    two children at its two ends, so an end that returned nothing would hand the marks
			    below the leading one. empty, this is a box of no size holding that end open. */}
			<span className="adm-caption">{version === '' ? null : `ver. ${version}`}</span>
			{SOCIALS}
		</>
	);
}
