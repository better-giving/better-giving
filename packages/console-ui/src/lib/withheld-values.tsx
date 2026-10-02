import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSubmit } from 'react-router';
import type { DeployVarName, ValuesRefusal, VarsWritten } from '../api/types';
import { refusalIn } from './secret-trouble';

// the one state a box cannot be typed out of, and the press out of it.
//
// **a withheld name is a binding under one of the deploy-time values that is not plain text**,
// which is a deployment that stored the value as a secret (`DeployedVar` in ../api/types.ts). the
// value is there and the deployment reads it; nothing hands it back, and no write may set the name
// while it stands that way — cloudflare would leave the deployment holding the name twice, so the
// binary refuses the write instead (`SetVars` in `packages/console/internal/deployment/write.go`).
// so the only way on is to take the value off first.
//
// **it is one component because it is one act on four pages.** the mail values, the dashboard
// password and each processor's keys can arrive in this state, and the press is the same press
// wherever it is drawn: it carries the intent alone and the binary frees every withheld name at
// once off cloudflare's own answer, because a name that travelled through a page is a credential
// deleted wherever that page said. what stays with each page is which of the names its own press
// writes are in this state — its boxes and whatever it writes without one — and what the page stops
// doing until they are stored again ({@link consequence}). `withheldInGroup` in ./held-values.ts is
// that reading, and argues why it is not the boxes alone.
//
// **so the sentence over the boxes is the page's and the confirm is the deployment's.** the page's
// own boxes are what an operator is standing at, and they are what the sentence and the button are
// scoped to; the card is the one place the press states what it will do, and what it does is every
// withheld name on the deployment — itemised there, because a card headed with one page's name that
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
 * cloudflare answered, which `freeWithheldVars` in ../api/client.ts argues; each page that draws the
 * press answers it in its own `clientAction` (../routes/_sections.password.tsx and the others), and
 * `/` answers it for the account panel (../routes/_index.tsx).
 */
export const FREE_INTENT = 'free';

/**
 * a press posted through a fetcher to another route's action, which is how a block standing over
 * every page posts: the page under it stays where it is, and the answer is read under `fetcherKey`.
 * absent, a press posts to its own page's route as a navigation.
 */
export type FetcherPost = { action: string; fetcherKey: string };

/**
 * the sentence over the boxes that cannot be typed, and the press that frees them.
 *
 * it draws nothing where the page has no such box, so a caller states it unconditionally beside the
 * boxes it is about.
 */
export function WithheldValues({
	names,
	all,
	consequence,
	written,
	trouble,
	busy,
	freeing,
	post
}: {
	/** the names this page's own press writes that are in this state, in the enumeration's order. */
	names: readonly DeployVarName[];
	/**
	 * every name on the deployment in this state, in the enumeration's order, which is what the one
	 * press frees and what the card itemises.
	 *
	 * it carries {@link names} among it, and where the page's boxes are the whole of it the two are
	 * the same list.
	 */
	all: readonly DeployVarName[];
	/** what this deployment stops doing between the free and the next save, in the page's own words. */
	consequence: ReactNode;
	/**
	 * how the last free press went, or `null` where none has been made.
	 *
	 * only a failure is drawn. a press that landed leaves no withheld name behind, so the next
	 * reading takes this whole block off the screen — which is the outcome reported at the control
	 * that caused it, in the strongest form there is.
	 */
	written: VarsWritten | null;
	/** what a failed write says, in the words the page holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** something else on the page is writing, which holds this press closed with the rest. */
	busy: boolean;
	/** this press is the one in flight. */
	freeing: boolean;
	/** where the press posts, where that is not its own page ({@link FetcherPost}). */
	post?: FetcherPost | undefined;
}): ReactNode {
	/* the press posts on its own rather than through a `<Form>`: this block stands among the boxes
	   it is about, and those are inside a form of their own — a `<form>` inside a `<form>` is not a
	   tree the parser keeps, and the confirm is a `<dialog>` rendered where react put it rather than
	   portalled out. what it posts is the intent alone, which is the whole of what this press
	   carries (./withheld-values.tsx's {@link FREE_INTENT}). */
	const submit = useSubmit();

	/** whether the confirm is on the screen. */
	const [asking, setAsking] = useState(false);

	/* where the reader lands once a free that landed has taken this block, and the Remove that put
	   the card up, off the page: the first control of the form the press stood in, which is the state
	   the free leaves — the boxes it stood among, writable again. the form is kept at the press,
	   because by the time the card comes down the Remove is gone; the control is found when the card
	   comes down, because that is when the one to land on is standing (`fallbackFocus` in
	   packages/operator/src/behaviour/Dialog.tsx). */
	const pressedIn = useRef<HTMLFormElement | null>(null);
	const landing = useMemo<RefObject<HTMLElement | null>>(
		() => ({
			get current() {
				const form = pressedIn.current;
				return form?.isConnected
					? form.querySelector<HTMLElement>(
							'input:not([type="hidden"]):enabled, select:enabled, textarea:enabled, button:enabled'
						)
					: null;
			}
		}),
		[]
	);

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
				    does: what it costs is stated in the confirm, against the values it is about.

				    both presses here are held with `aria-disabled` and turned away in their own handler,
				    never closed by `disabled`: a natively closed button drops the focus standing on it,
				    and the `aria-busy` beside it is then heard by nobody
				    (../closed-while-writing.spec.ts). */}
				<Button
					type="button"
					variant="danger"
					onClick={(event) => {
						if (busy || freeing) return;
						pressedIn.current = event.currentTarget.form;
						setAsking(true);
					}}
					aria-disabled={busy || freeing || undefined}
					aria-busy={freeing || undefined}
				>
					Remove {said}
				</Button>
			</div>

			{!asking ? null : (
				<Modal
					title={one ? `Remove ${all[0]}?` : 'Remove these values?'}
					onDismiss={() => setAsking(false)}
					fallbackFocus={landing}
					danger="Remove"
					dangerProps={{
						type: 'button',
						'aria-disabled': busy || freeing || undefined,
						'aria-busy': freeing || undefined,
						onClick: () => {
							if (busy || freeing) return;
							void submit(
								{ intent: FREE_INTENT },
								{
									method: 'post',
									preventScrollReset: true,
									...(post && { ...post, navigate: false })
								}
							);
						}
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
