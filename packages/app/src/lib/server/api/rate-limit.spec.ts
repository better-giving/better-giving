import { describe, expect, it } from 'vitest';
import {
	apiRateLimitKey,
	isRateLimited,
	quoteRateLimitKey,
	quoteRateLimitRefusal,
	rateLimitRefusal,
	refuseIfRateLimited,
	signInRateLimitKey,
	signInRateLimitMessage
} from './rate-limit';

// the two halves of the limiter that decide nothing about the binding: what a request counts
// against, and what it is told when it has counted too much. the wiring — that a route spends
// this above the short-circuit, and that a refused request never reaches a route — is in
// `src/routes/api.v1.workers.spec.ts` and `src/routes/login.workers.spec.ts`, against the real
// binding.
//
// the key is the whole security property, so it is stated here rather than left to the
// end-to-end case: a bucket a caller can move between on demand is not a limit, and every case
// below is a way of trying to move.

/** a request as it arrives from Cloudflare's edge, which is what sets `cf-connecting-ip`. */
function request(url: string, headers: Record<string, string> = {}, method = 'GET'): Request {
	return new Request(`https://give.example.workers.dev${url}`, { method, headers });
}

const FROM = { 'cf-connecting-ip': '203.0.113.7' };

describe('what a public api request counts against', () => {
	it('is the surface and the caller, and nothing else', () => {
		expect(apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM))).toBe(
			'/api/v1 203.0.113.7'
		);
	});

	/**
	 * the case a per-form key cannot see, and the reason there is no form id in the key at all.
	 *
	 * an id nothing matches still costs a D1 read (`readForm` runs before the endpoint knows
	 * there is no row) and arrives with no valid form to bucket on — so a limit keyed on the id
	 * would hand a scanner a fresh bucket for every id it invents, which is unlimited reads
	 * dressed as a limit. the same argument rules out the path, the query and the method: the
	 * caller writes all of them.
	 */
	it('does not move when the caller changes the part of the request they write', () => {
		const keys = new Set([
			apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM)),
			apiRateLimitKey(request('/api/v1/forms/frm_zzz/config', FROM)),
			apiRateLimitKey(request('/api/v1/forms/frm_abc/config?cache=2', FROM)),
			apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM, 'OPTIONS')),
			apiRateLimitKey(request('/api/v1/anything/at/all', FROM))
		]);
		expect(keys.size).toBe(1);
	});

	/**
	 * the bypass a whole-address key has, and the reason an ipv6 caller is bucketed on its `/64`.
	 *
	 * a `/64` is the smallest block a single subscriber or vm is normally delegated, so every
	 * address in one is one payer. keyed on the full `/128` an attacker binds a fresh source
	 * address per request out of a routed `/64` any vps host hands out, and every request lands in
	 * a bucket of its own — which is the id-scanner this key shape exists to bound, unbounded.
	 */
	it('puts one ipv6 /64 in one bucket', () => {
		const first = apiRateLimitKey(
			request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': '2001:db8:1:2::1' })
		);
		const second = apiRateLimitKey(
			request('/api/v1/forms/frm_abc/config', {
				'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd'
			})
		);
		expect(first).toBe(second);
	});

	/**
	 * and the other half of it: the block is `/64` and not something wider. a `/32` or a `/48` is
	 * an allocation to a network rather than to a payer, so bucketing on one would put unrelated
	 * subscribers of one isp in a single bucket and let any of them close it on the rest.
	 */
	it('separates two ipv6 /64s', () => {
		const first = apiRateLimitKey(
			request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': '2001:db8:1:2::1' })
		);
		const second = apiRateLimitKey(
			request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': '2001:db8:1:3::1' })
		);
		expect(first).not.toBe(second);
	});

	/**
	 * an ipv4 address written in ipv6 notation is still one ipv4 address, and it counts as one.
	 *
	 * taken as a prefix it would be the opposite of the rule above in both directions: every
	 * `::ffff:` address shares the all-zero `/64`, so the whole ipv4 internet would land in one
	 * bucket, and the same caller reaching this deployment under both spellings would hold two.
	 */
	it('counts an ipv4-mapped address as the ipv4 address it holds', () => {
		expect(
			apiRateLimitKey(
				request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': '::ffff:203.0.113.7' })
			)
		).toBe(apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM)));
	});

	/**
	 * one address has several written forms and they are one bucket. the edge writes a canonical
	 * one, so this is not a caller moving between spellings — it is the reason nothing downstream
	 * has to care which spelling arrives.
	 */
	it('does not move when the same address is spelled differently', () => {
		const keys = new Set(
			[
				'2001:db8:1:2::1',
				'2001:0db8:0001:0002:0000:0000:0000:0001',
				'2001:0DB8:1:2::1',
				'2001:db8:1:2::0.0.0.1'
			].map((ip) =>
				apiRateLimitKey(request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': ip }))
			)
		);
		expect(keys.size).toBe(1);
	});

	/**
	 * the same property for ipv4, whose octets are equally free to carry leading zeros — and the
	 * mapped forms of that address alongside them, since a mapped address is the ipv4 one written
	 * in ipv6 notation rather than a caller of its own.
	 */
	it('does not move when an ipv4 address is spelled differently', () => {
		const keys = new Set(
			['203.0.113.7', '203.000.113.007', '::ffff:203.0.113.7', '::ffff:cb00:7107'].map((ip) =>
				apiRateLimitKey(request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': ip }))
			)
		);
		expect(keys.size).toBe(1);
	});

	/** two callers are two buckets, or the limit is one global tap anybody can close. */
	it('separates two addresses', () => {
		expect(apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM))).not.toBe(
			apiRateLimitKey(
				request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': '198.51.100.4' })
			)
		);
	});

	/**
	 * `cf-connecting-ip` is written by Cloudflare's edge on the way in and overwrites whatever
	 * the caller sent, which is what makes it the one value here a caller cannot forge. no
	 * other header is read, and `x-forwarded-for` in particular is a caller-supplied string.
	 *
	 * unforgeable is only half of it — a caller who holds a block of addresses still chooses which
	 * one they send from, which is what the `/64` cases above answer.
	 */
	it('reads no header a caller can set', () => {
		const spoofed = { ...FROM, 'x-forwarded-for': '198.51.100.4', forwarded: 'for=198.51.100.4' };
		expect(apiRateLimitKey(request('/api/v1/forms/frm_abc/config', spoofed))).toBe(
			apiRateLimitKey(request('/api/v1/forms/frm_abc/config', FROM))
		);
	});

	/**
	 * no address at all — `wrangler dev` on a loopback request, or a runtime that is not the
	 * edge. every such caller shares one bucket rather than getting one each, so an absent
	 * header is the most limited caller there is instead of the least.
	 */
	it('puts every caller it cannot attribute in one bucket', () => {
		const first = apiRateLimitKey(request('/api/v1/forms/frm_abc/config'));
		const second = apiRateLimitKey(request('/api/v1/forms/frm_zzz/config', {}, 'OPTIONS'));
		expect(first).toBe(second);
		expect(first).not.toContain('203.0.113.7');
	});

	/**
	 * a value that is not an address goes in that same bucket, rather than in one of its own.
	 *
	 * it is the only safe direction and it is reachable: on a subrequest from another Worker in
	 * the same zone, Cloudflare's docs say `CF-Connecting-IP` takes the value of `x-real-ip`,
	 * which that Worker's code may set to anything
	 * (https://developers.cloudflare.com/fundamentals/reference/http-headers/). a fresh bucket per
	 * unparseable string would be an unlimited supply of them.
	 */
	it('cannot be given a bucket by writing something that is not an address', () => {
		const shared = apiRateLimitKey(request('/api/v1/forms/frm_abc/config'));
		for (const ip of [
			'not-an-ip',
			'',
			// the shape `x-forwarded-for` has, which is a list. one address is the whole of what
			// this header holds, so a list is not a caller with a bucket.
			'203.0.113.7, 198.51.100.4',
			'999.999.999.999',
			'2001:db8::1::2'
		]) {
			expect(
				apiRateLimitKey(request('/api/v1/forms/frm_abc/config', { 'cf-connecting-ip': ip }))
			).toBe(shared);
		}
	});
});

