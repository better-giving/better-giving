import type { ReactNode, RefObject } from 'react';
import { useCallback, useId, useState } from 'react';
import { CodeSlab } from '../components/data/CodeSlab.jsx';
import { Modal } from './Dialog';

// a secret the deployment keeps no readable copy of — an API key, Zapier's key — shown the one
// time it exists in the clear: the action that made it answers with it, and nothing after that
// can. the card is ./Dialog.tsx's in the "once" arrangement, one way out and no cancel, and what it
// holds is the value on one line with its copy control and the sentence saying this is the only
// chance. the value is never written anywhere by this module: not to storage, not to the URL, not
// to a field a later render could read it back from.
//
// **whether the card is up is the screen's, as it is for every dialog here.** the secret arrives in
// an action's answer, and a router keeps that answer on the page after the card is dismissed —
// through a revalidation and a redraw of the same route — so a screen that rendered the card
// straight from it would put the secret back up on the next render. `useShownOnce` below is that
// screen's state: it holds which secret was dismissed and keys off the value that arrived, so the
// same secret stays down however often the page draws, and a new one comes up.

type ShownOnceProps = {
	/** the question the card asks, naming what the secret is for — `Copy the key for <name>`. */
	readonly title: ReactNode;
	/** the value itself, drawn and copied verbatim. */
	readonly secret: string;
	/** the copy control's name, saying which value it takes — `Copy the key`. */
	readonly copyLabel: string;
	/** Done, Escape and a press on the ground all arrive here, and the screen takes the card down. */
	readonly onDone: () => void;
	/**
	 * where focus lands once the card is down, if the control that made the secret is gone by then —
	 * which it is wherever the make remounts its form. ./Dialog.tsx's `fallbackFocus`.
	 */
	readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
	/**
	 * what else the answer that made the secret says — what the make cost elsewhere — after the
	 * sentence saying this is the only chance. it is in the card's body, so it is read with the card
	 * as it opens; the page behind the card is inert until Done.
	 */
	readonly children?: ReactNode;
};

export function ShownOnce({
	title,
	secret,
	copyLabel,
	onDone,
	fallbackFocus,
	children
}: ShownOnceProps) {
	// the heading names the value's box as well as the card, so the one-line slab — which has no
	// caption of its own to be named by — is read as the thing the question is about.
	const titleId = useId();
	return (
		<Modal
			title={title}
			titleId={titleId}
			onDismiss={onDone}
			exitProps={{ onClick: onDone }}
			fallbackFocus={fallbackFocus}
		>
			<CodeSlab oneline content={secret} copyable copyLabel={copyLabel} labelledBy={titleId} />
			<p className="adm-prose">It won’t be shown again.</p>
			{children}
		</Modal>
	);
}

/**
 * the secret while it has not been dismissed, and the dismissal.
 *
 * what is held is the dismissed value, so the card follows the answer:
 * a redraw carrying the same secret keeps it down, and a second make answering with a new one puts
 * it back up with nothing to reset.
 */
export function useShownOnce(secret: string | undefined) {
	const [dismissed, setDismissed] = useState<string | undefined>(undefined);
	const shown = secret !== undefined && secret !== dismissed ? secret : undefined;
	const done = useCallback(() => setDismissed(secret), [secret]);
	return [shown, done] as const;
}
