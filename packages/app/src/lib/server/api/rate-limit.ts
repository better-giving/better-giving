import { API_BASE_PATH } from './surface';

// the bound on `/api/v1`, spent in `src/routes/api.v1.ts`'s middleware above everything that costs
// a read.
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
// two tighter buckets are charged by the code that answers them and are also minted here: the
// quote submission (`src/routes/api.v1.forms.$id.donations.ts`) and the sign-in credential, which
// is charged at each of the three forms that spend a guess at it — the login's own form action,
// the reset request at `src/routes/forgot.tsx`, and the password change at
// `src/routes/_app.admin.members_.password.tsx`. each of the three calls the auth layer directly,
// so nothing else in a request's path can charge it. they are in this file rather than
// beside those call sites because of `payer` below — which block of addresses counts as one caller
// is the whole security property of a limit, and a second copy of it is a second place somebody
// can key on a whole ipv6 `/128` and hand one caller an address per request. the sign-in is not on
// this surface and reaches across for exactly that: the key is the shared thing, not the surface.
//
// the three are not answered alike when the binding is missing, and not answered alike for a
// caller the edge did not attribute. both differences are written down once, at the foot of this
// file on `refuseIfRateLimited` and `isRateLimited`, and the call sites point here rather than
// restate them. `./rate-limit.config.spec.ts` holds all three bindings to wrangler.jsonc, so none
// of them can go missing through `pnpm run deploy` in the first place.

/**
 * how long a refused caller is told to wait, in seconds — and every binding's own period, which
 * is the longest a bucket can hold them.
 *
 * the binding accepts 10 or 60 and `wrangler.jsonc` sets 60 on all three. the numbers have to
 * agree, because this one is a promise about when the same request works — a bucket that reset
 * forty seconds ago while the answer says to keep waiting is a donor sent away for nothing.
 * nothing in the language joins them, so `./rate-limit.config.spec.ts` reads the config file and
 * holds every answer this module produces to the period declared for the binding that refused it.
 */
const PERIOD_SECONDS = 60;

/** every caller the edge did not attribute, sharing one bucket. */
const UNATTRIBUTED = 'unattributed';

/**
 * what one request counts against.
 *
 * the surface plus the caller, and nothing the caller writes. that exclusion is the whole
 * property: a form id in the key would give an id-scanner a fresh bucket per id it invents, and
 * the scanner is exactly the caller a per-form limit cannot see — `form_not_found` costs a D1
 * read and arrives with no valid form to bucket on. the path, the query and the method are out
 * for the same reason.
 *
 * the address comes from `cf-connecting-ip`, which Cloudflare's edge writes on the way in and
 * overwrites whatever the caller sent, so a caller on the open internet cannot forge it.
 * `x-forwarded-for` is a caller-supplied string and is never read.
 *
 * cannot forge it is not cannot choose among it, and the granularity is what answers the
 * difference. a caller holding a routed ipv6 `/64` — the standard delegation from any vps host —
 * binds a fresh source address per request, so a key on the whole `/128` hands every request a
 * bucket of its own and bounds nothing. the key therefore holds the `/64` for ipv6 and the whole
 * address for ipv4, because those are the units one payer controls: a `/64` is the smallest block
 * a single subscriber or vm is normally delegated, and an ipv4 address is not subdivided at all.
 * an ipv4-mapped address (`::ffff:203.0.113.7`) is the ipv4 case in ipv6 notation and counts as
 * the address it holds.
 *
 * an address shared by many people is the accepted cost, and it is what the generous limit in
 * `wrangler.jsonc` is sized against: a mobile carrier puts thousands of real donors behind one
 * address, so the number has to clear a busy campaign on one NAT before it clears a scanner.
 *
 * anything that is not an address shares one bucket rather than getting one each, so an
 * unattributable caller is the most limited there is instead of the least. that covers a missing
 * header and a value that does not parse, and both are reachable through Cloudflare rather than
 * only on `wrangler dev`: the zone-level "Remove visitor IP headers" managed transform strips
 * `CF-Connecting-IP` outright, and on a subrequest from another Worker in the same zone the
 * header carries the value of `x-real-ip`, which that Worker's code may write
 * (https://developers.cloudflare.com/fundamentals/reference/http-headers/). the transform is the
 * operator-side footgun of the two, and it is a plausible thing to switch on for privacy: with it
 * on, every request to this deployment counts in one bucket and the per-address limit becomes a
 * single tap that one caller can hold closed on every donor at once.
 *
 * this key accepts that and the two below do not — `attributedCaller` is where that split is
 * argued, and it is a split about which bucket is the only meter on its surface rather than about
 * how an address is read.
 *
 * the surface prefix is a constant today and is in the key anyway: the counter is named after
 * what it bounds, so a second public surface metered through this binding gets its own count
 * instead of eating this one's.
 */
