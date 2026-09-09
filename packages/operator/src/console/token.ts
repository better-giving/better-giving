// the grammar of a console session token: `bg1.<expiresAtEpochSeconds>.<base64url-32-bytes>`.
//
// one statement of the format, read by both ends of the wire. the operator console composes a
// token and the deployment reads one back, and a format written out on each side is a value one
// half mints and the other refuses — with nothing at either site able to say which of the two is
// wrong. so the format is here, once: `mintConsoleToken` composes one, `parseConsoleToken` reads
// one, and `formatConsoleToken` is the spelling both of them go through.
//
// it is in this leaf package because both of its callers are outside it: the console mints, in
// `packages/console/internal/session`, because it is the half that holds the cloudflare sign-in
// and can write the value to the deployment; the deployment reads, in
// `packages/app/src/lib/server/console/access.ts`. neither package imports the other, and a
// grammar living in either of them would be the other one reaching across.
//
// there is no clock in this file and none belongs. whether a token has expired is a question about
// the runtime reading it, and it is asked in `packages/app/src/lib/server/console/access.ts` with
// `now` passed in; what is here is only whether a string is a token at all, which is the same
// answer on both sides at any moment.
//
// nothing here is a permanent contract in CLAUDE.md's sense — no site has this pasted into it, and
// the value it names lives on one deployment for at most twelve hours. changing the version prefix
// costs a reconnect and nothing else.

/**
 * the version at the front of every token.
 *
 * it is what makes a second format possible without a guess: a value that does not open with this
 * is not a token of this grammar, whatever else it is, so a later `bg2` can be told from a
 * hand-typed word rather than parsed hopefully.
 */
export const CONSOLE_TOKEN_VERSION = 'bg1';

/**
 * the shortest random part a deployment will read as one.
 *
 * 43 characters, which is what 32 bytes of base64url comes to with no padding. it is a length
 * check and not an alphabet check: what it is for is a value somebody set by hand at a
 * `wrangler secret put` prompt — `test` in the right shape is otherwise a credential — and 256
 * bits is what makes the difference between two refusals safe to tell apart (see the note on
 * `session_mismatch` in `packages/app/src/lib/server/console/access.ts`).
 */
export const CONSOLE_TOKEN_MIN_RANDOM = 43;

/**
 * how long a console session lasts, in seconds.
 *
 * twelve hours, and the expiry it produces travels inside the token rather than beside it. it
 * exists for the one case nothing else in this design closes: a console process that dies without
 * disconnecting leaves a live bearer credential set on a public hostname and held by nobody. a
 * laptop lid is that case, and the expiry is what ends it.
 *
 * spent by `mintConsoleToken` below and read back out of the value by the deployment, so both
 * halves agree the unit is seconds without either of them stating it twice.
 */
export const CONSOLE_SESSION_SECONDS = 12 * 60 * 60;

/** a token as its two halves, once a string has been read as one. */
export interface ConsoleToken {
	/**
	 * when the session it names stops being one. compared against a clock in
	 * `packages/app/src/lib/server/console/access.ts`.
	 */
	readonly expiresAt: Date;
	/** the part that is secret. never compared here — this module decides shape and nothing else. */
	readonly random: string;
}

/**
 * why a string is not a token, in the order the checks run.
 *
 * three reasons rather than one, because they are three different mistakes: `malformed` is a value
 * of some other kind entirely, `random-too-short` is a value in the right shape carrying nothing
 * worth guessing at, and `expiry-unreadable` is a token whose middle is not a count of seconds.
 * `packages/app/src/lib/server/console/access.ts` writes a sentence per reason, which is what
 * they are for.
 */
export type ConsoleTokenRefusal = 'malformed' | 'random-too-short' | 'expiry-unreadable';

export type ConsoleTokenParse =
	| { readonly ok: true; readonly token: ConsoleToken }
	| { readonly ok: false; readonly reason: ConsoleTokenRefusal };

