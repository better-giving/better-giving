import { parseArgs } from 'node:util';
import type { ConfigEnv } from '../config/env';
import { CHARIOT_LIVE_API_URL, createChariotProvider } from './chariot.ts';
import type { PaymentProvider, ProcessorName } from './provider.ts';
import { createPaypalProvider, PAYPAL_DEFAULT_API_URL } from './paypal.ts';
import { createStripeProvider } from './stripe.ts';
import { webhookAddress } from './webhook-address.ts';
import {
	readWebhookRegistration,
	repairWebhookRegistration,
	replaceWebhookRegistration
} from './webhook-registration.ts';

// what `node scripts/setup-webhook.ts <name>` does, as a value: registers this deployment's endpoint
// for one processor from the keys in `.env` and answers with the one line `.env` takes. the script
// prints it; ./webhook-setup.spec.ts drives it with the port as a value.
//
// what the endpoint is — its address, its events, its stamp — is the adapter's, reached through
// ./webhook-registration.ts and `registerWebhookEndpoint` in ./provider.ts; nothing here restates it.
//
// a re-run never refuses, and what it does to an endpoint already at the address is each setup's
// `rerun`. Stripe's value `.env` takes is returned once, by the call that creates the endpoint
// (`RegisteredWebhookEndpoint` in ./provider.ts), so a run that left it alone would have nothing to
// print — and the operator who re-runs is the one who lost it: it replaces. PayPal's is the
// listener's own id, which every list hands back, so it keeps the listener and brings its
// subscription level, and the deployment is never without one. Chariot's is a secret minted for the
// subscription, which no call hands back and none can change, so it replaces as Stripe does.
//
// relative imports here and in what they reach at runtime carry `.ts`, because node runs the script
// straight from source and resolves no extensionless path.

/** the environment the script runs in, as `process.env` hands it over. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * each processor the script can set up: what it needs from `.env`, which variable the answer goes
 * in, and the port built from those values.
 */
type Setup = {
	readonly credentials: readonly (keyof ConfigEnv)[];
	readonly variable: keyof ConfigEnv;
	readonly connect: (env: Env) => PaymentProvider;
	/**
	 * what a re-run does to the endpoint already at this address. `keep` only where the endpoint's
	 * own id is what `variable` holds, since that is the line it prints.
	 */
	readonly rerun: 'replace' | 'keep';
};

const SETUPS = {
	stripe: {
		credentials: ['STRIPE_SECRET_KEY'],
		variable: 'STRIPE_WEBHOOK_SECRET',
		rerun: 'replace',
		connect: (env) =>
			createStripeProvider({ secretKey: env.STRIPE_SECRET_KEY ?? '', webhookSecret: null })
	},
	paypal: {
		credentials: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
		variable: 'PAYPAL_WEBHOOK_ID',
		rerun: 'keep',
		connect: (env) =>
			createPaypalProvider({
				clientId: env.PAYPAL_CLIENT_ID ?? '',
				clientSecret: env.PAYPAL_CLIENT_SECRET ?? '',
				apiUrl: env.PAYPAL_API_URL ?? PAYPAL_DEFAULT_API_URL,
				webhookId: null
			})
	},
	chariot: {
		credentials: ['CHARIOT_API_KEY'],
		variable: 'CHARIOT_WEBHOOK_SECRET',
		rerun: 'replace',
		connect: (env) =>
			createChariotProvider({
				apiKey: env.CHARIOT_API_KEY ?? '',
				apiUrl: env.CHARIOT_API_URL || CHARIOT_LIVE_API_URL,
				webhookSecret: null
			})
	}
} as const satisfies Partial<Record<ProcessorName, Setup>>;

type SetupName = keyof typeof SETUPS;

function isSetupName(name: string | undefined): name is SetupName {
	return name !== undefined && Object.hasOwn(SETUPS, name);
}

const LOCAL_FLAG = 'allow-http-localhost';
const USAGE = `usage: node scripts/setup-webhook.ts <${Object.keys(SETUPS).join('|')}> [--${LOCAL_FLAG}]`;

