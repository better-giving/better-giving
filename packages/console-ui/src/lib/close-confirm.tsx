import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import type { ButtonProps } from '@better-giving/operator/components/controls/Button';
import type { ElementType, ReactNode } from 'react';
import { Link, useFetcher, useNavigate } from 'react-router';
import { saidClosing } from './close-answer';

// the press that stands over every screen rather than on one — ending this console — and the confirm
// it asks through, beside the intent `/`'s check-again press posts.
//
// **the close is answered by `/`'s `clientAction` (../routes/_index.tsx), wherever it is pressed.**
// a press is answered by the route whose address it posts to, and the sections layout has no address
// of its own to post to (../routes/_sections.tsx): it is pathless, so no address names it. so it
// posts to `/?index` through a fetcher, which answers without navigating off the page the operator
// is on — the `?index` is what names that route rather than the root above it
// (https://reactrouter.com/explanation/index-query-param).
//
// **the close is one fetcher under one key**, so the screen that draws the confirm and the screen
// that goes blank once it is answered read the same answer without handing it between them.

/** where the close posts. */
export const SHELL_ACTION = '/?index';

/** what the press that reads everything again posts. */
export const CHECK_INTENT = 'check';

/** what the confirm's press posts. */
export const CLOSE_INTENT = 'close';

const CLOSE_FETCHER = 'close-console';

/**
 * whether this console has been asked to stop, and every screen draws nothing from here on.
 *
 * **a blank page is the outcome.** the tab closes where the browser allows it and stays open where
 * it does not, and an empty page is the nearest that refusal gets to the tab that was asked for.
 * what an operator needs — that the run ends, and what to type to come back — is stated in the
 * confirm, before the press, and a page saying it again afterwards is a page restating a press the
 * operator just made.
 */
export function useClosed(): boolean {
	return saidClosing(useFetcher({ key: CLOSE_FETCHER }).data);
}

/**
 * what the close press costs, which is the whole reason it asks: the run ends, and the way back is a
 * command in a terminal rather than anything on this console.
 *
 * **the tab is not promised.** the action asks for it (`window.close()`) and chrome refuses it on a
 * tab no script opened, so a sentence saying the tab closes is one the operator watches fail. what
 * is stated is what is true on both paths: the console stops, and `start` opens it again.
 *
 * the `<form>` stands around the whole dialog rather than around the control that submits it, which
 * is the rule `Dialog` states: the actions row holds controls, and a submit belongs to the form
 * enclosing it whether or not the element has been lifted into the top layer. the way out is a link,
 * or a plain button where the confirm opened from state, so it posts nothing and the form around it
 * is inert for that press.
 *
 * it takes the `danger` slot rather than the exit one: that slot draws the confirm ahead of the way
 * out, and this is the consequential control on the card.
 */
export function CloseConfirm({
	back
}: {
	/**
	 * the address the confirm was opened over, without the parameter that opened it — or, where it
	 * was opened from state rather than the address, the call that puts it away.
	 */
	back: string | (() => void);
}): ReactNode {
	const navigate = useNavigate();
	const close = useFetcher({ key: CLOSE_FETCHER });
	const ask = <X extends ElementType>(dismiss: () => void, cancelProps: ButtonProps<X>) => (
		<close.Form method="post" action={SHELL_ACTION}>
			<Modal
				title="Close this console?"
				onDismiss={dismiss}
				danger="Close console"
				dangerProps={{
					type: 'submit',
					name: 'intent',
					value: CLOSE_INTENT,
					'aria-busy': close.state !== 'idle'
				}}
				cancel="Back"
				cancelProps={cancelProps}
			>
				<p className="adm-prose">
					The console stops. Type <InlineCode>better-giving start</InlineCode> to open it again.
				</p>
			</Modal>
		</close.Form>
	);
	return typeof back === 'string'
		? ask(() => navigate(back, { preventScrollReset: true }), {
				as: Link,
				to: back,
				preventScrollReset: true
			})
		: ask(back, { type: 'button', onClick: back });
}
