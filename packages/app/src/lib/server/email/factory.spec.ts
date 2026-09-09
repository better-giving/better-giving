import { describe, expect, it, vi } from 'vitest';
import { setCommand, type DeployValueName } from '@better-giving/operator/deploy-split';
import { createEmailProvider } from './factory';
import type { EmailMessage } from './provider';
import type { MailerModule } from './smtp';

// in the node pool, which is only possible because `./smtp.ts` imports `worker-mailer`
// dynamically. that package pulls in `cloudflare:sockets`, which exists only inside workerd,
// so a static import would put this whole graph out of node's reach — and, worse, would break
// `vite build` outright (see the note at the top of ./smtp.ts). the dynamic form keeps the
// module loadable everywhere and the socket module loaded nowhere until a send is actually
// attempted.
//
// nothing here opens a socket, and nothing here relies on node to prevent one. every case
// either is a configuration the factory refuses before it would dial — the property being
// tested, since a deployment with a bad `SMTP_HOST` must find out from a sentence naming the
// variable rather than from a connection attempt — or is handed a stub loader in place of the
// client. a case that reached the real `import('worker-mailer')` would pass here only because
// node cannot resolve `cloudflare:sockets`, which is an environment accident rather than an
// assertion: in the workers pool that same case dials a real host from the test suite.

const MESSAGE: EmailMessage = {
	to: 'donor@example.org',
	subject: 'Your donation receipt',
	text: 'Thank you.',
	html: '<p>Thank you.</p>'
};

/** builds the provider for an env and sends into it, which is the only way to see a decision. */
async function send(env: Record<string, unknown>) {
	const result = await createEmailProvider(env, neverLoads).send(MESSAGE);
	if (result.ok) throw new Error('this configuration should not have reported a send');
	return result;
}

/**
 * a loader that fails the test if it is ever reached.
 *
 * every case in the refusal blocks below must decide before the transport is built, so the
 * honest way to assert that is a client that cannot be obtained rather than one that happens
 * not to resolve in this pool.
 */
const neverLoads = () => {
	throw new Error('the transport was loaded for a configuration that should have been refused');
};

/** the two members `send` destructures, capturing the options the client is handed. */
function stubMailer(captured: { options?: unknown }): () => Promise<MailerModule> {
	return async () =>
		({
			LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
			WorkerMailer: {
				send: async (options: unknown) => {
					captured.options = options;
				}
			}
		}) as unknown as MailerModule;
}

/** every variable a deployment that sends mail must have, with an ordinary value. */
const MAIL: Record<string, string> = {
	SMTP_HOST: 'mail.example.org',
	SMTP_USERNAME: 'user',
	SMTP_PASSWORD: 'pw',
	MAIL_FROM: 'donations@example.org'
};

