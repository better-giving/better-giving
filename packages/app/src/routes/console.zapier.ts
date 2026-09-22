import type {
	ZapierPress,
	ZapierPressReport,
	ZapierReport
} from '@better-giving/operator/console/zapier';
import { ZAPIER_PRESSES } from '@better-giving/operator/console/zapier';
import { consoleJson } from '$lib/server/console/surface';
import {
	makeZapierKey,
	readZapierKey,
	replaceZapierKey,
	type MadeZapierKey,
	type ReplacedZapierKey,
	type ZapierKeyExists,
	type ZapierKeyNotReplaced
} from '$lib/server/zapier/key';
import { readZapierDeliveries } from '$lib/server/zapier/report';
import { countListening } from '$lib/server/zapier/subscriptions';
import { database } from '../context';
import type { Route } from './+types/console.zapier';

// the key Zapier presents to this deployment, and whether any Zap is listening on it.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read or press.
//
// **the plaintext key is in the answer to the press that made it and in nothing else.** the row
// holds a hash ($lib/server/zapier/key.ts), so the reading below cannot carry one, and a console
// that lost the key presses replace.
//
// **make and replace are two presses, each refused in the other's state**, so two consoles
// pressing at once cannot replace a key by accident: the second make is refused rather than
// cutting a key the first console just handed out.

/** where this deployment's Zapier connection stands, changing nothing. never the key. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);
	const [key, listening, deliveries] = await Promise.all([
		readZapierKey(db),
		countListening(db),
		readZapierDeliveries(db, new Date())
	]);

	const report: ZapierReport = {
		key: key === null ? null : { madeAt: key.madeAt.toISOString() },
		listening,
		deliveries: {
			waiting: deliveries.waiting,
			failed: deliveries.failed,
			oldestWaitingAt: deliveries.oldestWaitingAt?.toISOString() ?? null
		}
	};
	return consoleJson(report);
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md).
	const press = await readPress(request);
	if (press === undefined) return badBody();

	const db = context.get(database);
	const pressed =
		press === 'make' ? withNoneDisconnected(await makeZapierKey(db)) : await replaceZapierKey(db);
	if (!pressed.ok) return refused(press, pressed.reason);

	const report: ZapierPressReport = {
		ok: true,
		press,
		key: pressed.key,
		madeAt: pressed.madeAt.toISOString(),
		disconnected: pressed.disconnected
	};
	return consoleJson(report);
}

/**
 * a press refused by the key's own state, saying what to press or read next.
 *
 * a 200 and a report, not a 4xx: the body is well formed and the refusal is the answer to it —
 * the console's pass-through reads only a 200 as a report
 * (`packages/console/internal/deployment/quickbooks.go`, `quickbooksReport`).
 */
function refused(press: ZapierPress, reason: RefusalReason): Response {
	const detail = REFUSALS[reason];
	return consoleJson({ ok: false, press, detail } satisfies ZapierPressReport);
}

type RefusalReason = ZapierKeyExists['reason'] | ZapierKeyNotReplaced['reason'];

const REFUSALS: Record<RefusalReason, string> = {
	key_exists:
		'This deployment already has a Zapier key. Press replace to make a new one; every Zap on the old key is disconnected.',
	no_key: 'This deployment has no Zapier key to replace. Press make to make the first one.',
	conflict:
		'Another console replaced the Zapier key at the same moment, and its key is the one in use. Read this section again.'
};

/** a first key disconnects nothing: there was no key for a Zap to be on. */
const withNoneDisconnected = (
	made: MadeZapierKey | ZapierKeyExists
): ReplacedZapierKey | ZapierKeyExists => (made.ok ? { ...made, disconnected: 0 } : made);

/** the press the body names, or undefined where it names none this address takes. */
async function readPress(request: Request): Promise<ZapierPress | undefined> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return undefined;
	}
	if (typeof body !== 'object' || body === null) return undefined;
	const named = (body as { press?: unknown }).press;
	return ZAPIER_PRESSES.find((press) => press === named);
}

const badBody = (): Response =>
	consoleJson(
		{
			error: 'bad_body',
			message: 'The request body names no press this address takes.',
			fix: `Send \`{ "press": "make" }\`. The presses this address takes are ${ZAPIER_PRESSES.join(', ')}.`
		},
		400
	);
