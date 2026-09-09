import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_WIDGET_NAME } from '../src/lib/config/turnstile-widget';
import { main } from './turnstile-keys.js';

/**
 * a widget as wrangler prints one, cut to the fields this script reads.
 *
 * the two key values are made up and shaped like nothing Cloudflare issues, on purpose: a fixture
 * that looked like a real pair is one somebody later reads as this deployment's own (CLAUDE.md
 * commits no deployment artifact).
 */
function widget(overrides = {}) {
	return {
		name: TURNSTILE_WIDGET_NAME,
		sitekey: 'sitekey-from-a-fixture',
		secret: 'secret-from-a-fixture',
		...overrides
	};
}

/**
 * a stubbed wrangler, as the argument list of each call against what it should answer with.
 *
 * the calls are recorded because what this script may run is as much of its contract as what it
 * prints: it reads, and a case below holds it to running nothing that writes.
 */
function wranglerStub(answers) {
	const calls = [];
	const run = async (args) => {
		calls.push(args);
		const answer = answers.find((candidate) => candidate.when(args));
		if (!answer) throw new Error(`no stubbed answer for: ${args.join(' ')}`);
		return { code: 0, stdout: '', stderr: '', ...answer.reply };
	};
	return { run, calls };
}

/** the list call, answered with whatever `widgets` is — a value, so a case can send junk. */
function listAnswer(widgets) {
	return {
		when: (args) => args.includes('list'),
		reply: { stdout: typeof widgets === 'string' ? widgets : JSON.stringify(widgets) }
	};
}

/** the get call, which is the only call that comes back carrying a secret. */
function getAnswer(w) {
	return {
		when: (args) => args.includes('get'),
		reply: { stdout: typeof w === 'string' ? w : JSON.stringify(w) }
	};
}

/** stdout and stderr as arrays of lines, with the real console silenced for the run. */
async function capture(run) {
	const out = [];
	const err = [];
	const outSpy = vi.spyOn(console, 'log').mockImplementation((line) => out.push(String(line)));
	const errSpy = vi.spyOn(console, 'error').mockImplementation((line) => err.push(String(line)));
	try {
		const code = await main(run);
		return { code, out, err };
	} finally {
		outSpy.mockRestore();
		errSpy.mockRestore();
	}
}

