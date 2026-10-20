import { parseArgs } from 'node:util';
import type { ConfigEnv } from '../config/env';
import { openDatabase } from '../db/open.ts';
import { type DirectoryIdentity, readDirectoryIdentity } from '../org/directory-identity.ts';
import {
	CHARIOT_LIVE_API_URL,
	type ChariotDirectory,
	createChariotDirectory,
	createChariotProvider
} from './chariot.ts';
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
// for one processor from the keys in `.env` and answers with the lines `.env` takes. the script
// prints them; ./webhook-setup.spec.ts drives it with the port as a value.
//
// Chariot's run first connects the organisation, which is `connectOrganisation` below, and answers
// `CHARIOT_CONNECT_ID` beside the secret.
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
// subscription, which no call hands back and none can change, so it replaces as Stripe does; its
// Connect is kept, since Chariot holds one per organisation and hands it back on every run.
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
	readonly credentials: readonly (keyof ConfigEnv | 'DATABASE_URL')[];
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
		credentials: ['CHARIOT_API_KEY', 'DATABASE_URL'],
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

/** what Chariot's run reads and asks before the subscription: the profile, and Chariot's directory. */
export type ChariotOnboarding = {
	readonly readIdentity: (env: Env) => Promise<DirectoryIdentity>;
	readonly directory: (env: Env) => ChariotDirectory;
};

const CHARIOT_ONBOARDING: ChariotOnboarding = {
	async readIdentity(env) {
		const client = await openDatabase(env.DATABASE_URL ?? '');
		try {
			return await readDirectoryIdentity(client);
		} finally {
			client.close();
		}
	},
	directory: (env) =>
		createChariotDirectory({
			apiKey: env.CHARIOT_API_KEY ?? '',
			apiUrl: env.CHARIOT_API_URL || CHARIOT_LIVE_API_URL
		})
};

const CHARIOT_SUPPORT = 'support@givechariot.com';

type Step =
	| { readonly ok: true; readonly line: string; readonly notices: readonly string[] }
	| { readonly ok: false; readonly message: string };

/**
 * the organisation found in Chariot's directory by the EIN the profile holds, and its Connect, made
 * with the profile's notification address as its contact, as the `CHARIOT_CONNECT_ID` line.
 *
 * one organisation or none: a Connect made for one of several candidates is a Connect for an
 * organisation nobody chose. a re-run keeps the Connect, because Chariot answers a second create
 * with the one it holds (`ChariotConnect.existing` in ./chariot.ts).
 */
async function connectOrganisation(env: Env, onboarding: ChariotOnboarding): Promise<Step> {
	let identity: DirectoryIdentity;
	try {
		identity = await onboarding.readIdentity(env);
	} catch (error) {
		return {
			ok: false,
			message:
				'The database DATABASE_URL names could not be read, so your EIN was not looked up: ' +
				(error instanceof Error ? error.message : String(error))
		};
	}
	const ein = identity.ein?.replaceAll('-', '') ?? '';
	if (!/^\d{9}$/.test(ein)) {
		return {
			ok: false,
			message:
				'No EIN is saved for your organisation. Add the EIN in Settings, then run this again.'
		};
	}
	const contact = identity.notificationEmail;
	if (contact === null) {
		return {
			ok: false,
			message:
				'Chariot keeps your notification address as the contact for your organisation’s Connect, ' +
				'and none is saved. Add the notification address in Settings, then run this again.'
		};
	}

	const directory = onboarding.directory(env);
	const found = await directory.findOrganisations(ein);
	if (!found.ok) return { ok: false, message: found.detail };
	const [organisation, ...others] = found.value;
	if (organisation === undefined) {
		return {
			ok: false,
			message:
				`Your EIN, ${identity.ein}, isn’t in Chariot’s directory. Check it in Settings, or ask ` +
				`${CHARIOT_SUPPORT} to add you.`
		};
	}
	if (others.length > 0) {
		const named = found.value
			.map((one) => [one.name, one.city, one.state].filter((part) => part !== null).join(', '))
			.join('; ');
		return {
			ok: false,
			message:
				`Chariot lists more than one organisation with your EIN (${named}), so none was ` +
				`connected. Contact Chariot at ${CHARIOT_SUPPORT}.`
		};
	}
	if (!organisation.dafEligible) {
		return {
			ok: false,
			message:
				`Chariot doesn’t accept fund gifts for ${organisation.name}. Check your EIN in Settings, ` +
				`or contact Chariot at ${CHARIOT_SUPPORT}.`
		};
	}

	const connected = await directory.connect(organisation.id, contact);
	if (!connected.ok) return { ok: false, message: connected.detail };
	const notices: string[] = [];
	if (connected.value.existing) {
		notices.push(
			`Kept the Connect Chariot already holds for ${organisation.name}. Its CHARIOT_CONNECT_ID ` +
				'is unchanged.'
		);
	}
	if (!connected.value.active) {
		notices.push(
			`Chariot hasn’t switched ${organisation.name}’s Connect on yet, so no fund gift can be made ` +
				`through it until it does. Contact Chariot at ${CHARIOT_SUPPORT}.`
		);
	}
	return { ok: true, line: `CHARIOT_CONNECT_ID=${connected.value.id}`, notices };
}

export type WebhookSetupResult =
	| { readonly ok: true; readonly lines: readonly string[]; readonly notices: readonly string[] }
	| { readonly ok: false; readonly status: 1 | 2; readonly message: string };

export async function setupWebhook(
	argv: readonly string[],
	env: Env,
	connect: (name: SetupName, env: Env) => PaymentProvider = (name, source) =>
		SETUPS[name].connect(source),
	chariot: ChariotOnboarding = CHARIOT_ONBOARDING
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

	// before the subscription, so a refusal here leaves the one already delivering untouched.
	const before = name === 'chariot' ? await connectOrganisation(env, chariot) : null;
	if (before?.ok === false) return { ok: false, status: 1, message: before.message };
	const answer = (line: string, notices: readonly string[]): WebhookSetupResult => ({
		ok: true,
		lines: before === null ? [line] : [before.line, line],
		notices: before === null ? notices : [...before.notices, ...notices]
	});

	const provider = connect(name, env);

	const registration = await readWebhookRegistration(provider, url);
	if (registration.state === 'unreadable') {
		return { ok: false, status: 1, message: registration.detail };
	}

	if (registration.state === 'unregistered') {
		const registered = await provider.registerWebhookEndpoint(url);
		if (!registered.ok) return { ok: false, status: 1, message: registered.detail };
		return answer(`${setup.variable}=${registered.value.verificationValue}`, []);
	}

	if (setup.rerun === 'keep') {
		const kept = await repairWebhookRegistration(provider, url);
		if (!kept.ok) return { ok: false, status: 1, message: kept.detail };
		return answer(`${setup.variable}=${kept.value.id}`, [
			`Kept the endpoint already registered at ${url} and brought its subscription to what ` +
				`this deployment reads. Its ${setup.variable} is unchanged: the line below is the ` +
				'value .env already holds.'
		]);
	}

	const replaced = await replaceWebhookRegistration(provider, url);
	if (!replaced.ok) return { ok: false, status: 1, message: replaced.detail };
	return answer(`${setup.variable}=${replaced.value.verificationValue}`, [
		`Replaced the endpoint already registered at ${url}. Its ${setup.variable} stopped ` +
			'working when it was deleted: set the line below in .env and restart, or every ' +
			'delivery is refused.'
	]);
}