describe('what a refused caller is told', () => {
	/**
	 * 429 and a body that says what to do, because CLAUDE.md's rule for a refusal on this
	 * surface is that an agent reads it: name the value and where to fix it. the value here is
	 * the request rate itself and the fix is time, which is the one refusal on this endpoint
	 * that does come true by waiting — hence `Retry-After`, where every 503 the endpoint gives
	 * deliberately carries none.
	 */
	it('is a 429 that says when to come back', async () => {
		const response = rateLimitRefusal();
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining('too many'),
			fix: expect.stringContaining('60')
		});
	});

	/**
	 * no `error` code, and its absence is the decision. `API_ERROR_CODES` in packages/form/src/v1.ts is a
	 * permanent wire vocabulary whose members are minted in that file, and every member names the
	 * screen that fixes it — a rate limit names no screen and is answered by the surface rather
	 * than by any route. 429 is unambiguous on its own here: no other answer this endpoint gives
	 * carries it, unlike 409 and 503, which is why those two need a code to tell them apart.
	 */
	it('mints no code outside the wire vocabulary', async () => {
		expect(await rateLimitRefusal().json()).not.toHaveProperty('error');
	});

	/**
	 * no `Access-Control-Allow-Origin`, and it cannot have one: the header is decided from the
	 * form's own `allowed_origins`, which is the D1 read this refusal exists to avoid. so a
	 * browser cannot read this body, and the caller it is aimed at — one asking hundreds of times
	 * a minute — is not a browser that needed to.
	 */
	it('grants nothing, because granting would cost the read it is refusing', () => {
		expect(rateLimitRefusal().headers.has('access-control-allow-origin')).toBe(false);
	});
});

