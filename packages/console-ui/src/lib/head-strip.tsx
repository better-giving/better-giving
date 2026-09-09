import { Brand } from '@better-giving/operator/components/status/Brand';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { Mark } from '@better-giving/operator/components/status/Mark';
import type { ReactNode } from 'react';
import logo from '../assets/bettergiving-logo.webp';

// the one head this console draws, on every screen that has an identity to state.
//
// **it is two ends and nothing between them: better.giving's own wordmark at the leading end, and
// at the trailing end who this machine is signed in as with the one press this console offers
// beside it.** what that press does differs by screen and the pair is the point either way: on
// ./connect-panel.tsx it acts on the identity it stands next to, and on the connected screen it
// stands with the account and ends the run this console is (../routes/_index.tsx). a press at the
// far side of the strip from anything it stands with reads as acting on the strip — which is what
// the connected screen said for as long as the account sat at one end and its press at the other.
//
// **that end is one card holding two zones, and it never breaks apart**: the identity in the
// leading zone, the press welded to it in the trailing one. the shared ground is what says the two
// are one object at every width — a strip too narrow for the wordmark and the card puts the card on
// the line under the wordmark whole, rather than leaving the press to find a row of its own. the id
// sits under the name inside the leading zone, because it is a detail of the name rather than a
// third thing on the row.
//
// **the wordmark names no release.** which release this binary is stands in the foot
// (./product-foot.tsx), where the rest of this console's small print is; a version beside the
// masthead reads as a claim about the deployment rather than about the machine the console is
// running on.
//
// **both surfaces draw it from here.** ../routes/_index.tsx stands it on
// packages/operator/src/components/shell/BareShell.jsx's head slot and ./connect-panel.tsx stands
// it in `PanelRoute`'s, and each of those slots is the same `.adm-head` band — so what differs
// between the two screens is what the identity is, and nothing else. two copies is how the console
// came to have two different heads in the first place.

/** the trailing end: the identity, and the one control that acts on it. */
export function HeadIdentity({
	name,
	note,
	control
}: {
	/** what the identity is called — an account's name, the address a sign-in is held under. */
	name: ReactNode;
	/** the id under that name, where the name is not what anything is resolved by. */
	note?: ReactNode;
	/**
	 * the one press at this end of the strip, welded to the identity beside it. what it acts on is
	 * the screen's — the identity on one, the run this console is on the other — and where it stands
	 * is this module's. `null` on a screen that offers none.
	 */
	control: ReactNode;
}): ReactNode {
	const who =
		name === null && note === undefined ? null : (
			<span className="adm-headstrip__who">
				{/* cloudflare's logo stands in front of the name, because what it names is whose account
				    this is and the name never says the word: `Riverside Shelter's Account` and a bare
				    email address are both silent about the company holding them. so it takes its label —
				    packages/operator/src/components/status/Brand.jsx lets a logo go without one only
				    where the company is already in the text it is drawn with, and this is not that.

				    it stands beside the name rather than inside it, in a column of the block's own, so
				    that the id under the name begins where the name begins. inside the name it was part
				    of that line's text and the id started under the logo, which reads as the id being
				    the thing the logo names. it is on the name's row and never on the id's for the same
				    reason: the id is a detail of the name, and a logo in front of it would name the
				    detail. */}
				{name === null ? null : <Brand name="cloudflare" label="Cloudflare" />}
				{name === null ? null : <span className="adm-headstrip__name">{name}</span>}
				{note === undefined ? null : <span className="adm-headstrip__note">{note}</span>}
			</span>
		);
	/* the card is what holds the two zones together, so a face with neither a name nor an id to
	   state — cloudflare gives no address for some browser sign-ins — stands the press on the band
	   on its own rather than in a card with one zone in it. a wash behind a lone control is a pale
	   margin round it and reads as the identity it has nowhere to put. */
	if (who === null) return control;
	return (
		<div className="adm-headstrip__identity">
			{who}
			<span className="adm-headstrip__act">{control}</span>
		</div>
	);
}

/** the strip's two ends, for the slot that draws the strip itself. */
export function HeadEnds({ children }: { children: ReactNode }): ReactNode {
	return (
		<>
			{/* the product's own mark, and the alt is the spelling the picture draws rather than this
			    repository's name or the element's tag — what a reader who cannot see it is told is
			    whose console this is. the height is `.adm-headstrip__brand` in
			    packages/operator/src/styles/adm.css; the two numbers here are the file's own pixels
			    and are what gives the strip its box before the picture has loaded, so the identity
			    across from it does not shift once it does. */}
			<img
				className="adm-headstrip__brand"
				src={logo}
				alt="better.giving"
				width={200}
				height={68}
			/>
			{children}
		</>
	);
}

/* a line the head states under its strip.

   both of the console's are about this machine rather than about anything on the screen, both stay
   true for as long as this console is open, and neither stops anything this session — so each is
   small print with a warning mark and never a `Banner`, which is a box that reads as something
   holding the operator up. it is the standing-condition row a field states under a box, at the head
   band's own inset: `.adm-headnote` in packages/operator/src/styles/adm.css is where that is drawn
   and argued.

   the mark is decoration and takes no label: what it says is the tone of the line beside it, and a
   named one would be read out in front of every one of these sentences. */
function HeadNote({ children }: { children: ReactNode }): ReactNode {
	return (
		<p className="adm-headnote">
			<Mark name="triangle-alert" />
			<span>{children}</span>
		</p>
	);
}

export type ConsoleHeadProps = {
	/** the account this console is working in. */
	account: string;
	accountId: string;
	/** the press that stands beside that account, or `null` where none is offered. */
	control: ReactNode;
	/** whether the choice of account was written down. */
	remembered: boolean;
	/** the folder a renewed sign-in could not be written to, or `null` where it was written. */
	notKept: string | null;
};

/**
 * the whole head as one node, for `BareShell`'s head slot: the strip, and the lines under it.
 *
 * the two lines are the head's own rather than a third end on the strip. each is a fact about this
 * machine that no screen under the head would otherwise say, and each is true on every one of them
 * — so a line stands across the band under the strip, and none is drawn where neither is true.
 * both can be true at once.
 *
 * the folder is named in the second because the binary is the only half that knows it, and it is
 * the only thing in either sentence an operator can act on.
 */
export function ConsoleHead({
	account,
	accountId,
	control,
	remembered,
	notKept
}: ConsoleHeadProps): ReactNode {
	return (
		<>
			<div className="adm-headstrip">
				<HeadEnds>
					<HeadIdentity name={account} note={accountId} control={control} />
				</HeadEnds>
			</div>
			{notKept === null ? null : (
				<HeadNote>
					Couldn&rsquo;t save the renewed Cloudflare sign-in. <InlineCode>{notKept}</InlineCode>{' '}
					couldn&rsquo;t be written to, so the console asks you to sign in again the next time it
					starts.
				</HeadNote>
			)}
			{remembered ? null : (
				<HeadNote>
					Won&rsquo;t remember this account. The console asks which one to use again the next time
					it starts.
				</HeadNote>
			)}
		</>
	);
}
