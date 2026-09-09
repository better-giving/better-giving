import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useSubmit } from 'react-router';
import type { DeployVarName, ValuesRefusal, VarsWritten } from '../api/types';
import { refusalIn } from './secret-trouble';

// the one state a box cannot be typed out of, and the press out of it.
//
// **a withheld name is a binding under one of the thirteen that is not plain text**, which is a
// deployment that stored the value as a secret (`DeployedVar` in ../api/types.ts). the
// value is there and the deployment reads it; nothing hands it back, and no write may set the name
// while it stands that way — cloudflare would leave the deployment holding the name twice, so the
// binary refuses the write instead (`SetVars` in `packages/console/internal/deployment/write.go`).
// so the only way on is to take the value off first.
//
// **it is one component because it is one act on three folds.** the mail values, the dashboard
// password and the Stripe keys can each arrive in this state, and the press is the same press
// wherever it is drawn: it carries the intent alone and the binary frees every withheld name at
// once off cloudflare's own answer, because a name that travelled through a page is a credential
// deleted wherever that page said. what stays with each fold is which of the names its own press
// writes are in this state — its boxes and whatever it writes without one — and what the fold stops
// doing until they are stored again ({@link consequence}). `withheldInGroup` in ./held-values.ts is
// that reading, and argues why it is not the boxes alone.
//
// **so the sentence over the boxes is the fold's and the confirm is the deployment's.** the fold's
// own boxes are what an operator is standing at, and they are what the sentence and the button are
// scoped to; the card is the one place the press states what it will do, and what it does is every
// withheld name on the deployment — itemised there, because a card headed with one fold's name that
// deletes a credential belonging to another is a press nobody agreed to.
//
// **the delete has to come first and the value is gone for good the moment it runs**, which is what
// the confirm is for. DEPLOY.md's "Moving from secrets to vars" section is the same move written
// out for an operator.

/**
 * what the press that frees every value this deployment holds in a form nothing can read back
 * posts.
 *
 * it carries the intent and nothing else — which names are freed is read on this machine from what
 * cloudflare answered, and the arm for this intent in ../routes/_index.tsx is where that is argued.
 */
export const FREE_INTENT = 'free';

/**
 * the sentence over the boxes that cannot be typed, and the press that frees them.
 *
 * it draws nothing where the fold has no such box, so a caller states it unconditionally beside the
 * boxes it is about.
 */
export function WithheldValues({
	names,
	all,
	consequence,
	written,
	trouble,
	busy,
	freeing
}: {
	/** the names this fold's own press writes that are in this state, in the enumeration's order. */
	names: readonly DeployVarName[];
	/**
	 * every name on the deployment in this state, in the enumeration's order, which is what the one
	 * press frees and what the card itemises.
	 *
	 * it carries {@link names} among it, and where the fold's boxes are the whole of it the two are
	 * the same list.
	 */
	all: readonly DeployVarName[];
	/** what this deployment stops doing between the free and the next save, in the fold's own words. */
	consequence: ReactNode;
	/**
	 * how the last free press went, or `null` where none has been made.
	 *
	 * only a failure is drawn. a press that landed leaves no withheld name behind, so the next
	 * reading takes this whole block off the screen — which is the outcome reported at the control
	 * that caused it, in the strongest form there is.
	 */
	written: VarsWritten | null;
	/** what a failed write says, in the words the fold holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** something else on the page is writing, which holds this press closed with the rest. */
	busy: boolean;
	/** this press is the one in flight. */
	freeing: boolean;
}): ReactNode {
	/* the press posts on its own rather than through a `<Form>`: this block stands among the boxes
	   it is about, and those are inside a form of their own — a `<form>` inside a `<form>` is not a
	   tree the parser keeps, and the confirm is a `<dialog>` rendered where react put it rather than
	   portalled out. what it posts is the intent alone, which is the whole of what this press
	   carries (./withheld-values.tsx's {@link FREE_INTENT}). */
	const submit = useSubmit();

	/** whether the confirm is on the screen. */
	const [asking, setAsking] = useState(false);

	/* the question is left the moment its own press is answered, whatever the answer says: a free
	   that landed takes this whole block off the screen and a refused one draws its sentence under
	   the control, and neither is readable behind a card. keyed on the answer itself and not on what
	   it carries, so two presses answered the same way still close it. */
	useEffect(() => {
		if (written === null) return;
		setAsking(false);
	}, [written]);

	if (names.length === 0) return null;

	const said = names.join(', ');
	/** whether the press has one value to take off, which every count and every pronoun reads off. */
	const one = all.length === 1;
	const failure = written === null ? null : refusalIn(written);

	return (
		<>
			<p className="adm-prose">
				This deployment holds {said} in a form nothing can read back, so nothing can set the value.
			</p>
			<div className="adm-actions">
				{/* it asks rather than posts, for the reason every other destructive press on this page
				    does: what it costs is stated in the confirm, against the values it is about. */}
				<Button
					type="button"
					variant="danger"
					disabled={busy || freeing}
					onClick={() => setAsking(true)}
				>
					Remove {said}
				</Button>
			</div>

			{!asking ? null : (
				<Modal
					title={one ? `Remove ${all[0]}?` : 'Remove these values?'}
					onDismiss={() => setAsking(false)}
					danger="Remove"
					dangerProps={{
						type: 'button',
						disabled: busy || freeing || undefined,
						'aria-busy': freeing || undefined,
						onClick: () =>
							void submit({ intent: FREE_INTENT }, { method: 'post', preventScrollReset: true })
					}}
					cancel="Go back"
					cancelProps={{ type: 'button', onClick: () => setAsking(false) }}
				>
					<p className="adm-prose">
						<strong>
							This removes every value this deployment holds in a form nothing can read back.
						</strong>{' '}
						Neither this console nor Cloudflare can hand one back, so keep your own copy of anything
						you still need.
					</p>
					<ul className="adm-list">
						{all.map((name) => (
							<li key={name}>
								<code className="adm-chip">{name}</code>
							</li>
						))}
					</ul>
					<p className="adm-prose">{consequence}</p>
					{/* the free and the save after it are two calls to cloudflare and so two versions of the
					    worker, which is the whole of what the round trip costs an operator. it is said in
					    the card rather than over the button because it is a cost of the press and not a
					    reason to hesitate over one. */}
					<p className="adm-prose">
						Removing {one ? 'it' : 'them'} makes a new version of your Worker, and saving{' '}
						{one ? 'it' : 'them'} again makes another.
					</p>
				</Modal>
			)}

			{failure === null ? null : trouble(failure)}
		</>
	);
}