/**
 * the two ways the binding itself can fail to answer, which are answered differently on purpose.
 *
 * a stand-in limiter, and it is the only way to reach either one: the real binding cannot be told
 * to throw, and a deployment with no binding at all is a config file rather than a runtime. what
 * is under test is this module's own two branches, not the binding's behaviour — that is held in
 * `src/routes/api.v1.workers.spec.ts` and `src/routes/login.workers.spec.ts` against the real one.
 */
describe('when the binding does not answer', () => {
	const asked = new Request('https://give.example.workers.dev/api/v1/forms/frm_abc/config', {
		headers: FROM
	});

	/**
	 * a rejected `limit()` is transient — Cloudflare documents the subsystem as permissive and
	 * eventually consistent and says outright it is not an accounting system — so the request
	 * carries on. what the limit bounds is one D1 read, and one unbounded second of those is a
	 * smaller loss than one dark minute across every form embedded anywhere.
	 */
	it('lets the request through when limit() rejects', async () => {
		const refusal = await refuseIfRateLimited(
			{ limit: () => Promise.reject(new Error('rate limiter unavailable')) },
			asked
		);
		expect(refusal).toBeNull();
	});

	/**
	 * no binding at all is the opposite case and gets the opposite answer.
	 *
	 * it is not transient: the `ratelimits` block was taken out of `wrangler.jsonc`, or the
	 * deployed Worker predates it. serving on would be an unmetered public payment-initiating
	 * surface that reads as working — the blessed-hole shape CLAUDE.md rejects for unconfigured
	 * email, and the same answer applies. the body names the binding and the file, because the
	 * only person who can fix it is holding the repository.
	 */
	it('refuses by name when there is no binding', async () => {
		const refusal = await refuseIfRateLimited(undefined, asked);
		expect(refusal?.status).toBe(500);
		expect(refusal?.headers.get('cache-control')).toBe('no-store');
		const body = await refusal?.json();
		expect(body).toMatchObject({
			message: expect.stringContaining('API_RATE_LIMITER'),
			fix: expect.stringContaining('wrangler.jsonc')
		});
		// the same reason the 429 mints none: `API_ERROR_CODES` in packages/form/src/v1.ts is a permanent
		// wire vocabulary and every member of it names a screen that fixes it.
		expect(body).not.toHaveProperty('error');
	});
});

/**
 * the caller half of a key, which every limiter in this app shares.
 *
 * one definition rather than three, and that is the whole reason the two tighter buckets are keyed
 * from this module at all: the `/64` rule above is a security property, and a second copy of it is
 * a second place somebody can key on the whole `/128` and hand a caller an address per request.
 * the cases here are the shape of that sharing; the cases above are what it means.
 */
