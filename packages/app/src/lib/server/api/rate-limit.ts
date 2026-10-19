import { data } from 'react-router';
import { INTEGRATIONS_BASE_PATH } from '../integrations/surface';
import { clientIp } from '../runtime/client-ip';
import type { RateLimiter } from '../runtime/rate-limiter';
import { ZAPIER_BASE_PATH } from '../zapier/surface';
import { API_BASE_PATH } from './surface';

// the rate limits this deployment charges, and the one place a caller's key is minted.
//
// the surface bound on `/api/v1` is spent in `src/routes/api.v1.ts`'s middleware above everything
// that costs a read.
//
// CLAUDE.md names rate limiting among the things an endpoint on this surface owes before it
// ships, alongside CORS. the two are not alternatives and they answer different questions: CORS
// decides which page may read an answer, and it bounds nobody who is not using a browser — a
// script, an agent and `curl` are all outside it by design, because `Origin` is an attribution
// signal and never an authorization control. this is what bounds them.
//
// the surface bound knows nothing about what a route does. its charge lands in the `middleware`
// the layout at `src/routes/api.v1.ts` exports, which react router runs after it has matched the
// request to a route and before that route's own handler — so the request that costs the most per
// byte sent is bounded: an id nothing matches still reads `form` before anyone can say there is no
// form. a request answered ahead of the match is not charged and none of them costs a read.
//
// tighter buckets are charged by the code that answers them and are also minted here: the
// quote submission (`src/routes/api.v1.forms.$id.donations.ts`) and the sign-in credential, which
// is charged at each of the five forms that spend a guess at it — the login's own form action,
// the reset request at `src/routes/forgot.tsx`, the invitation and reset links at
// `src/routes/join.tsx` and `src/routes/reset.tsx`, and the password change at
// `src/routes/_app.admin.members_.password.tsx`. each of the five calls the auth layer directly,
// so nothing else in a request's path can charge it. they are in this file rather than
// beside those call sites because of `payer` below — which block of addresses counts as one caller
// is the whole security property of a limit, and a second copy of it is a second place somebody
// can key on a whole ipv6 `/128` and hand one caller an address per request. the sign-in is not on
// this surface and reaches across for exactly that: the key is the shared thing, not the surface.
//
// `/zapier` is a second surface charged through the same limiter under its own key
// (`zapierRateLimitKey`), in `src/routes/zapier.ts`'s middleware, and so are a photo view at
// `/image/:id` (`imageRateLimitKey`) and a view of a donor page (`donorPageRateLimitKey`).
// `/integrations/v1` is a further surface, with two buckets, both spent in
// `src/routes/integrations.v1.ts`'s middleware: the caller's on that same limiter for every
// request, ahead of the key lookup (`integrationsCallerRateLimitKey`), and the key's own on
// `INTEGRATIONS_KEY_RATE_LIMITER` once it is admitted (`integrationsKeyRateLimitKey`).
//
// the buckets are not answered alike when the limiter is missing, and not answered alike for a
// caller the server did not attribute. both differences are written down once, at the foot of this
// file on `refuseIfRateLimited` and `isRateLimited`, and the call sites point here rather than
// restate them. the limiters themselves are `RATE_LIMITS` in ../runtime/rate-limiter.ts, which the
// server builds every one of at start, and `./rate-limit.config.spec.ts` holds this module's
// promises to the sizes declared there.

/**
 * how long a refused caller is told to wait, in seconds — and every limiter's own period, which
 * is the longest a bucket can hold them.
 *
 * `RATE_LIMITS` in ../runtime/rate-limiter.ts sets 60 on every one. the numbers have to agree,
 * because this one is a promise about when the same request works — a bucket that reset forty
 * seconds ago while the answer says to keep waiting is a donor sent away for nothing. nothing in
 * the language joins them, so `./rate-limit.config.spec.ts` holds every answer this module produces
 * to the period declared for the limiter that refused it.
 */
const PERIOD_SECONDS = 60;

/** every caller the server did not attribute, sharing one bucket. */
const UNATTRIBUTED = 'unattributed';