export function apiRateLimitKey(request: Request): string {
	return `${API_BASE_PATH} ${caller(request)}`;
}

/**
 * what one submission at `POST /api/v1/forms/:id/donations` counts against, and `null` for a
 * caller with no bucket at all.
 *
 * the same caller as the key above, under a name of its own. the form id is out of it for the
 * reason it is out of that key and the reason is if anything stronger here: this endpoint is
 * reached with an id the caller wrote, and a per-form bucket would hand somebody submitting a
 * thousand invented ids a thousand buckets — while a donor giving to the one form on the site
 * holds one.
 */
export function quoteRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request);
	return payer === null ? null : `${API_BASE_PATH} donations ${payer}`;
}

/**
 * what one staff sign-in attempt counts against, and `null` for a caller with no bucket at all.
 *
 * named after the credential rather than after a path, and that is what makes three sites one
 * bucket. this bucket bounds guessing at a sign-in credential, so a key that moved with the path
 * would hand a guesser a fresh budget for every way in that is ever added — a wrong password at
 * `/login`, a reset asked for at `/forgot` and a wrong current password at
 * `/admin/members/password` are one guess at one deployment's credentials, whichever form carried
 * it, and they count together. `/forgot` is on the list for a second reason of its own: a press
 * there mails whoever was named, so the bucket is also what bounds this deployment being used to
 * post somebody else's inbox.
 *
 * the caller and nothing else. there is one account and one secret, so there is no identity in the
 * key to enumerate and nothing an attacker can write that moves the bucket — the submitted
 * password is deliberately not in it, since keying on the guess would give every guess a bucket of
 * its own, which is the guesser this exists to bound.
 */
export function signInRateLimitKey(request: Request): string | null {
	const payer = attributedCaller(request);
	return payer === null ? null : `sign-in ${payer}`;
}

/** the caller half of every key here: one payer, however they spelled their address. */
function caller(request: Request): string {
	const address = request.headers.get('cf-connecting-ip');
	return address === null ? UNATTRIBUTED : payer(address);
}

/**
 * the same caller, and `null` where this deployment has no bucket to put them in.
 *
 * the two tighter keys are built from this and the surface key is not, and the split is the
 * "Remove visitor IP headers" managed transform described on `apiRateLimitKey` above. with that
 * transform on, every caller collapses into one bucket — which turns a tight per-address limit
 * into a deployment-wide tap: every donor there is sharing one address's worth of gifts a minute,
 * and one guesser able to hold the login closed on the operator. so these two buckets bound an
 * address or they bound nobody, and an operator who switches that transform on gets the behaviour
 * these limits were added to, rather than a dark donation form. the surface bucket keeps counting
 * them, because it is the only meter `/api/v1` has — `refuseIfRateLimited` below is where that
 * side is argued.
 *
 * the decision is expressed in the return type rather than left to the call sites, for the reason
 * the keys themselves live in this file: which block counts as one caller is the whole security
 * property, and a second copy of it is a second place to get it wrong. `isRateLimited` below takes
 * `string | null` and answers the `null`, so neither call site can spend a bucket that is not
 * there and neither has to know that it cannot.
 */
function attributedCaller(request: Request): string | null {
	const key = caller(request);
	return key === UNATTRIBUTED ? null : key;
}