describe('printing this deployment’s Turnstile keys', () => {
	/**
	 * the whole errand: the sitekey comes off `list` and the secret off `get`, because wrangler
	 * redacts the secret from every other output it has.
	 *
	 * what stdout carries is `.deploy.vars` syntax and nothing else — that is what makes the output
	 * appendable to the file `pnpm run deploy:vars` reads (DEPLOY.md), and it is why every word
	 * about which widget was matched is on stderr instead.
	 */
	it('prints the pair as two .deploy.vars lines and nothing else', async () => {
		const { run } = wranglerStub([listAnswer([widget()]), getAnswer(widget())]);

		const { code, out } = await capture(run);

		expect(code).toBe(0);
		expect(out).toEqual([
			"TURNSTILE_SITE_KEY='sitekey-from-a-fixture'",
			"TURNSTILE_SECRET_KEY='secret-from-a-fixture'"
		]);
	});

	/**
	 * the two calls it is allowed to make, and the ones it may never make.
	 *
	 * this script exists to be run by an operator who has lost a key, which is the worst moment for
	 * a command that could rotate one. the shape of the assertion is a whitelist rather than a list
	 * of forbidden verbs: a subcommand wrangler grows later is refused by a case written today.
	 */
	it('runs nothing but the two read calls, and gets the widget it matched', async () => {
		const { run, calls } = wranglerStub([
			listAnswer([widget({ sitekey: 'the-matched-sitekey' })]),
			getAnswer(widget({ sitekey: 'the-matched-sitekey' }))
		]);

		await capture(run);

		expect(calls).toEqual([
			['turnstile', 'widget', 'list', '--json'],
			['turnstile', 'widget', 'get', 'the-matched-sitekey', '--json']
		]);
	});

	/**
	 * an account with widgets on it, none of them this deployment's.
	 *
	 * the widget's name is the whole of what this script matches on, so the operator is told which
	 * name was looked for and which ones are there — the usual cause is a widget created by hand
	 * under a name of its own, and renaming it on the Cloudflare screen is what makes this work.
	 */
	it('names what it looked for when no widget carries the name', async () => {
		const { run } = wranglerStub([listAnswer([widget({ name: 'something-else' })])]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain(TURNSTILE_WIDGET_NAME);
		expect(err.join('\n')).toContain('something-else');
	});

	/**
	 * two widgets under one name, which Cloudflare allows and this deployment cannot resolve: it
	 * stores one pair, and the two on the account differ in the hostnames each will be solved on.
	 *
	 * nothing is printed and nothing is guessed. what the operator is given is each sitekey and the
	 * one command that reads a chosen one, so the decision is theirs and it is made on the list of
	 * sites rather than on which widget came back first.
	 */
	it('refuses to choose between two widgets of the same name, and hands over both', async () => {
		const { run, calls } = wranglerStub([
			listAnswer([widget({ sitekey: 'the-older-one' }), widget({ sitekey: 'the-newer-one' })])
		]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('the-older-one');
		expect(err.join('\n')).toContain('the-newer-one');
		// no secret is fetched for either: a `get` here is a key printed for a widget the operator
		// has not chosen.
		expect(calls).toHaveLength(1);
	});

	/**
	 * what the operator does with the two lines, said where it does not touch them.
	 *
	 * stdout is the pair alone, so the sentence that turns it into a working deployment has to be
	 * on stderr — and it is one sentence rather than the file's whole contract, which DEPLOY.md
	 * holds.
	 */
	it('says which widget it read and how the pair reaches the deployment, on stderr', async () => {
		const { run } = wranglerStub([listAnswer([widget()]), getAnswer(widget())]);

		const { err } = await capture(run);

		expect(err.join('\n')).toContain(TURNSTILE_WIDGET_NAME);
		expect(err.join('\n')).toContain('.deploy.vars');
		expect(err.join('\n')).toContain('deploy:vars');
	});

	/**
	 * an account with no widgets at all, which is a different errand: there is nothing to recover
	 * and the pair has to be minted, which the console writes out the command for.
	 */
	it('sends an account with no widgets to the screen that creates one', async () => {
		const { run } = wranglerStub([listAnswer([])]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('pnpm run console');
	});

	/**
	 * a wrangler with no credentials, which is the first run on a machine that has never deployed.
	 *
	 * the fixture is wrangler's own wording on that failure, and it is passed through rather than
	 * summarised: it names whether the token is missing or expired, which is the difference between
	 * signing in and signing in again.
	 */
	it('sends a wrangler with no credentials to log in', async () => {
		const { run } = wranglerStub([
			{
				when: (args) => args.includes('list'),
				reply: {
					code: 1,
					stderr:
						'No credentials found, and the environment is non-interactive so browser login ' +
						'cannot be started. Either: Set a CLOUDFLARE_API_TOKEN environment variable, or ' +
						'run `wrangler login` in an interactive terminal first.'
				}
			}
		]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('pnpm run login');
		expect(err.join('\n')).toContain('No credentials found');
	});

	/**
	 * the day `turnstile` stops being a wrangler command.
	 *
	 * every one of its subcommands is marked alpha in wrangler's own help, so this is a case rather
	 * than a defensive branch — and what is left of the errand when the command goes is the
	 * Cloudflare screen, which is why the operator is sent there and not told to log in.
	 */
	it('sends an operator to Cloudflare when wrangler has no turnstile command', async () => {
		const { run } = wranglerStub([
			{
				when: (args) => args.includes('list'),
				reply: { code: 1, stderr: 'Unknown argument: turnstile' }
			}
		]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('dash.cloudflare.com');
		expect(err.join('\n')).not.toContain('pnpm run login');
	});

	/**
	 * output that parses into something other than the list of widgets this reads.
	 *
	 * an alpha command may print a different shape at any version, and the failure this rules out
	 * is the quiet one: a reader that took `undefined` off an unexpected object would print a line
	 * with the word `undefined` in it, which an operator would then upload as a key.
	 */
	it.each([
		{ shape: 'a banner where JSON was expected', stdout: 'Fetching widgets…' },
		{ shape: 'an object instead of a list', stdout: '{"result":[]}' }
	])('refuses to read $shape from the list call', async ({ stdout }) => {
		const { run } = wranglerStub([{ when: (args) => args.includes('list'), reply: { stdout } }]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('dash.cloudflare.com');
	});

	/**
	 * the matched widget carrying no sitekey, which is the shape change that would otherwise reach
	 * wrangler: `get` takes the sitekey as a required positional, and a call built without one is an
	 * exception on the operator's terminal rather than a sentence naming what to do.
	 */
	it('makes no get call for a listed widget with no sitekey on it', async () => {
		const { run, calls } = wranglerStub([
			listAnswer([{ name: TURNSTILE_WIDGET_NAME, mode: 'managed' }])
		]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('dash.cloudflare.com');
		expect(calls).toHaveLength(1);
	});

	/**
	 * the matched widget coming back without a printable pair on it.
	 *
	 * `get` is the only call that returns a secret at all, so this is where a changed shape costs
	 * the most — and a value that cannot be written between single quotes is refused with it, since
	 * a `.deploy.vars` line is parsed before upload and a stray quote in one is read as syntax.
	 */
	it.each([
		{ shape: 'no secret on it', body: { name: TURNSTILE_WIDGET_NAME, sitekey: 'a-sitekey' } },
		{ shape: 'a quote in a key', body: widget({ secret: "it's not a key" }) }
	])('prints nothing when the widget comes back with $shape', async ({ body }) => {
		const { run } = wranglerStub([listAnswer([widget()]), getAnswer(body)]);

		const { code, out, err } = await capture(run);

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join('\n')).toContain('dash.cloudflare.com');
	});
});