describe('what the tighter buckets count against', () => {
	const from = (ip: string) =>
		new Request('https://give.example.workers.dev/', { headers: { 'cf-connecting-ip': ip } });

	const TIGHT = [
		['a sign-in attempt', signInRateLimitKey],
		['a quote submission', quoteRateLimitKey]
	] as const;

	it.each(TIGHT)('keys %s on the block one payer holds, not on one address', (_what, key) => {
		expect(key(from('2001:db8:1:2::1'))).toBe(key(from('2001:db8:1:2:aaaa:bbbb:cccc:dddd')));
		expect(key(from('2001:db8:1:2::1'))).not.toBe(key(from('2001:db8:1:3::1')));
		expect(key(from('::ffff:203.0.113.7'))).toBe(key(from('203.0.113.7')));
		expect(key(from('203.0.113.7'))).not.toBe(key(from('198.51.100.4')));
	});

	/**
	 * the exemption, and it is the opposite of what the surface key does with the same caller.
	 *
	 * a caller with no address is not one bucket here, it is no bucket — because under the
	 * zone-level "Remove visitor IP headers" managed transform that is every caller at once, and a
	 * tight per-address limit collapsed into one bucket is a deployment-wide tap: one address's
	 * worth of gifts a minute for every donor there is, and a login one guesser can hold closed on
	 * the operator. so
	 * an operator who switches that transform on gets what this deployment did before these two
	 * buckets existed rather than a dark donation form.
	 */
	it.each(TIGHT)('mints no bucket for %s it cannot attribute to a payer', (_what, key) => {
		expect(key(new Request('https://give.example.workers.dev/'))).toBeNull();
		expect(key(from('not-an-ip'))).toBeNull();
		expect(key(from(''))).toBeNull();
		expect(key(from('203.0.113.7, 198.51.100.4'))).toBeNull();
	});

	/**
	 * each key names what it bounds. the three bindings count in namespaces of their own
	 * (wrangler.jsonc), so nothing depends on the names differing today — it is what keeps a
	 * limiter that later meters a second thing from eating the first one's count, which is the same
	 * reason the surface prefix is in the api key.
	 */
	it('names the surface it bounds, so no two limiters count the same caller alike', () => {
		const asked = from('203.0.113.7');
		expect(
			new Set([apiRateLimitKey(asked), signInRateLimitKey(asked), quoteRateLimitKey(asked)]).size
		).toBe(3);
	});

	/**
	 * the key itself, written out, because it is the thing that must not have moved.
	 *
	 * this bucket had two payers spending one key — the login's form action and
	 * `POST /api/auth/sign-in/staff`, which better-auth's router answered and this deployment no
	 * longer serves. one site is left and it charges the key the pair charged. a key that changed
	 * when the second payer went would be a bound on password guessing that quietly stopped
	 * bounding: nothing fails, the counter just meters a name nobody is spending.
	 */
	it('counts a sign-in on the one key both payers charged', () => {
		expect(signInRateLimitKey(request('/login', FROM, 'POST'))).toBe('sign-in 203.0.113.7');
	});

	/**
	 * and nothing the caller writes is in it, which is what keeps one site from becoming several.
	 * a path, a method or a query in the key would mint a fresh budget for every way in that is
	 * ever added — the guesser this bucket exists to bound is the one who tries all of them.
	 */
	it('does not move with the path, the method or the query a guess arrives on', () => {
		const keys = new Set([
			signInRateLimitKey(request('/login', FROM, 'POST')),
			signInRateLimitKey(request('/login?next=%2Fadmin', FROM, 'POST')),
			signInRateLimitKey(request('/login', FROM)),
			signInRateLimitKey(request('/api/auth/sign-in/staff', FROM, 'POST'))
		]);
		expect(keys.size).toBe(1);
	});
});

/**
 * the charge the two tighter buckets spend, whose polarity is the opposite of the surface's.
 *
 * a stand-in limiter, and it is the only way to reach these branches: the real binding cannot be
 * told to throw, and a deployment with no binding at all is a config file rather than a runtime.
 */
