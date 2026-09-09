import { setCommand } from '@better-giving/operator/deploy-split';
import { MAIL_SMTP_VARS, readConfigEnv, smtpFields } from '../config/env';
import { logProviderFault, refusing, sealed, type EmailProvider } from './provider';
import { createSmtpProvider, type MailerModule } from './smtp';

// the one place a deployment's configuration becomes an `EmailProvider`.
//
// built per request from `platform.env`, never a module-scope singleton — the same rule the
// D1 handle, the Better Auth instance and the Stripe client follow (CLAUDE.md), and for the
// same reason: the secrets only exist on a request's platform env, so a cached provider is a
// cached copy of one deployment's environment. `createAuth(db, …)` in ../auth/index.ts, built per
// request at the gate over the screens behind the login (../auth/gate.ts), is that shape.
//
// it is deliberately not seeded onto the request context. what belongs there is what every surface
// may need and nothing that costs a read (src/request-context.ts); a provider is built by the two
// call sites that actually send — the console's test send (src/routes/console.test-email.ts) and
// the Stripe webhook route, which hands one to `settleDelivery` in ../donations/settle.ts. putting
// it on every request would construct something for thousands of page views that never send
// anything.
//
// it imports ./smtp.ts, which is safe only because that module defers its `worker-mailer`
// import into `send`. hoisting that import would make this file — and every route that
// builds a provider — unloadable under node, which is where `vite build` reads a route's
// exports. see the note at the top of ./smtp.ts before touching it.
//
// the vocabulary and the predicates are imported rather than restated. the required-variable
// list (`MAIL_SMTP_VARS`) and the env-to-field mapping (`smtpFields`) are imported, never
// re-listed here — see `../config/env.ts` for what a hand-written second copy costs.

/**
 * the provider this deployment is configured for.
 *
 * `source` is the raw platform env, narrowed by `readConfigEnv` — the same entry point
 * every other reader of the deploy-time values takes, so blank and non-string values mean
 * "absent" here exactly as they do there, and an operator's trailing newline cannot produce a
 * provider that dials a host named `mail.example.org\n`.
 *
 * every path returns a provider; none throws and none returns null. a caller's error
 * handling is `if (!result.ok)` and nothing else, which is what keeps mail off the ledger's
 * write path (see ./provider.ts).
 *
 * and every path is `sealed`. this is the only function in the app that hands out a provider,
 * which is what makes the seal total: an adapter that throws where the port says it cannot —
 * including the one nobody has written yet — is a logged bug and a `SendResult`, never an
 * exception reaching a caller that has committed a `batch()`.
 *
 * the seal covers building a provider as well as sending with one, which is why the `try`
 * wraps the call rather than the expression: in `sealed(build(source))` the argument is
 * evaluated before the seal exists, so a throw inside `build` goes straight to the caller —
 * the console's test-send action, which is the exact channel the port exists to close.
 * nothing in `build` throws today; what is guaranteed here is that nothing added to it can. a
 * construction failure is `internal_error` for the reason ./provider.ts gives that reason: it
 * is a bug in this app, not a network to wait for and not a secret to re-enter.
 *
 * `load` is a test seam and nothing else — production never passes it, and it is handed
 * straight to `createSmtpProvider`, whose own note explains why the transport takes one. it
 * exists here as well because the mapping from `SMTP_*` variable to endpoint field lives in
 * this function and nowhere else: a spec that cannot reach the client can only assert which
 * configurations are refused, so a username wired into the password slot would be green in
 * every other file. it is also what keeps this spec honest — without it those cases pass only
 * because node cannot resolve `cloudflare:sockets`, which is an accident of the pool rather
 * than an assertion, and in workerd the same test would dial a real host.
 */
export function createEmailProvider(
	source: unknown,
	load?: () => Promise<MailerModule>
): EmailProvider {
	try {
		return sealed(build(source, load));
	} catch (error) {
		logProviderFault('the email factory threw while building a provider:', error);
		return refusing(
			'internal_error',
			'The email transport could not be built at all, which is not a state this app is ' +
				'supposed to be able to reach. Nothing about the deployment fixes it. It is a bug in ' +
				'this app, and the cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout). No message was sent.'
		);
	}
}

function build(source: unknown, load?: () => Promise<MailerModule>): EmailProvider {
	const env = readConfigEnv(source);

	// every absent one, named together, because they are one setup step: the From address is
	// authorised by the same provider that issued the SMTP credential, so an operator who set
	// some and not the others has done part of a single task.
	//
	// each command comes from `setCommand` in `@better-giving/operator/deploy-split` rather than
	// from a literal, so a name that moves from one side of the split to the other moves this
	// sentence with it.
	//
	// nothing selects a transport here and nothing may. the only question this function asks is
	// whether the deployment can send, and these four variables are the whole answer — see the
	// reason set in ./provider.ts for why "configured not to" is not one of them.
	const absent = MAIL_SMTP_VARS.filter((name) => !env[name]);
	if (absent.length > 0) {
		return refusing(
			'not_configured',
			`This deployment is not set up to send email: ${absent.map((name) => `\`${name}\``).join(' and ')} ` +
				`${absent.length === 1 ? 'is' : 'are'} not set, so no message can be sent. Run ` +
				`${absent.map((name) => `\`${setCommand(name)}\``).join(' and ')}.`
		);
	}

	// non-null by the filter above; `noUncheckedIndexedAccess` cannot follow it. `SMTP_PORT` is
	// not in that filter and is passed as it came: absent is 465, which is the only value it may
	// hold anyway.
	// `load` is passed through rather than defaulted here: `createSmtpProvider` owns the real
	// dynamic import, and defaulting it in two places is two things to keep in step.
	return load
		? createSmtpProvider({ ...smtpFields(env), from: env.MAIL_FROM ?? '' }, load)
		: createSmtpProvider({ ...smtpFields(env), from: env.MAIL_FROM ?? '' });
}