/** the processor named and whether the local flag was given, or null for an invocation to refuse. */
function parseInvocation(argv: readonly string[]) {
	try {
		const { positionals, values } = parseArgs({
			args: [...argv],
			allowPositionals: true,
			options: { [LOCAL_FLAG]: { type: 'boolean' } }
		});
		const [name, ...rest] = positionals;
		if (!isSetupName(name) || rest.length > 0) return null;
		return { name, allowHttpLocalhost: values[LOCAL_FLAG] === true };
	} catch {
		return null;
	}
}

/** the origin deliveries can reach, or the sentence saying why `BETTER_AUTH_URL` is not one. */
function deliverableOrigin(
	value: string,
	allowHttpLocalhost: boolean
):
	| { readonly ok: true; readonly origin: string }
	| { readonly ok: false; readonly message: string } {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return {
			ok: false,
			message: `BETTER_AUTH_URL is not an address. It is this deployment's public origin, such as https://give.example.org.`
		};
	}
	if (parsed.protocol === 'https:') return { ok: true, origin: parsed.origin };
	if (allowHttpLocalhost && parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) {
		return { ok: true, origin: parsed.origin };
	}
	return {
		ok: false,
		message:
			`BETTER_AUTH_URL is ${parsed.origin}, which is not https. Processors deliver only to a public ` +
			`https address. For http on this machine, pass --${LOCAL_FLAG}.`
	};
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export type WebhookSetupResult =
	| { readonly ok: true; readonly line: string; readonly notices: readonly string[] }
	| { readonly ok: false; readonly status: 1 | 2; readonly message: string };

export async function setupWebhook(
	argv: readonly string[],
	env: Env,
	connect: (name: SetupName, env: Env) => PaymentProvider = (name, source) =>
		SETUPS[name].connect(source)
): Promise<WebhookSetupResult> {
	const invocation = parseInvocation(argv);
	if (!invocation) return { ok: false, status: 2, message: USAGE };
	const { name } = invocation;
	const setup = SETUPS[name];

	const missing = [...setup.credentials, 'BETTER_AUTH_URL'].filter((key) => !env[key]?.trim());
	if (missing.length > 0) {
		return {
			ok: false,
			status: 1,
			message: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set in .env.`
		};
	}

	const address = deliverableOrigin(env.BETTER_AUTH_URL ?? '', invocation.allowHttpLocalhost);
	if (!address.ok) return { ok: false, status: 1, message: address.message };
	const url = webhookAddress(name, address.origin);
	const provider = connect(name, env);

	const registration = await readWebhookRegistration(provider, url);
	if (registration.state === 'unreadable') {
		return { ok: false, status: 1, message: registration.detail };
	}

	if (registration.state === 'unregistered') {
		const registered = await provider.registerWebhookEndpoint(url);
		if (!registered.ok) return { ok: false, status: 1, message: registered.detail };
		return {
			ok: true,
			line: `${setup.variable}=${registered.value.verificationValue}`,
			notices: []
		};
	}

	if (setup.rerun === 'keep') {
		const kept = await repairWebhookRegistration(provider, url);
		if (!kept.ok) return { ok: false, status: 1, message: kept.detail };
		return {
			ok: true,
			line: `${setup.variable}=${kept.value.id}`,
			notices: [
				`Kept the endpoint already registered at ${url} and brought its subscription to what ` +
					`this deployment reads. Its ${setup.variable} is unchanged: the line below is the ` +
					'value .env already holds.'
			]
		};
	}

	const replaced = await replaceWebhookRegistration(provider, url);
	if (!replaced.ok) return { ok: false, status: 1, message: replaced.detail };
	return {
		ok: true,
		line: `${setup.variable}=${replaced.value.verificationValue}`,
		notices: [
			`Replaced the endpoint already registered at ${url}. Its ${setup.variable} stopped ` +
				'working when it was deleted: set the line below in .env and restart, or every ' +
				'delivery is refused.'
		]
	};
}
