import { data } from 'react-router';
import { type AuthEnv, readPin } from './env';

/**
 * the pinned origin, or null where none is pinned — thrown as a 500 where the pin names no
 * address, because no screen under the gate signs anybody in until it is fixed.
 *
 * a thrown `data` because react router shows one to the operator and replaces an error's text
 * outside development; the sentence names the variable and the fix (./env.ts `readPin`). a form
 * action answers the same refusal through `invalid()` instead, so the sentence lands under the
 * form it was pressed on.
 */
export function requirePin(env: AuthEnv): string | null {
	const pin = readPin(env);
	if (!pin.ok) throw data(pin.message, { status: 500 });
	return pin.origin;
}
