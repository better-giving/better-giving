import { data } from 'react-router';
import { WHICH_FORM } from '$lib/forms/definition';

// a dashboard press whose request never reached the server, answered in the browser as the
// refusal of the form that was pressed — so the screen stays where it is, what was typed stays in
// its boxes, and the sheet says why in the message area it already draws a server's refusal in.
// without it the router's fetch rejects inside the action and the route's error boundary replaces
// the whole screen.
//
// a route's `clientAction` calls one of the two below around `serverAction()` and does nothing
// else: the write is still the server action's alone (CLAUDE.md → Bans → Runtime), and every
// answer the server gives, of any status, passes through untouched.
//
// what counts as never reached is a `TypeError`, which is what a browser's `fetch` rejects with
// when no response came back. an error the server's action threw arrives as a plain `Error`
// outside development (react router sanitizes it on the way out), an aborted request as an
// `AbortError`, and a status the server answered with resolves or throws an `ErrorResponse`; each
// of those is rethrown as it came. a request that left and lost its answer on the way back
// rejects the same way as one that never left, so the sentence says the press may not have saved
// rather than that nothing changed; a press that carries its record's version and is pressed again
// after it did land is refused as stale rather than applied twice.
//
// the refusal carries a status, though no server sent one: an action result of 400 or more is
// what keeps the router from reading the screen's loaders again over the same dead connection,
// which would reject in turn and land on the error boundary after all.

/** what a press that never reached the server says. */
export const UNREACHED =
	'That may not have saved: the server couldn’t be reached. Check your connection and press again.';

const UNREACHED_STATUS = 503;

async function unlessUnreached<T, R>(
	serverAction: () => Promise<T>,
	refusal: (error: TypeError) => Promise<R>
): Promise<T | R> {
	try {
		return await serverAction();
	} catch (error) {
		if (error instanceof TypeError) return refusal(error);
		throw error;
	}
}

/**
 * the server's answer to a press on one of a screen's forms, or that form's refusal saying it
 * never reached the server. the form is the one the body names in `WHICH_FORM`, read from a copy
 * taken before `serverAction()` spends the body.
 */
export function formPress<T>(request: Request, serverAction: () => Promise<T>) {
	const sent = request.clone();
	return unlessUnreached(serverAction, async (error) => {
		const id = (await sent.formData()).get(WHICH_FORM);
		if (typeof id !== 'string') throw error;
		return data(
			{ form: { id, result: { status: 'error' as const, error: { '': [UNREACHED] } } } },
			{ status: UNREACHED_STATUS }
		);
	});
}

/** the images route's answer to an upload, or its refusal saying the photo never reached it. */
export function photoUpload<T>(serverAction: () => Promise<T>) {
	return unlessUnreached(serverAction, async () =>
		data({ error: UNREACHED }, { status: UNREACHED_STATUS })
	);
}