/**
 * what one request counts against.
 *
 * the surface plus the caller, and nothing the caller writes. that exclusion is the whole
 * property: a form id in the key would give an id-scanner a fresh bucket per id it invents, and
 * the scanner is exactly the caller a per-form limit cannot see — `form_not_found` costs a database
 * read and arrives with no valid form to bucket on. the path, the query and the method are out
 * for the same reason.
 *
 * the address is the one the server decided (`clientIp` in ../runtime/client-ip.ts): the TCP peer,
 * or the header a configured fronting proxy writes, and never a header the caller chose — so a
 * caller on the open internet cannot forge it.
 *
 * cannot forge it is not cannot choose among it, and the granularity is what answers the
 * difference. a caller holding a routed ipv6 `/64` — the standard delegation from any vps host —
 * binds a fresh source address per request, so a key on the whole `/128` hands every request a
 * bucket of its own and bounds nothing. an ipv4 address is not subdivided at all and is keyed
 * whole; an ipv4-mapped address (`::ffff:203.0.113.7`) is the ipv4 case in ipv6 notation and
 * counts as the address it holds.
 *
 * for ipv6 the width is chosen per bucket, by what one extra bucket buys the caller (`Ipv6Block`).
 * the sign-in and quote buckets key the `/48`: a `/48` is the block one subscriber is commonly
 * handed and the cheapest a caller can hold many `/64`s inside — 65,536 of them, each a fresh
 * budget of password guesses or gift submissions if the key were the `/64`. this key, the `/zapier`
 * key, the read API's caller key and the photo and donor page keys bound reads, so they keep the
 * `/64`, the smallest block one subscriber or vm is delegated: a `/48` of `/64`s buys reads there,
 * and keying wider would put every donor on an office's or a campus's network in one bucket.
 *
 * an address shared by many people is the accepted cost, and it is what the generous limit in
 * `RATE_LIMITS` is sized against: a mobile carrier puts thousands of real donors behind one
 * address, so the number has to clear a busy campaign on one NAT before it clears a scanner.
 *
 * anything that is not an address shares one bucket rather than getting one each, so an
 * unattributable caller is the most limited there is instead of the least. that covers no address
 * at all and a value that does not parse — a `TRUSTED_PROXY_HEADER` naming a header the proxy in
 * front fills with something other than an address is the operator-side way to reach it, and with
 * it every request to this deployment counts in one bucket and the per-address limit becomes a
 * single tap that one caller can hold closed on every donor at once. a proxy in front with
 * `TRUSTED_PROXY_HEADER` unset reaches the same place by another road: every caller is the proxy's
 * address.
 *
 * this key and `zapierRateLimitKey` accept that and the other keys below do not —
 * `attributedCaller` is where that split is argued, and it is a split about which bucket is the
 * only meter on its surface rather than about how an address is read.
 *
 * the surface prefix is a constant today and is in the key anyway: the counter is named after
 * what it bounds, so a second public surface metered through this limiter gets its own count
 * instead of eating this one's.
 */
export function apiRateLimitKey(request: Request): string {
	return `${API_BASE_PATH} ${caller(request, 64)}`;
}

/**
 * what one submission at `POST /api/v1/forms/:id/donations` counts against, and `null` for a
 * caller with no bucket at all.
 *
 * the same caller as the key above, under a name of its own and on an ipv6 caller's `/48` rather
 * than its `/64` — that key's comment argues the width. the form id is out of it for the
 * reason it is out of that key and the reason is if anything stronger here: this endpoint is
 * reached with an id the caller wrote, and a per-form bucket would hand somebody submitting a
 * thousand invented ids a thousand buckets — while a donor giving to the one form on the site
 * holds one.
 */
export function quoteRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request, 48);
	return payer === null ? null : `${API_BASE_PATH} donations ${payer}`;
}