/** the block one payer holds: an ipv6 caller's `/64`, an ipv4 caller's whole address. */
function payer(address: string): string {
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
	return `${[a, b, c, d].map((hextet) => hextet.toString(16)).join(':')}::/64`;
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
 * the answer to a caller that has asked too often.
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
export function rateLimitRefusal(): Response {
	return Response.json(
		{
			message:
				'This deployment is answering too many requests from your address to answer another ' +
				'one right now. Nothing about the request is wrong.',
			fix: `Wait ${PERIOD_SECONDS} seconds and send it again. A donation form loads this once per page view, so a page hitting this limit is asking in a loop.`
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
 * what a staff sign-in refused by the limiter is told.
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
 * per Cloudflare location under ordinary operation, and per deployment under the header-stripping
 * transform `attributedCaller` above describes, so any of the three would be wrong somewhere.
 * wrangler.jsonc carries the caveats for whoever tunes the number; the person reading this
 * sentence is trying to sign in.
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
 * fault, it is a deployment that shipped without a binding `/api/v1` is required to have. serving
 * on would leave a public, unauthenticated, payment-initiating surface unmetered while every
 * screen reads as working — the shape CLAUDE.md rejects for unconfigured email, refused here for
 * the same reason.
 *
 * it names the binding and the file because the only person who can fix it is holding the
 * repository, and 500 because nothing about the request is wrong. no `error` code, for the same
 * reason the 429 mints none — `API_ERROR_CODES` in `packages/form/src/v1.ts` is a permanent wire
 * vocabulary whose members each name the screen that fixes them, and no screen fixes this.
 */
function unboundSurface(): Response {
	return Response.json(
		{
			message:
				'This deployment has no API_RATE_LIMITER binding, so requests to /api/v1 cannot be ' +
				'metered and are refused. Nothing about the request is wrong.',
			fix: 'Restore the `ratelimits` block naming API_RATE_LIMITER in wrangler.jsonc and deploy again.'
		},
		{ status: 500, headers: { 'cache-control': 'no-store' } }
	);
}

/**
 * charges one request against the caller's bucket, and answers for it if there is nothing left.
 *
 * `null` means carry on, which is the shape a middleware can spend in one line. the binding is
 * passed rather than reached for: it lives on the platform env, and this module never names one —
 * the call site does, which for this one is `src/routes/api.v1.ts`.
 *
 * the outcome is `{ success }` and there is nothing else to read — the limiter is permissive and
 * eventually consistent by design, counts per Cloudflare location rather than globally, and is
 * not an accounting system. that is the right shape for what it guards: the cost of a wrong
 * answer here is one extra D1 read, or one donor asked to reload.
 *
 * the two ways it can fail to answer at all are answered opposite ways, and the difference is
 * whether waiting fixes it: a rejected `limit()` is transient and the request carries on
 * uncounted, while a missing binding is a deployment that shipped wrong and is refused by name
 * (`unboundSurface` above). the missing binding is unreachable through `pnpm run deploy` anyway,
 * because `test` runs first and `rate-limit.config.spec.ts` fails without the block — which is
 * what makes refusing the cheap choice there.
 *
 * a caller the edge did not attribute is counted here rather than let past, which is the opposite
 * of what the two tighter buckets do with one (`attributedCaller` above). this bucket is the only
 * meter `/api/v1` has, so exempting anybody from it leaves the surface unmetered for exactly the
 * caller nothing can identify — and `apiRateLimitKey` puts them all in one bucket, which makes
 * them the most limited caller there is rather than the least.
 */
export async function refuseIfRateLimited(
	limiter: RateLimit | undefined,
	request: Request
): Promise<Response | null> {
	if (!limiter) return unboundSurface();
	try {
		const { success } = await limiter.limit({ key: apiRateLimitKey(request) });
		return success ? null : rateLimitRefusal();
	} catch {
		// the charge did not happen, and the request carries on uncounted.
		//
		// fail open because of what is on each side of it. what this bounds is one D1 read, so a
		// stretch of unbounded ones costs a fraction of a cent; refusing instead takes every
		// donation form embedded anywhere dark for as long as the fault lasts, and each of those
		// is a gift. the subsystem is documented as permissive and eventually consistent and as
		// explicitly not an accounting system, so a fault here is a transient one to ride out
		// rather than a signal about the deployment
		// (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
		return null;
	}
}

/**
 * charges one request against a bucket the deployment is allowed not to have.
 *
 * `true` means this caller has nothing left. every other outcome is `false` and the request
 * carries on uncounted: a caller with no bucket at all (`key` is `null`, from `attributedCaller`
 * above), a binding that is not there, a `limit()` that threw.
 *
 * this is the one place the fail-open decision is written down. its call sites point here rather
 * than restate it, and each carries only what is local to itself.
 *
 * the polarity is the opposite of `refuseIfRateLimited` above, and the difference is what absence
 * leaves behind rather than a difference of nerve. the surface limiter is the only thing metering
 * `/api/v1`, so serving without it is an unmetered public payment-initiating surface that reads as
 * working. the buckets charged through here refine a bound that does not depend on them: the quote
 * still has the surface bucket the hook charged above it, and the sign-in still has
 * `ADMIN_PASSWORD` itself, which is what bounded it before any of these limiters existed — so what
 * absence costs here is the tighter bound rather than the bound.
 *
 * and the deployment that would actually reach this is the one where refusing costs most: a Worker
 * running with no such binding on it would be refused by its own login, and everything an operator
 * could act on sits behind that login. an unbounded login still has `ADMIN_PASSWORD` in front of
 * it; a bricked one has nothing in front of anybody.
 *
 * the `catch` guards a failure nothing promises either way — the binding's documentation states no
 * error conditions, so `limit()` throwing is neither a documented outcome nor one to rule out
 * (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). carrying on is
 * the same answer `refuseIfRateLimited` gives for the same unpromised case.
 *
 * the key is passed rather than derived, because which bucket a request counts against is the call
 * site's decision and the three above are not interchangeable.
 */
export async function isRateLimited(
	limiter: RateLimit | undefined,
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
