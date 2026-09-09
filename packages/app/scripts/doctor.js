/**
 * `pnpm run doctor <url>` — can the deployment at <url> actually sign staff in?
 *
 * why this probes a live deployment and not anything local. the thing that breaks a
 * first deploy is `ADMIN_PASSWORD` — unset, or shorter than the 12-character floor in
 * packages/operator/src/admin-password.ts. nothing offline can see that: the console shows
 * what the account stores, and the only component that has applied it is the running
 * Worker, which picks a changed value up as its next version rolls. so the only honest
 * check is to ask it.
 *
 * how it asks. it posts a deliberately wrong password to the sign-in screen and reads
 * the status. being rejected is the healthy answer — a 401 proves the secret is set,
 * passed the length floor, and that the database behind sign-in answered, because the
 * signing key is read out of it before the password is compared at all
 * (`resolveAuthSecret` in src/routes/login.tsx). every other status means something
 * else, and the arms below are what each one is.
 *
 * it posts to the screen and not to an API, because there is no API to post to: this
 * deployment mounts no auth HTTP router at all (CLAUDE.md), so `/login`'s own action is
 * the whole of the way in. that is also the limit of what this can report — the screen
 * answers in a rendered page rather than in a code, so a refusal that is about the
 * deployment is one status covering several causes, and the deployment's logs are what
 * separate them.
 *
 * why the url is an argument and never a default. a deployed hostname names one
 * Cloudflare account's deployment. CLAUDE.md forbids committing any such artifact, so
 * there is no built-in host here and no fallback to guess one — a fork's URL is not
 * ours and ours is not theirs.
 *
 * no dependencies, on purpose: plain node, global `fetch`.
 */

/** the one screen that signs staff in, and the only surface that reads a password. */
const SIGN_IN_PATH = '/login';

/**
 * the probe. obviously junk, fixed, and committed in the clear — this script must
 * never read, prompt for, print or transmit a real password. all it needs from the
 * deployment is a refusal, so the one property required of this string is that nobody
 * would ever set it as their admin password.
 */
const PROBE_PASSWORD = 'doctor-probe-not-a-real-password';

/** a deployment that cannot answer in this long is not healthy either way. */
const TIMEOUT_MS = 15_000;

/** where a password is put right, in the words the console draws it under. */
const FIX = 'the console (`better-giving open`), under Dashboard password';

process.exit(await main());

async function main() {
	// `pnpm run doctor https://…` appends the URL after the script path.
	const target = process.argv[2] ?? process.env.DEPLOYMENT_URL;
	if (!target) return usage('no deployment URL given.');

	const endpoint = signInUrl(target);
	if (!endpoint) return usage(`\`${target}\` is not an http(s) URL.`);

	let res;
	try {
		res = await fetch(endpoint, {
			method: 'POST',
			// the form's own encoding: the action reads the body with `request.formData()`,
			// and a JSON body reaches it as a parse failure rather than as a wrong password.
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ password: PROBE_PASSWORD }),
			// manual, so a redirect is reported rather than silently followed. fetch turns a
			// followed 301/302 into a GET, which would come back as a confusing 404/405
			// instead of "you gave me http:// and it moved to https://".
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		console.error(`FAILED: could not reach ${endpoint}`);
		console.error(`  ${err instanceof Error ? err.message : String(err)}`);
		console.error('  check the URL, and that this deployment has been deployed at least once.');
		return 1;
	}

	if (res.status === 401) {
		console.log(`HEALTHY: ${endpoint.origin} refused a wrong password, which is the right answer.`);
		console.log('  ADMIN_PASSWORD is set, long enough, and the database answered.');
		return 0;
	}

	// a sign-in that lands redirects to the destination carrying its session cookie, so a
	// redirect with one on it is the junk literal above having authenticated. it is public,
	// so this deployment is open.
	if (res.status >= 300 && res.status < 400) {
		if (res.headers.getSetCookie().length > 0) {
			console.error('FAILED: the deployment ACCEPTED this script’s junk probe password.');
			console.error('  ADMIN_PASSWORD equals a string published in scripts/doctor.js.');
			// no redeploy in this advice on purpose: a var set from the console takes effect on
			// its own as a new version, and a deploy would drag its one-way
			// `d1 migrations apply --remote` along with it.
			console.error(`  rotate it now on ${FIX} — it applies immediately.`);
			return 1;
		}
		console.error(`FAILED: ${endpoint} redirected (${res.status}).`);
		const location = res.headers.get('location');
		if (location)
			console.error(`  it points at ${location} — run doctor against that host instead.`);
		return 1;
	}

	if (res.status === 429) {
		// login.tsx rate-limits this path, and a probe spends one attempt. this is the
		// endpoint working, not a fault — it just cannot answer right now.
		console.error('FAILED: rate limited — sign-in allows a few attempts a minute.');
		console.error('  wait a minute and run `pnpm run doctor` again.');
		return 1;
	}

	if (res.status === 400) {
		// the form refused the body rather than the password: the one box `/login` states is
		// `password`, so this is the screen's form having changed under a script that still
		// posts the old shape.
		console.error(`FAILED: ${endpoint} refused this script’s probe body (400).`);
		console.error('  the sign-in form states a box this script does not send. this is a fault in');
		console.error('  scripts/doctor.js rather than in the deployment — see `LOGIN_FORM` in');
		console.error('  src/routes/login.tsx for what the form states.');
		return 1;
	}

	if (res.status === 404) {
		console.error(`FAILED: ${endpoint} returned 404 — nothing is serving this app there.`);
		console.error('  check the URL is the deployment’s own origin, and that the deploy succeeded.');
		return 1;
	}

	// a 500 is sign-in refusing for a reason about the deployment: ADMIN_PASSWORD unusable,
	// or no schema to read the signing key out of — the one a fresh deployment hits. the
	// screen answers in a rendered page rather than a code, so which one it is comes off the
	// logs, and the console is where the password half is put right.
	console.error(`FAILED: ${endpoint} could not sign anyone in (${res.status}).`);
	console.error(`  either ADMIN_PASSWORD is unusable — set it again on ${FIX},`);
	console.error('  it applies immediately — or migrations have not reached the database this');
	console.error('  deployment is bound to, which the console applies when it updates a');
	console.error('  deployment. the logs name which: the Cloudflare dashboard has them, and');
	console.error('  `pnpm run logs` reads them from a checkout.');
	return 1;
}

/** the sign-in screen on `target`, or `undefined` if `target` is not a usable URL. */
function signInUrl(target) {
	let base;
	try {
		base = new URL(target);
	} catch {
		return undefined;
	}
	if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
	// keep any path the operator passed (a deployment can sit under a subpath) but do
	// not let a trailing slash double up.
	return new URL(base.pathname.replace(/\/+$/, '') + SIGN_IN_PATH, base);
}

function usage(problem) {
	console.error(`FAILED: ${problem}`);
	console.error('');
	console.error('  usage: pnpm run doctor https://your-worker.your-subdomain.workers.dev');
	console.error('  (or set DEPLOYMENT_URL and run `pnpm run doctor`)');
	console.error('');
	console.error('  the URL is not stored in this repo on purpose: a deployed hostname names');
	console.error('  one account’s deployment, and a fork must not inherit ours.');
	return 1;
}