/**
 * what one sign-in attempt counts against, the deployer's and a member's alike, and `null` for a
 * caller with no bucket at all.
 *
 * named after the credential rather than after a path, and that is what makes five sites one
 * bucket. this bucket bounds guessing at a sign-in credential, so a key that moved with the path
 * would hand a guesser a fresh budget for every way in that is ever added — a wrong password at
 * `/login`, a reset asked for at `/forgot`, a link tried at `/join` or `/reset` and a wrong current
 * password at `/admin/members/password` are one guess at one deployment's credentials, whichever
 * form carried it, and they count together. `/forgot` is on the list for a second reason of its
 * own: a press there mails whoever was named, so the bucket is also what bounds this deployment
 * being used to post somebody else's inbox.
 *
 * the caller and nothing else, so nothing an attacker can write moves the bucket. the submitted
 * password is not in it, since keying on the guess would give every guess a bucket of its own; nor
 * is the identifier typed beside it, since a guesser spreading guesses across every member would
 * then hold a bucket per member. one address, one budget of guesses at every credential here.
 *
 * the `null` is answered by the identity the guess is at, at `src/routes/login.tsx`'s action. a
 * member attempt with no bucket is refused before the password is compared: members are many, each
 * password chosen by a person, and every guess an scrypt run this deployment pays for, so letting
 * it through would be unbounded guessing at all of them. the deployer's attempt is let through
 * uncounted, because refusing it would shut every way into the dashboard at once — under the
 * misread proxy header `attributedCaller` describes that is every caller of the deployment — and one secret,
 * minted by the console unless the operator typed their own, is the cost that leaves unbounded.
 *
 * `src/routes/forgot.tsx`'s action answers it by refusing every request, before the body is read:
 * the deployer's password is never reset from there, so a refusal shuts nobody out of the
 * dashboard, and letting it through would be mail sent to whoever was named without limit.
 */
export function signInRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request, 48);
	return payer === null ? null : `sign-in ${payer}`;
}

/**
 * what one request on `/zapier` that failed the key check counts against: that surface and the
 * caller, charged against the surface limiter in `src/routes/zapier.ts`'s middleware.
 *
 * the same shape as `apiRateLimitKey` — its own prefix, so Zapier's calls never spend a donation
 * form's count, and an unattributed caller in one shared bucket. a caller holding the key is never
 * charged: Zapier's egress addresses are shared by every Zapier user, so a stranger looping a
 * keyless request would otherwise spend this organisation's own subscribes. it is charged through
 * `isRateLimited`, which fails open: the 256-bit key is the bound on guessing.
 */
export function zapierRateLimitKey(request: Request): string {
	return `${ZAPIER_BASE_PATH} ${caller(request, 64)}`;
}

/**
 * what one request on `/integrations/v1` counts against before its key is looked up, and `null`
 * for a caller with no bucket at all: that surface and the caller, charged against the surface
 * limiter on every request, keyed or not.
 *
 * it bounds what one address costs before anything is known about it — how many presented keys it
 * has checked in a minute, and so the indexed read each well-formed one costs. the 256-bit key is
 * what makes a guess hopeless; this is the bound on what hoping costs this deployment. its own
 * prefix, so it never spends a donation form's count or Zapier's.
 *
 * built on `attributedCaller`, unlike the `/zapier` key: this bucket is charged to callers holding
 * a real key too, so one shared bucket for every unattributed caller would let anyone hold every
 * integration closed. the surface is still bounded without it, by the key and the per-key bucket.
 */
export function integrationsCallerRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request, 64);
	return payer === null ? null : `${INTEGRATIONS_BASE_PATH} ${payer}`;
}

/**
 * what one request on `/connector/v1` counts against before its key is read: the caller's `/64`,
 * on `API_RATE_LIMITER` under a key of its own, as the read API's is; `null` for an unattributed
 * caller. once admitted, a connector key is charged on `INTEGRATIONS_KEY_RATE_LIMITER` under
 * `connectorKeyRateLimitKey`.
 */
export function connectorCallerRateLimitKey(request: Request): string | null {
	const caller = attributedCaller(request, 64);
	return caller === null ? null : `/connector/v1 ${caller}`;
}

/** what an admitted connector key's request counts against: its row id, apart from any api key's. */
export function connectorKeyRateLimitKey(keyId: string): string {
	return `/connector/v1 key ${keyId}`;
}

