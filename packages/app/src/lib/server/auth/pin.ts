import { data } from 'react-router';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';
import { type AuthEnv, readPin } from './env';

/**
 * what a caller is told where `BETTER_AUTH_URL` names no address. `readPin`'s own message quotes
 * the value and is logged, never sent: the pin is read before anybody is signed in, so whoever
 * reads this may be anonymous. the fix it gives is ./env.ts `readPin`'s, without the value.
 */
export const PIN_UNUSABLE =
	'`BETTER_AUTH_URL` names no http(s) origin, so no one can be signed in. Set it to the address ' +
	'the deployment answers on, scheme included (`https://donate.example.org`), or unset it so the ' +
	`origin is read off each request (DEPLOY.md, .dev.vars.example). ${LOGS_SAY_WHY}`;

/**
 * the pinned origin, or null where none is pinned — thrown as a 500 where the pin names no
 * address, because no screen under the gate signs anybody in until it is fixed.
 *
 * a thrown `data` because react router shows one to the operator and replaces an error's text
 * outside development. a form action answers the same refusal through `invalid()` instead, so the
 * sentence lands under the form it was pressed on.
 */
export function requirePin(env: AuthEnv): string | null {
	const pin = readPin(env);
	if (!pin.ok) {
		console.error('the sign-in pin names no address:', pin.message);
		throw data(PIN_UNUSABLE, { status: 500 });
	}
	return pin.origin;
}
