// what a dashboard password has to be before a deployment will authenticate against it, and the one
// sentence about a value that is not one.
//
// **the rule is here because `ADMIN_PASSWORD` passes through no deployment save at all.** every
// other value an operator types crosses a parse on the deployment that can refuse it and answer
// with a sentence; this one the console writes straight to the cloudflare account, and the
// deployment first meets it when somebody tries to sign in. so a rule stated only on the deployment
// is a rule the operator learns by being locked out: the console reports the value stored, the
// set-up check counts the job done, and the sign-in screen refuses every attempt with nothing on
// either surface saying why.
//
// this is the reading and not only the number. a console holding the constant alone would write its
// own sentence, and the sentence is the half that has to match — an operator refused by one end in
// words the other never uses is being told about two rules.
//
// **the deployment stays the authority for whether a sign-in happens.**
// `packages/app/src/lib/server/auth/credential.ts` reads what its worker was started with and is
// what the sign-in path asks; the console reading a typed value first is what stops an unusable one
// being stored in the first place.
//
// **the value is never echoed and never measured.** it is the whole of this app's credential
// entropy and the sentence is printed under a box somebody is typing into, so neither the value nor
// its length is in one — a refusal read over a shoulder is a refusal that gave something away.
//
// **the sentences a typed value is refused by are the operator's own words; the ones about a
// variable's shape keep the variable's name.** what an operator can reach by typing is a value too
// short and a value that is only spaces, and both are answered in the words of the box they are
// standing at — a fundraiser who typed six characters is not being told about an environment
// variable. absent, empty and not-a-string are reachable only from a deployment's env, where the
// reader is an agent holding a 5xx body (CLAUDE.md) and the name is the useful half. what that body
// needs beyond either — which variable, and where to set it — its own wrapper states
// (`readStaffCredential` in `packages/app/src/lib/server/auth/credential.ts`).
//
// **the length rule is stated over the box as well as under it.** a screen that first mentions a
// rule in a refusal is a screen an operator submits, corrects and submits again to find out what it
// wanted; the console's two password boxes carry the minimum as a hint before anything is typed
// (`packages/console-ui/src/routes/_index.tsx` and `packages/console-ui/src/lib/password-fold.tsx`),
// and the sentence below is what that same rule sounds like when it has been broken.
//
// this package is a leaf and imports nothing of the app's, which is what makes it the only place
// both ends can reach. it is plain typescript rather than zod: the checks below are a sequence where
// the first failure is the only message worth showing, and a schema reports every check that failed
// in no guaranteed order.

/**
 * shortest `ADMIN_PASSWORD` a deployment will authenticate against.
 *
 * this is the credential standing in front of `/admin`. there is no KDF to make guessing expensive —
 * `packages/app/src/lib/server/auth/credential.ts` argues why there can be none — so a short
 * password is guessable online rather than merely offline, and what bounds the rate is the
 * `SIGN_IN_RATE_LIMITER` binding: `signInRateLimitKey` in
 * `packages/app/src/lib/server/api/rate-limit.ts`, charged on the sign-in path, rather than the cost
 * of a compare. refusing a short one is worth more than accepting it politely.
 *
 * it is also the app's entire credential entropy — there is no second value to guess, so the nominal
 * search space is the password alone. `packages/app/.dev.vars.example` tells the operator to
 * generate the value rather than choose it.
 *
 * exported so both ends assert the boundary rather than a number copied out of this file, which is
 * how a minimum silently stops being tested when it is raised.
 */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * the username the dashboard password signs in as.
 *
 * a constant and not a value an operator picks, which is what lets the console state it beside the
 * password box before the deployment has ever run. `packages/app/src/lib/server/auth/staff-plugin.ts`
 * stores it as the one staff row's identifier and argues why a username sits in an email column; it
 * is declared here for the reason the length rule is — both surfaces read one value, and a console
 * typing the word itself is a hint that lies the day the identifier moves.
 */
export const ADMIN_USERNAME = 'admin';

/**
 * a candidate read: the value itself where it is usable, and the sentence where it is not.
 *
 * the value comes back on the `ok` arm because the deployment's caller holds it as `unknown` and has
 * to narrow it before comparing anything against it.
 */
export type AdminPasswordReading =
	| { readonly ok: true; readonly password: string }
	| { readonly ok: false; readonly problem: string };

/**
 * whether a candidate is a dashboard password this deployment can authenticate against.
 *
 * `unknown` rather than `string`, because one caller reads a platform env. `wrangler types` folds
 * the keys of a gitignored `.dev.vars` into the generated `Env` as required `string`s, so a value
 * that is not one arrives typed as though it were; without the check it reaches `.length`, where
 * `undefined < 12` is false and a truthy non-string passes as a credential nothing could ever match.
 *
 * absent, empty and whitespace-only are three sentences rather than one because they are three
 * different mistakes: a variable nobody set, a box submitted blank, and a value somebody meant that
 * carries nothing to compare. the first two name the variable and the third does not, for the
 * reason the header gives: only the third is a thing an operator can type.
 *
 * nothing is trimmed. whitespace is a legal password character and trimming would change the
 * credential, so a leading space is kept and a value that is only whitespace is refused outright.
 */
export function readAdminPassword(candidate: unknown): AdminPasswordReading {
	if (candidate === undefined) return { ok: false, problem: 'ADMIN_PASSWORD is not set.' };
	if (typeof candidate !== 'string')
		return {
			ok: false,
			problem: `ADMIN_PASSWORD is set but is not a string (it is a ${typeof candidate}).`
		};
	if (candidate === '') return { ok: false, problem: 'ADMIN_PASSWORD is set but empty.' };
	if (candidate.trim() === '') return { ok: false, problem: 'Must be something other than spaces' };
	if (candidate.length < MIN_ADMIN_PASSWORD_LENGTH)
		return {
			ok: false,
			problem: `Must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
		};

	return { ok: true, password: candidate };
}
