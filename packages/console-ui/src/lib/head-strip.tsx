import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { Brand } from '@better-giving/operator/components/status/Brand';
import { Mark } from '@better-giving/operator/components/status/Mark';
import type { ReactNode } from 'react';

// the one head this console draws, on every screen that has an identity to state.
//
// **it is two ends and nothing between them: who this machine is signed in as at the leading end,
// and at the trailing end the one press this console offers.** what that press does differs by
// screen: on ./connect-panel.tsx it acts on the identity across the strip from it, and on the
// connected screen it ends the run this console is (../routes/_index.tsx). the strip's own
// `space-between` is the whole of what holds them apart — neither end is drawn inside the other,
// and there is no card around the pair.
//
// **the press is its mark and no word.** its `aria-label` is the whole of its name — `Close
// console` on one screen, `Sign out of Cloudflare` on the other — and nothing stands in for the
// word it does not carry: no heading over it, no label beside it, no tooltip. what places it is
// the one head it is ever drawn in, which carries one press and never two.
//
// **the identity is one row**: cloudflare's mark, the name, a `/`, and the id. the id follows the
// name on the line rather than sitting under it, and the row wraps as one block — it is a detail
// of the name either way, and on the line after a separator it reads as one without a second row
// to put it on.
//
// **no product mark stands here.** whose console this is and which release it is are both the
// foot's (./product-foot.tsx), where the rest of this console's small print is: a masthead over
// the account reads as a claim about the deployment rather than about the machine the console is
// running on, and this strip is about the machine.
//
// **both surfaces draw it from here.** ../routes/_index.tsx stands it on
// packages/operator/src/components/shell/BareShell.jsx's head slot and ./connect-panel.tsx stands
// it in `PanelRoute`'s, and each of those slots is the same `.adm-head` band — so what differs
// between the two screens is what the identity is, and nothing else. two copies is how the console
// came to have two different heads in the first place.

/** the strip's two ends: the identity, and the press standing opposite it. */
export function HeadIdentity({
	name,
	note,
	control
}: {
	/** what the identity is called — an account's name, the address a sign-in is held under. */
	name: ReactNode;
	/** the id beside that name, where the name is not what anything is resolved by. */
	note?: ReactNode;
	/**
	 * the one press at the trailing end. what it acts on is the screen's — the identity on one, the
	 * run this console is on the other — and where it stands is this module's. `null` on a screen
	 * that offers none.
	 */
	control: ReactNode;
}): ReactNode {
	return (
		<>
			{/* the leading end, and it is drawn whether or not it says anything: the strip stands its
			    two children at its two ends, so an end that returned nothing would hand the press the
			    leading one. cloudflare gives no address for some browser sign-ins, and empty this is a
			    box of no size holding that end open. */}
			<span className="adm-headstrip__who">
				{name === null ? null : (
					<>
						{/* cloudflare's logo stands in front of the name, because what it names is whose
						    account this is and the name never says the word: `Riverside Shelter's Account`
						    and a bare email address are both silent about the company holding them. so it
						    takes its label — packages/operator/src/components/status/Brand.jsx lets a logo
						    go without one only where the company is already in the text it is drawn with,
						    and this is not that. */}
						<Brand name="cloudflare" label="Cloudflare" />
						<span className="adm-headstrip__name">{name}</span>
					</>
				)}
				{note === undefined ? null : (
					<>
						{/* the separator is drawn and never read out: it is punctuation between two values
						    that already stand apart in the tree, and a reader told `slash` between an
						    account's name and its id is told about the strip rather than about the account. */}
						<span className="adm-headstrip__sep" aria-hidden="true">
							/
						</span>
						<span className="adm-headstrip__note">{note}</span>
					</>
				)}
			</span>
			{control}
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
	/** the press that stands opposite that account, or `null` where none is offered. */
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
				<HeadIdentity name={account} note={accountId} control={control} />
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
