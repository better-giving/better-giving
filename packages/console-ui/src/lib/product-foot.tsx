import type { ReactNode } from 'react';
import github from '../assets/social/github.webp';

// the two ends of the strip this console stands at the foot of every screen it draws: which
// product and which release of it this is at one end, and where that product's source is at the
// other.
//
// **the product is named here and in no other strip** — the head is about this machine and the
// account it is signed in to (./head-strip.tsx), and a masthead over that reads as a claim about
// the deployment. the name and the release are one line of small print, which is what this end is
// and where both of them belong.
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

/* where the code this console is running is, for an operator standing on a deployment made from it.

   it is the repository rather than the organisation behind it: what an operator wants from a foot
   is the source of the binary they are looking at, and a landing page is a step away from that.
   there is no fold and no heading behind it — a mark at the end of a run of small print is what a
   foot is. it leaves this machine, so it is the external idiom: the console is served from
   localhost and a link that replaced the tab would take the operator off it.

   **the picture is github's trademark and is used to point at that repository, and for nothing
   else** — not as decoration, not as a tone, and not to say that anything here is theirs. the file
   is ../assets/social/github.webp, taken from the company's own published brand assets. the same
   bar packages/operator/src/components/status/Brand.jsx sets for the cloudflare mark it draws.

   it is the whole of its control, so the name a reader who cannot see it is given is the image's
   own `alt` and names the destination rather than the company. the box it is drawn in is
   `.adm-footstrip__social` in packages/operator/src/styles/adm.css, and the two numbers here are
   that file's own pixels, which is what holds the row's height before the picture has loaded. */
const SOURCE = (
	<a
		className="adm-footstrip__social"
		href="https://github.com/better-giving/better-giving"
		target="_blank"
		rel="noreferrer"
	>
		<img src={github} alt="better.giving source on GitHub" width={128} height={128} />
	</a>
);

export type ProductFootProps = {
	/**
	 * the release this binary was built as, and empty where it names none — a console that names no
	 * release states the product's name alone rather than standing the word `ver.` in front of a
	 * hole. the error boundary is the one caller that always passes the empty string: it has no
	 * loader and nothing read it.
	 */
	version: string;
};

export function ProductFoot({ version }: ProductFootProps): ReactNode {
	return (
		<>
			<span className="adm-caption">
				{version === '' ? 'Better Giving' : `Better Giving ver. ${version}`}
			</span>
			{SOURCE}
		</>
	);
}