describe('createEmailProvider', () => {
	/**
	 * unconfigured is a hole, not a choice. an env with nothing in it is the same answer as one
	 * with half of it in — `not_configured`, naming what to set — because a deployment that sends
	 * no receipts is never a state this app blesses.
	 */
	it.each([
		{ label: 'unset entirely', env: {} },
		{ label: 'blank', env: { SMTP_HOST: '  ', SMTP_USERNAME: '', SMTP_PASSWORD: '' } },
		{ label: 'bindings rather than strings', env: { SMTP_HOST: {}, SMTP_PASSWORD: 42 } }
	])('refuses to send when the mail variables are $label', async ({ env }) => {
		expect((await send(env)).reason).toBe('not_configured');
	});

	// every absent one, named together, because they are one setup step: the From address is
	// authorised by the same provider that issued the credential.
	it.each([
		{
			absent: ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'MAIL_FROM'] as DeployValueName[],
			env: {}
		},
		{ absent: ['MAIL_FROM'] as DeployValueName[], env: { ...MAIL, MAIL_FROM: '' } },
		{ absent: ['SMTP_PASSWORD'] as DeployValueName[], env: { ...MAIL, SMTP_PASSWORD: '  ' } }
	])(
		'refuses with $absent missing, naming it and the command that sets it',
		async ({ absent, env }) => {
			const result = await send(env);
			expect(result.reason).toBe('not_configured');
			for (const name of absent) {
				expect(result.detail).toContain(name);
				expect(result.detail).toContain(setCommand(name));
			}
		}
	);

	/**
	 * the port-25 guard, proven at the provider rather than at the parser. Workers prohibit
	 * outbound port 25, so this must come back as a settings problem naming the port — never
	 * as an opaque socket error, and never after a connection attempt.
	 */
	it('refuses port 25 without dialling anything', async () => {
		const result = await send({ ...MAIL, SMTP_PORT: '25' });
		expect(result.reason).toBe('not_configured');
		expect(result.detail).toContain('25');
		expect(result.detail).toContain('prohibit');
	});

	// the config is validated inside `send`, not at construction, so a bad value arrives in
	// the same shape as a host refusing a password — one failure channel, which is what keeps
	// mail off the ledger's write path.
	it.each([
		{ label: 'an unreachable host', env: { SMTP_HOST: 'localhost' } },
		{ label: 'a private address in short form', env: { SMTP_HOST: '127.1' } },
		{ label: 'a port that is not a number', env: { SMTP_PORT: 'submission' } },
		{ label: 'port 587', env: { SMTP_PORT: '587' } },
		{ label: 'a From with a display name', env: { MAIL_FROM: 'Hope <a@b.org>' } }
	])('refuses $label as a configuration failure', async ({ env }) => {
		expect((await send({ ...MAIL, ...env })).reason).toBe('not_configured');
	});

	/**
	 * port 587 is refused by the provider, not only by the parser, and it is worth its own case
	 * because it is the port every provider's own instructions lead with — so this is the
	 * refusal a real operator hits. the sentence has to carry the reason, because "use 465" on
	 * its own reads as an arbitrary rule.
	 */
	it('refuses port 587 with the reason, not just the rule', async () => {
		const result = await send({ ...MAIL, SMTP_PORT: '587' });
		expect(result.reason).toBe('not_configured');
		expect(result.detail).toContain('SMTP_PORT');
		expect(result.detail).toContain('465');
		expect(result.detail).toContain('in the clear');
	});

	/**
	 * the whole plumbing, end to end: a deployment's env becomes the options a client is handed.
	 *
	 * this is the one thing only this file can assert. `smtp-config.spec.ts` proves the parse and
	 * `smtp.spec.ts` proves the transport, but the mapping from `SMTP_*` variable to endpoint
	 * field lives between them — so a `SMTP_USERNAME` wired to the password slot would be green
	 * on both sides and broken in production.
	 *
	 * the credentials below are the point of the split: every one of these characters had to be
	 * percent-encoded when the credential lived in a connection URL's userinfo, and a missed
	 * decode authenticates as a password nobody set. here they must arrive byte for byte.
	 */
	it.each<{ label: string; env: Record<string, string> }>([
		{ label: 'an ordinary pair', env: {} },
		{ label: 'a Mailgun-style login', env: { SMTP_USERNAME: 'postmaster@example.org' } },
		{ label: 'colons and slashes', env: { SMTP_PASSWORD: 'p@ss:w/rd' } },
		{ label: 'a literal percent', env: { SMTP_PASSWORD: '100%sure' } },
		{ label: 'a hash and a space', env: { SMTP_PASSWORD: 'pw#1 two' } }
	])('hands the client the env verbatim with $label', async ({ env }) => {
		const captured: { options?: unknown } = {};
		const settings: Record<string, string> = { ...MAIL, ...env };

		const result = await createEmailProvider(settings, stubMailer(captured)).send(MESSAGE);

		expect(result).toEqual({ ok: true });
		expect(captured.options).toMatchObject({
			host: settings.SMTP_HOST,
			port: 465,
			credentials: { username: settings.SMTP_USERNAME, password: settings.SMTP_PASSWORD }
		});
	});

	/**
	 * the seal covers construction too. `sealed(build(source))` evaluates `build` before the seal
	 * exists, so a throw in there — reading the env, or any transport somebody adds an arm for
	 * later — would leave as an exception on the caller's path, which for the console's test send
	 * is the one channel this port exists to close. no build path throws today; the
	 * guarantee is that none can.
	 */
	it('reports a construction failure as a result rather than throwing it', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const hostile = {
			get SMTP_HOST(): string {
				throw new Error('reading this env is not allowed');
			}
		};

		const provider = createEmailProvider(hostile);
		await expect(provider.send(MESSAGE)).resolves.toMatchObject({
			ok: false,
			reason: 'internal_error'
		});
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	// never throws, on any input — the whole contract of the port in one sweep.
	it.each([
		{},
		{ SMTP_HOST: 'mail.example.org' },
		{ ...MAIL, SMTP_PORT: '25' },
		{ ...MAIL, SMTP_HOST: 'localhost' },
		{ ...MAIL, MAIL_FROM: 'nonsense' }
	])('returns a provider that resolves rather than throwing (%j)', async (env) => {
		await expect(createEmailProvider(env, neverLoads).send(MESSAGE)).resolves.toMatchObject({
			ok: false
		});
	});
});
