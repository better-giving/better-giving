import { readAdminPassword } from '@better-giving/operator/admin-password';
import { VALUE_FIELD } from './secret-groups';

// what a group's boxes asked the deployment to do, read out of the form the operator pressed.
//
// **the reading is the form's own.** what an empty box means is decided by what the box was drawn
// holding, which is a fact about the page and not about the account — so the press reads it in the
// browser and posts the act rather than the boxes, and what crosses to the binary is the names to
// set and the names to remove (`packages/console/internal/deployment/write.go`).
//
// **nothing here reaches a network, and the values it answers with are on their way into one
// request body and nowhere else.** the payload goes to the binary over the loopback address and
// from there into cloudflare's own write, so a name this refuses is a name that never leaves the
// page.

/** what a group's boxes asked for, or which of them could not be read as an act. */
export type SecretEdits =
	| { ok: true; payload: Record<string, string | null> }
	/** keyed by the name of the box at fault, which is where the screen prints the sentence. */
	| { ok: false; errors: Record<string, string> };

const BLANK =
	'This is only spaces, which the deployment reads as nothing at all. Type a value, or empty the box to remove it.';

const NO_PASSWORD =
	'Without one, nobody can sign in to /admin. Type a new one, or put back the one that was here.';

/**
 * the sentence emptying the box under `name` is refused by, or `null` where an emptied box is the
 * removal it reads as.
 *
 * `ADMIN_PASSWORD` is the whole of it. every other value a group holds is a capability the
 * deployment does without and an operator takes off on purpose — mail goes unsent, cards are not
 * taken. this one is how the operator reaches /admin at all: with the name unset the deployment
 * refuses every sign-in (`readStaffCredential` in packages/app/src/lib/server/auth/credential.ts),
 * and the only way back is this same box. so the box takes a new password and nothing else, and the
 * refusal stands where the length rule's does rather than behind a confirm — what an operator who
 * cleared the box was reaching for is a password they have not typed yet.
 *
 * it is asked only where the deployment is holding one. a box drawn empty that came back empty is
 * answered above, so a deployment that has never stored a password is not a press refused over a
 * box nobody went near.
 */
function irremovable(name: string): string | null {
	return name === 'ADMIN_PASSWORD' ? NO_PASSWORD : null;
}

/**
 * the sentence a value being stored under `name` is refused by, or `null` where the deployment
 * states no rule about it.
 *
 * `ADMIN_PASSWORD` is the whole of it, and the sentence is the deployment's own rather than a
 * second wording of the same rule: it passes through no save the deployment can refuse, so what
 * stops an unusable one is this reading, and an operator refused by one end in words the other
 * never uses is being told about two rules
 * (`readAdminPassword` in packages/operator/src/admin-password.ts).
 *
 * it is asked only where a value would be stored. an untouched box, a removal and a box holding
 * only whitespace are each answered above, and running a removal through a rule about length would
 * refuse the operator's own gesture for taking a value away.
 */
function unusable(name: string, value: string): string | null {
	if (name !== 'ADMIN_PASSWORD') return null;
	const reading = readAdminPassword(value);
	return reading.ok ? null : reading.problem;
}

/**
 * what a group's boxes asked the deployment to do, read one name at a time.
 *
 * **there is one reading and the seed is the whole of it.** every value a deployment is configured
 * with is a plain var and reads back off the account (`DEPLOY_VARS` in
 * packages/operator/src/deploy-split.ts), so every box on this console is drawn holding what the
 * deployment holds — a box that came back at its seed is a box nobody went near, an emptied box
 * over a stored value is that value taken away, and anything else is a value to store. no tick is
 * consulted and none is drawn: emptying the box is the removal. the dashboard password is the one
 * name that gesture is refused for, and {@link irremovable} argues why.
 *
 * **the seeds are the account's own answer and never the body's.** the press reads what cloudflare
 * says the deployment holds before it reads the boxes, so a body claiming a name is stored cannot
 * turn an empty box into a delete, and a body claiming one is not cannot turn an untouched box into
 * a save. a name with no entry was drawn empty, which is the deployment holding nothing under it.
 *
 * **the seed the page drew and the seed this press reads are two moments and can disagree.** the
 * page draws its boxes from one read and the press takes another, so the derivation here is the
 * nearest this can stand to what was on the screen — and a value written between the two is read as
 * a box the operator emptied only if they emptied it.
 *
 * **a name the deployment holds in a form nothing can read back is seeded empty and is untouched.**
 * its box came back at that seed, so this answers nothing about it and writes nothing over it; the
 * fold that drew it says so and offers the press that frees it (./withheld-values.tsx).
 *
 * a value is never trimmed. a leading or trailing space is a character of a credential, and quietly
 * removing one turns a correct paste into a wrong value with nothing on the screen to see — the
 * staff password box at `packages/app/src/routes/login.tsx` states the same rule. what is refused is
 * a box holding *only* whitespace, which is not a value anybody meant to store: the deployment drops
 * it (`readConfigEnv` in packages/app/src/lib/server/config/env.ts), so storing it would leave the
 * screen reading a value back over a name the deployment reads as unset.
 *
 * the payload is built from the names of the group being saved, so a body naming a value under
 * another group's name has nowhere to reach — a press saves the group it was pressed in.
 */
export function secretEdits(
	names: readonly string[],
	posted: FormData,
	/** what each box was drawn holding, which is what the deployment is holding under that name. */
	seeds: Readonly<Record<string, string>>
): SecretEdits {
	const payload: Record<string, string | null> = {};
	const errors: Record<string, string> = {};

	for (const name of names) {
		const typed = posted.get(VALUE_FIELD(name));
		const value = typeof typed === 'string' ? typed : '';
		const was = seeds[name] ?? '';

		// the box came back at the value it was drawn with, so nobody edited it.
		if (value === was) continue;
		if (value === '') {
			const held = irremovable(name);
			if (held === null) payload[name] = null;
			else errors[name] = held;
			continue;
		}
		if (value.trim() === '') {
			errors[name] = BLANK;
			continue;
		}
		const refusal = unusable(name, value);
		if (refusal === null) payload[name] = value;
		else errors[name] = refusal;
	}

	// the group is refused whole rather than written in half: one press is one request, and a
	// deployment holding the boxes that parsed is a deployment in a state nobody asked for.
	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, payload };
}
