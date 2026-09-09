import type { RefObject } from 'react';

// where the anti-abuse challenge draws, and it is last on the details step on purpose.
//
// the challenge stands behind the press rather than being a field on the way to it, and most donors
// never see it — the widget is rendered in the mode that draws nothing at all unless a visitor is
// actually asked to interact, so a box anywhere else in that column would hold a gap open for
// something usually absent. `.challenge` in the form package's layout sheet cancels the step's gap
// for the same reason, which is what makes the empty case cost no space.
//
// it is on the details step rather than on the one whose press spends its token, and the screens
// between the two are the reason: a challenge is drawn at the last moment it can be drawn without
// the donor waiting on it, and from there it has that step's typing and the review step to finish
// in. `startCheckout` in ./machine.ts is what watches for the arrival, because the reset that
// follows is a transition and only the actor's own subscription sees one.
//
// the box carries no react children and no part name. what appears inside is drawn by the challenge
// provider inside its own frame, and the form package's parts.ts is explicit that a name absent from
// its vocabulary is a decision rather than an oversight — there is nothing here a host could style.

export type ChallengeBoxProps = {
	/** the node the widget is rendered into, handed to the checkout rather than looked up. */
	readonly mount: RefObject<HTMLDivElement | null>;
};

export function ChallengeBox({ mount }: ChallengeBoxProps) {
	return <div className="challenge" ref={mount} />;
}