describe('charging a bucket that is allowed to be absent', () => {
	it('counts a caller who still has requests left as not limited', async () => {
		expect(await isRateLimited({ limit: () => Promise.resolve({ success: true }) }, 'k')).toBe(
			false
		);
	});

	it('counts a caller with nothing left as limited', async () => {
		expect(await isRateLimited({ limit: () => Promise.resolve({ success: false }) }, 'k')).toBe(
			true
		);
	});

	/**
	 * no binding is not a refusal here, and that is the decision — the opposite one to
	 * `refuseIfRateLimited` above, which answers 500 by name.
	 *
	 * what is on each side of it differs. the surface limiter's absence leaves a public,
	 * unauthenticated, payment-initiating surface unmetered, so refusing is the cheap choice. these
	 * two bound something that is already bounded: the login by `ADMIN_PASSWORD` itself, the quote
	 * by the surface bucket the hook charges above it — and refusing instead would take a
	 * deployment's only login, or every embedded form, dark over a binding that is not there.
	 */
	it('lets the request through when there is no binding at all', async () => {
		expect(await isRateLimited(undefined, 'k')).toBe(false);
	});

	/**
	 * a `limit()` that throws is not a documented outcome — the binding's page states no error
	 * conditions either way — so this is a guard rather than a described case, and it carries on for
	 * the same reason the surface does.
	 */
	it('lets the request through when limit() rejects', async () => {
		expect(
			await isRateLimited({ limit: () => Promise.reject(new Error('unavailable')) }, 'k')
		).toBe(false);
	});

	/**
	 * the other half of the exemption above, and the half a key test cannot make: a caller with no
	 * bucket is not refused even by a limiter that is present and refusing everything. the binding
	 * is never asked, because there is nothing to ask it about.
	 */
	it('lets a caller with no bucket through a limiter that refuses everything', async () => {
		let charged = 0;
		const refusing = {
			limit: () => {
				charged += 1;
				return Promise.resolve({ success: false });
			}
		};
		expect(await isRateLimited(refusing, null)).toBe(false);
		expect(charged).toBe(0);
	});
});

/**
 * the same caller against the surface bucket, which counts them.
 *
 * stated beside the exemption rather than near it, because the asymmetry is the point: the two
 * tighter buckets let an unattributable caller past and this one must not. it is the only meter
 * `/api/v1` has, so a caller nothing can identify is exactly the caller that surface cannot afford
 * to serve unmetered.
 */
describe('an unattributable caller on the public surface', () => {
	const anonymous = new Request('https://give.example.workers.dev/api/v1/forms/frm_abc/config');

	it('is refused by the surface bucket all the same', async () => {
		const refusal = await refuseIfRateLimited(
			{ limit: () => Promise.resolve({ success: false }) },
			anonymous
		);
		expect(refusal?.status).toBe(429);
	});
});

describe('what a refused donor and a refused sign-in are told', () => {
	const headers = new Headers({ 'access-control-allow-origin': 'https://acme.org' });

	/**
	 * the quote refusal carries whatever the route hands it, and the route hands it the echo built
	 * from the form's own `allowed_origins`. without the header a browser cannot read the body at
	 * all, and the embedded runtime can only report that the request never completed
	 * (`createQuote` in packages/form/src/embed/api.ts) — which reads as a CORS misconfiguration to
	 * whoever embedded the form, about a refusal that has nothing to do with one.
	 */
	it('lets a donor read why their gift was refused', async () => {
		const refusal = quoteRateLimitRefusal(headers);
		expect(refusal.status).toBe(429);
		expect(refusal.headers.get('access-control-allow-origin')).toBe('https://acme.org');
		expect(refusal.headers.get('cache-control')).toBe('no-store');
		const body = (await refusal.json()) as Record<string, unknown>;
		// the gift bucket's sentence and not `rateLimitRefusal`'s: a donor who pressed Donate is
		// told nothing was charged, where a page asking in a loop is told nothing about a charge.
		expect(body.message).toContain('nothing has been charged');
		expect(body.fix).toContain('60');
		// no code, for the reason the surface 429 mints none: every `API_ERROR_CODES` member names
		// the screen that fixes it, and waiting is not a screen.
		expect(body).not.toHaveProperty('error');
	});

	/**
	 * the sign-in refusal says nothing about the password, and cannot: it is answered before the
	 * credential is compared. stated as a case because the value of a limit on this form is that a
	 * refusal and a wrong password are two different sentences to an operator and one dead end to
	 * somebody guessing.
	 */
	it('tells a refused sign-in to wait, and nothing about the password', () => {
		const message = signInRateLimitMessage();
		expect(message).toContain('60');
		expect(message.toLowerCase()).not.toContain('invalid');
		expect(message.toLowerCase()).not.toContain('correct');
	});

	/**
	 * and it claims no scope for the bound. the bucket is per address per Cloudflare location under
	 * ordinary operation and per deployment under the header-stripping transform, so a sentence
	 * naming any one of them is wrong somewhere — wrangler.jsonc carries the caveats for whoever
	 * tunes the number, and the person reading this is trying to sign in.
	 */
	it('promises the operator no bound it may not be', () => {
		expect(signInRateLimitMessage().toLowerCase()).not.toContain('address');
	});
});