/**
 * what one request on `/integrations/v1` counts against once its key is admitted: the admitted
 * key's row id, charged against `INTEGRATIONS_KEY_RATE_LIMITER`.
 *
 * the key is the payer here: two systems calling from one host hold two keys and two budgets, and
 * one busy or leaked key spends only its own, from however many addresses it is presented. what the limit bounds is how fast one key can read the database.
 */
export function integrationsKeyRateLimitKey(keyId: string): string {
	return `${INTEGRATIONS_BASE_PATH} key ${keyId}`;
}

/**
 * what one view of a photo at `/image/:id` that the cache does not hold counts against, and `null`
 * for a caller with no bucket at all — charged against the surface limiter in
 * `src/routes/image.$id.ts`'s loader.
 *
 * a prefix of its own, so a page's photos never spend the donation box's count on `/api/v1` and a
 * burst on `/api/v1` never blanks a page's photos. a caller the server did not attribute is not
 * counted, as on the tighter keys above and for their reason: under the misread proxy header
 * `attributedCaller` below describes, that is every donor at once, and one bucket for all of them
 * is every photo on every page refused together.
 */
export function imageRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request, 64);
	return payer === null ? null : `image ${payer}`;
}

/**
 * what one view of a donor page — `/donate` or a campaign's address — counts against, and `null`
 * for a caller with no bucket at all: charged against the surface limiter by
 * `meterDonorPage` in ./meter.ts, under a prefix of its own for the reason `imageRateLimitKey`
 * above has one, and unattributed callers uncounted for the same reason.
 */
export function donorPageRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request, 64);
	return payer === null ? null : `donor-page ${payer}`;
}

/** the caller half of every key here: one payer, however they spelled their address. */
function caller(request: Request, block: Ipv6Block): string {
	const address = clientIp(request);
	return address === null ? UNATTRIBUTED : payer(address, block);
}

/**
 * the same caller, and `null` where this deployment has no bucket to put them in.
 *
 * the quote's, the sign-in's, the read API's per-address key and the two view keys are built from
 * this and the surface key is not, and the split is the misread proxy header described on
 * `apiRateLimitKey` above. with that header misread, every caller collapses
 * into one bucket — which turns a per-address limit into a deployment-wide tap: every donor there
 * sharing one address's worth of gifts a minute, one guesser able to hold the login closed on the
 * operator, and one caller able to hold every integration closed. so these buckets bound an
 * address or they bound nobody, and an operator who misconfigures that header gets the behaviour
 * these limits were added to, rather than a dark donation form. the surface bucket keeps counting
 * them, because it is the only meter `/api/v1` has — `refuseIfRateLimited` below is where that
 * side is argued. the sign-in's `null` is not let through for every identity: a member's attempt and
 * every reset request are refused instead, which `signInRateLimitKey` argues.
 *
 * the decision is expressed in the return type rather than left to the call sites, for the reason
 * the keys themselves live in this file: which block counts as one caller is the whole security
 * property, and a second copy of it is a second place to get it wrong. `isRateLimited` below takes
 * `string | null` and answers the `null`, so no call site can spend a bucket that is not there
 * and none has to know that it cannot.
 */
function attributedCaller(request: Request, block: Ipv6Block): string | null {
	const key = caller(request, block);
	return key === UNATTRIBUTED ? null : key;
}

/**
 * how much of an ipv6 address one bucket keys on. `apiRateLimitKey` argues which bucket takes
 * which; the two are prefixes on hextet boundaries, which is what lets `payer` render one by
 * slicing.
 */
type Ipv6Block = 48 | 64;

/** the block one payer holds: an ipv6 caller's `block`, an ipv4 caller's whole address. */
function payer(address: string, block: Ipv6Block): string {
	if (!address.includes(':')) {
		// rendered from the octets rather than kept as written, so that the two spellings of one
		// ipv4 address (`203.0.113.7`, `203.000.113.007`) are one bucket — the same canonicalization
		// the mapped form below gets, and for the same reason.
		const octets = ipv4Octets(address);
		return octets ? octets.join('.') : UNATTRIBUTED;
	}
	const hextets = expand(address);
	if (!hextets) return UNATTRIBUTED;
	const [a = 0, b = 0, c = 0, d = 0, e = 0, marker, high = 0, low = 0] = hextets;
	if (marker === 0xffff && a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
		// an ipv4 address written in ipv6 notation. it is one address and it counts as one, under
		// the same spelling the ipv4 form of it would produce.
		return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
	}
	const prefix = [a, b, c, d].slice(0, block / 16);
	return `${prefix.map((hextet) => hextet.toString(16)).join(':')}::/${block}`;
}