/**
 * a token for a session that ends at `expiresAt`, carrying `random`.
 *
 * whole seconds, so a sub-second expiry is truncated on the way in — the value is a bound on a
 * session measured in hours, and a format that carried milliseconds would be a longer string
 * saying nothing more.
 *
 * it validates neither half. the caller is the half that minted `random` and chose `expiresAt`,
 * and a mint that checked its own input would be checking the thing it just produced;
 * `parseConsoleToken` is where a value from anywhere else is checked.
 */
export function formatConsoleToken(expiresAt: Date, random: string): string {
	return `${CONSOLE_TOKEN_VERSION}.${Math.floor(expiresAt.getTime() / 1000)}.${random}`;
}

/**
 * a string read as a token, or the reason it is not one.
 *
 * split on every dot rather than on the first two, so a value with a third dot in it is refused
 * rather than quietly having the tail folded into the random part — a token is exactly three
 * fields and a fourth means the value came from somewhere else.
 *
 * the expiry is digits only. `Number(' 1755600000')` and `Number('0x68a4c180')` are both finite
 * numbers, so a shape check that leaned on `Number` alone would read a padded paste and a hex
 * literal as valid times; `Number.isSafeInteger` on top of that is what keeps a value too large
 * for a `Date` out of one, since `new Date(1e21)` is `Invalid Date` and every comparison against
 * it is false — which would read as a session that never expires.
 */
export function parseConsoleToken(value: string): ConsoleTokenParse {
	const parts = value.split('.');
	const [version, expiry, random] = parts;
	if (parts.length !== 3 || version !== CONSOLE_TOKEN_VERSION || expiry === undefined)
		return { ok: false, reason: 'malformed' };

	if (random === undefined || random.length < CONSOLE_TOKEN_MIN_RANDOM)
		return { ok: false, reason: 'random-too-short' };

	if (!/^\d+$/.test(expiry)) return { ok: false, reason: 'expiry-unreadable' };
	const seconds = Number(expiry);
	if (!Number.isSafeInteger(seconds * 1000)) return { ok: false, reason: 'expiry-unreadable' };

	return { ok: true, token: { expiresAt: new Date(seconds * 1000), random } };
}

/** a minted session: the value to write to the deployment, and the two halves it was made of. */
export interface MintedConsoleToken {
	/** the whole token, which is the credential. */
	readonly token: string;
	/** when the session it names ends, already floored to the second the format stores. */
	readonly expiresAt: Date;
	/** the secret half on its own, so a caller can assert its shape without splitting a string. */
	readonly random: string;
}

/**
 * a session token for a console connecting now.
 *
 * 32 bytes from the platform's own random source, spelled base64url with nothing padding it —
 * which is the 43 characters `CONSOLE_TOKEN_MIN_RANDOM` above is the floor for. base64url rather
 * than base64 because the grammar splits on dots and a `+` or a `/` in the secret half would ride
 * through a shell, a header and a url unequally; the padding goes because it carries no entropy
 * and `=` is the one character of base64 that anything downstream is liable to strip.
 *
 * `now` is an argument rather than a clock read inside, so the twelve hours can be asserted
 * against a stated instant rather than against a second reading of the same clock.
 *
 * the expiry is floored to the second before it is returned, not only before it is formatted: the
 * caller holds this value to decide when to warn, and the deployment reads its own copy back out
 * of the token — so a mint that kept the milliseconds would hand the two halves expiries that
 * differ by less than a second and are still not equal.
 */
export function mintConsoleToken(now: Date): MintedConsoleToken {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const random = base64url(bytes);
	const expiresAt = new Date((Math.floor(now.getTime() / 1000) + CONSOLE_SESSION_SECONDS) * 1000);
	return { token: formatConsoleToken(expiresAt, random), expiresAt, random };
}

/**
 * bytes as base64url with no padding.
 *
 * through `btoa`, which every runtime this package is read in has — node, a browser and workerd
 * alike — and which takes one character per byte rather than a string of text, so the binary is
 * spelled out a code unit at a time on the way in.
 */
function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