/**
 * an ipv6 address as its eight hextets, or `null` if it is not one.
 *
 * every written form of one address expands to the same eight numbers, which is what keeps the
 * key from moving when the spelling does: leading zeros, letter case and where the `::` sits are
 * all out of it by construction.
 */
function expand(address: string): number[] | null {
	const text = withoutDottedTail(address);
	if (text === null) return null;
	const halves = text.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves[1] ? halves[1].split(':') : [];
	if (left.length + right.length > 8) return null;
	const groups =
		halves.length === 2
			? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
			: left;
	if (groups.length !== 8) return null;
	if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
	return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * the same address with any trailing dotted quad rewritten as the two hextets it stands for, so
 * that one expansion covers both notations. `null` if the quad is not four octets.
 */
function withoutDottedTail(address: string): string | null {
	const lastColon = address.lastIndexOf(':');
	const tail = address.slice(lastColon + 1);
	if (!tail.includes('.')) return address;
	const octets = ipv4Octets(tail);
	if (!octets) return null;
	const [a = 0, b = 0, c = 0, d = 0] = octets;
	const high = ((a << 8) | b).toString(16);
	const low = ((c << 8) | d).toString(16);
	return `${address.slice(0, lastColon + 1)}${high}:${low}`;
}

/** the four octets of a dotted quad, or `null` if the text is not one. */
function ipv4Octets(text: string): number[] | null {
	const octets = text.split('.');
	if (octets.length !== 4) return null;
	if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return null;
	return octets.map(Number);
}

/**
 * the answer to a caller that has asked too often. `fix` is the surface's own sentence: the
 * default is `/api/v1`'s, and `/zapier` passes its own ($lib/server/zapier/surface.ts).
 *
 * no `error` code, and the absence is deliberate: `API_ERROR_CODES` in `packages/form/src/v1.ts` is a
 * permanent wire vocabulary minted in that file, and every member of it names the screen that
 * fixes it. a rate limit names no screen, is answered by the surface rather than by any route,
 * and is the only thing here that answers 429 — where 409 and 503 each cover two refusals and
 * need a code to be told apart.
 *
 * `Retry-After` because this is the one refusal on this surface that does come true by waiting.
 * the endpoint's 503s deliberately carry none: nothing about an unfinished deployment changes
 * with time, only when a person sets a value.
 *
 * no CORS headers, because the header that would make this readable in a browser is decided from
 * the form's own `allowed_origins` — the read this refusal exists to avoid. the trade is the same
 * one the endpoint's own not-found answer takes, and it is easier here: a caller asking hundreds
 * of times a minute is not a page that needed to read the reason.
 */
export function rateLimitRefusal(
	fix = `Wait ${PERIOD_SECONDS} seconds and send it again. A donation form loads this once per page view, so a page hitting this limit is asking in a loop.`
): Response {
	return Response.json(
		{
			message:
				'This deployment is answering too many requests from your address to answer another ' +
				'one right now. Nothing about the request is wrong.',
			fix
		},
		{
			status: 429,
			headers: {
				'retry-after': String(PERIOD_SECONDS),
				// the refusal is about this second and this address, so a cache holding it would
				// keep refusing a caller the limiter has already let back in.
				'cache-control': 'no-store'
			}
		}
	);
}

/**
 * the answer to a caller whose address has viewed too many photos: the surface refusal, with the
 * limit it hit named in the fix.
 */
export function imageRateLimitRefusal(): Response {
	return rateLimitRefusal(
		`Photos are limited per address per minute. Wait ${PERIOD_SECONDS} seconds and load the photo again. A page asks for each of its photos once per view, so an address hitting this is loading them in a loop.`
	);
}

/**
 * a donor page's answer to a caller whose address has viewed too many: the page's own plain
 * notice, the one it draws for any refusal (`refusedPage` in $lib/server/pages/view.ts), under a
 * 429 that says when to come back. `no-store` for the reason the surface refusal carries it.
 */
export function donorPageRateLimitRefusal() {
	return data({ kind: 'refused' } as const, {
		status: 429,
		headers: { 'retry-after': String(PERIOD_SECONDS), 'cache-control': 'no-store' }
	});
}

/**
 * the answer to a donor whose address has submitted too many gifts.
 *
 * the same 429 and the same reasoning as the surface refusal above, with one difference that is
 * the whole point of charging this bucket inside the route: it carries headers. the caller here is
 * a donation form on somebody's site, mid-checkout, and `access-control-allow-origin` is what lets
 * that page read the sentence — without it the browser refuses the response and the runtime can
 * only say the request never completed (`createQuote` in packages/form/src/embed/api.ts), which reads
 * as a CORS misconfiguration to whoever embedded the form. the route builds the echo from the
 * form's own `allowed_origins` and hands it in; nothing about it is decided here.
 *
 * the words are a donor's rather than an integrator's. an address that has spent this bucket is
 * usually a shared one — an office, a campus, a mobile carrier — so the likeliest reader of this
 * is somebody who did nothing wrong and is about to decide whether to try again.
 */
export function quoteRateLimitRefusal(headers: Headers): Response {
	const answer = new Headers(headers);
	answer.set('retry-after', String(PERIOD_SECONDS));
	// the refusal is about this minute and this address, so a cache holding it would keep refusing
	// a donor the limiter has already let back in.
	answer.set('cache-control', 'no-store');
	return Response.json(
		{
			message:
				'This deployment is taking more gifts from your address than it can process at once, ' +
				'so this one was not submitted. Nothing you entered is wrong, and nothing has been ' +
				'charged.',
			fix: `Wait ${PERIOD_SECONDS} seconds and press the button again. Everything you typed is still here.`
		},
		{ status: 429, headers: answer }
	);
}

/**
 * what a sign-in refused by the limiter is told.
 *
 * a sentence rather than a `Response`, because every site that spends this bucket answers with
 * data: each is a form action returning a rejection the page renders, so there is no header to
 * carry the wait and the wait has to be in the words.
 *
 * it says nothing about the account, and that is the whole of what it may say. this answer is
 * produced before the body is read at every site that returns it, so it cannot report an outcome
 * it does not have; keeping it that way is what stops a limit on one of these forms from becoming
 * an oracle that says "that guess was worth refusing".
 *
 * it also claims no scope for the bound, and the omission is deliberate: the bucket is per address
 * under ordinary operation, and per deployment under the misread proxy header `attributedCaller`
 * above describes, so either would be wrong somewhere. the person reading this sentence is trying
 * to sign in.
 */
export function signInRateLimitMessage(): string {
	return (
		`Too many sign-in attempts. Wait ${PERIOD_SECONDS} seconds and try again. Every attempt ` +
		'counts, whether or not the password was right.'
	);
}

/**
 * the answer when this deployment has no limiter to charge.
 *
 * the opposite answer to a `limit()` that rejects, and deliberately: this is not a transient
 * fault, it is a server started without a limiter `/api/v1` is required to have. serving
 * on would leave a public, unauthenticated, payment-initiating surface unmetered while every
 * screen reads as working — the shape CLAUDE.md rejects for unconfigured email, refused here for
 * the same reason.
 *
 * it names the limiter and the file because the only person who can fix it is holding the
 * repository, and 500 because nothing about the request is wrong. no `error` code, for the same
 * reason the 429 mints none — `API_ERROR_CODES` in `packages/form/src/v1.ts` is a permanent wire
 * vocabulary whose members each name the screen that fixes them, and no screen fixes this.
 */
function unboundSurface(): Response {
	return Response.json(
		{
			message:
				'This deployment has no API_RATE_LIMITER, so requests to /api/v1 cannot be ' +
				'metered and are refused. Nothing about the request is wrong.',
			fix: 'Start the app with `pnpm start`, which builds every limiter in RATE_LIMITS (src/lib/server/runtime/rate-limiter.ts).'
		},
		{ status: 500, headers: { 'cache-control': 'no-store' } }
	);
}

/**
 * charges one request against the caller's bucket, and answers for it if there is nothing left.
 *
 * `null` means carry on, which is the shape a middleware can spend in one line. the limiter is
 * passed rather than reached for: it lives on the platform env, and this module never names one —
 * the call site does, which for this one is `src/routes/api.v1.ts`.
 *
 * the outcome is `{ success }` and there is nothing else to read. that is the right shape for what
 * it guards: the cost of a wrong answer here is one extra database read, or one donor asked to
 * reload.
 *
 * the two ways it can fail to answer at all are answered opposite ways, and the difference is
 * whether waiting fixes it: a rejected `limit()` is transient and the request carries on
 * uncounted, while a missing limiter is a server built wrong and is refused by name
 * (`unboundSurface` above). the server entry builds every limiter at start
 * (../../../../server/start.ts), so the missing one is a hand-built `Env` and nothing a deployment
 * reaches — which is what makes refusing the cheap choice there.
 *
 * a caller the server did not attribute is counted here rather than let past, which is the opposite
 * of what the buckets built on `attributedCaller` above do with one. this bucket is the only
 * meter `/api/v1` has, so exempting anybody from it leaves the surface unmetered for exactly the
 * caller nothing can identify — and `apiRateLimitKey` puts them all in one bucket, which makes
 * them the most limited caller there is rather than the least.
 */
export async function refuseIfRateLimited(
	limiter: RateLimiter | undefined,
	request: Request
): Promise<Response | null> {
	if (!limiter) return unboundSurface();
	try {
		const { success } = await limiter.limit({ key: apiRateLimitKey(request) });
		return success ? null : rateLimitRefusal();
	} catch {
		// the charge did not happen, and the request carries on uncounted.
		//
		// fail open because of what is on each side of it. what this bounds is one database read, so
		// a stretch of unbounded ones costs next to nothing; refusing instead takes every donation
		// form embedded anywhere dark for as long as the fault lasts, and each of those is a gift.
		return null;
	}
}

/**
 * charges one request against a bucket the deployment is allowed not to have.
 *
 * `true` means this caller has nothing left. every other outcome is `false` and the request
 * carries on uncounted: a caller with no bucket at all (`key` is `null`, from `attributedCaller`
 * above), a limiter that is not there, a `limit()` that threw.
 *
 * this is the one place the fail-open decision is written down. its call sites point here rather
 * than restate it, and each carries only what is local to itself.
 *
 * the polarity is the opposite of `refuseIfRateLimited` above, and the difference is what absence
 * leaves behind rather than a difference of nerve. the surface limiter is the only thing metering
 * `/api/v1`, so serving without it is an unmetered public payment-initiating surface that reads as
 * working. the quote's and the read API's buckets refine a bound that does not depend on them: the
 * quote still has the surface bucket the hook charged above it, and the read API's two still have
 * its 256-bit keys, which bound who reads at all where the buckets bound only how fast — so what
 * absence costs there is the tighter bound rather than the bound.
 *
 * the sign-in's bucket is the only bound on guessing a password, so a missing limiter leaves every
 * credential here unbounded, a member's included. it is served on anyway because of which
 * deployment reaches this: one running with no such limiter would be refused by its own login, and
 * everything an operator could act on sits behind that login, so a bricked one has nothing in front
 * of anybody. the server entry cannot produce it: it builds every limiter at start. a caller with
 * no bucket on a deployment with its limiters is a different case, refused for members and for
 * every reset request at the call sites (`signInRateLimitKey`).
 *
 * the `catch` guards a failure the `RateLimiter` shape does not rule out: carrying on is the same
 * answer `refuseIfRateLimited` gives for the same case.
 *
 * the key is passed rather than derived, because which bucket a request counts against is the call
 * site's decision and the keys above are not interchangeable.
 */
export async function isRateLimited(
	limiter: RateLimiter | undefined,
	key: string | null
): Promise<boolean> {
	if (key === null || !limiter) return false;
	try {
		const { success } = await limiter.limit({ key });
		return !success;
	} catch {
		return false;
	}
}
