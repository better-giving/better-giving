import { FREQUENCIES, TRIBUTE_KINDS } from '@better-giving/form/v1';
import { CONSENT_STATES } from '../../contacts/consent';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_EVENTS, type WebhookEvent } from '../../webhooks/catalog';
import { PAYMENT_METHODS, RECURRING_INTERVALS } from '../db/schema';
import { DESTINATION_PAUSE_AFTER_MS, WEBHOOK_RETRY_SCHEDULE_MS } from '../webhooks/deliver';
import type { AddedDonor, FailedCharge, OpenedDispute, RefundedGift } from '../webhooks/payload';
import type { ApiDonor } from './donor';
import { type ApiGift, GIFT_STATUSES } from './gift';
import { API_KEY_SHAPE } from './keys';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_CEILING } from './paging';
import { type ApiRecurringGift, RECURRING_GIFT_STATUSES } from './recurring-gift';
import { REFUND_SOURCES } from './refund';
import {
	ADDRESS_RATE_LIMIT,
	INTEGRATIONS_BASE_PATH,
	type IntegrationsRefusalCode,
	KEY_RATE_LIMIT
} from './surface';

// the OpenAPI 3.1 document this deployment serves at `OPENAPI_PATH`, describing the read API under
// `/integrations/v1` and the webhooks it posts: what an integrator's code, or the agent writing
// it, reads to call this deployment without reading this repository.
//
// **built from the constants, never retyped.** every number, list and name in it is read from the
// module that enforces it — the page sizes from ./paging.ts, the refusal codes and rate limits from
// ./surface.ts, the key's shape from ./keys.ts, the events from $lib/webhooks/catalog.ts, the retry
// schedule and the pause from ../webhooks/deliver.ts. what no constant carries is written here
// once: each object's schema, and which status each refusal code is answered with.
// ./openapi.spec.ts holds the document to the OpenAPI 3.1 schema, to the route files and the
// catalog, and each rate limit to wrangler.jsonc; ./openapi.workers.spec.ts validates real rendered
// objects against the schemas below and provokes every refusal against its documented status.
//
// **each object schema names every key its type has**: `SchemaOf<T>` refuses a schema missing a
// key of the type it describes, and every key is `required`, as the modules that render them
// promise (./gift.ts's header). a schema states no `additionalProperties: false`, since a key
// added later is not a breaking change to a reader told to let one pass.
//
// **nothing about an organisation is in it.** it names the request's own origin and nothing read
// from the database, so it is served without a key (src/routes/integrations.openapi[.]json.ts).

/** where this document is served, and where ./agent-prompt.ts is. */
export const OPENAPI_PATH = '/integrations/openapi.json';
export const AGENT_PROMPT_PATH = '/integrations/agent-prompt.md';

/**
 * how both are cached: by anyone, since neither names anything read from the database, and for
 * five minutes, so a deploy that changes them reaches every reader within that.
 */
export const DOCS_CACHE_CONTROL = 'public, max-age=300';

/** a JSON Schema 2020-12 schema, as the document carries one. */
export type JsonSchema = { readonly [keyword: string]: unknown };

/** an object schema naming each key of `T`, each required. */
type SchemaOf<T> = { readonly [K in keyof T]-?: JsonSchema };

/** the status each refusal code is answered with; a code added to ./surface.ts must be placed here. */
export const REFUSAL_STATUS: Readonly<
	Record<IntegrationsRefusalCode, 400 | 401 | 404 | 405 | 429>
> = {
	missing_key: 401,
	malformed_key: 401,
	unknown_key: 401,
	revoked_key: 401,
	not_found: 404,
	method_not_allowed: 405,
	rate_limited: 429,
	invalid_limit: 400,
	invalid_cursor: 400,
	invalid_updated_since: 400,
	unknown_parameter: 400
};

/** the `type` of the test post a destination can be sent, beside every catalog event. */
const WEBHOOK_TEST_TYPE = 'test';

/** each list the read API serves, by its path under `INTEGRATIONS_BASE_PATH`. */
const LIST_PATHS = {
	'/gifts': {
		operationId: 'listGifts',
		summary: 'List gifts',
		entry: 'Gift',
		description:
			'Every settled gift, with where it stands now: what refunds and lost disputes have taken back, and whether a dispute is open. A gift authorized and not yet settled is not listed. Without `updated_since`, newest first by `occurred_at`; with it, every gift whose `updated_at` is at or after it, oldest change first.'
	},
	'/donors': {
		operationId: 'listDonors',
		summary: 'List donors',
		entry: 'Donor',
		description:
			'Every donor the organisation’s dashboard lists, whether or not a gift of theirs has settled. What a donor has given is not here: the gifts list answers it gift by gift, each naming its `donor_id`. Without `updated_since`, newest first by `created_at`; with it, every donor whose `updated_at` is at or after it, oldest change first.'
	},
	'/recurring-gifts': {
		operationId: 'listRecurringGifts',
		summary: 'List recurring gifts',
		entry: 'RecurringGift',
		description:
			'Every commitment to give on a schedule, live or ended. Each charge it makes is a gift on the gifts list. `payment_failed` is not final: it turns `active` again if the processor collects after all, and only `stopped` never comes back. Without `updated_since`, newest first by when the commitment was recorded; with it, every recurring gift whose `updated_at` is at or after it, oldest change first.'
	}
} as const;

const text = (description?: string): JsonSchema => ({
	type: 'string',
	...(description === undefined ? {} : { description })
});
const nullableText = (description: string): JsonSchema => ({
	type: ['string', 'null'],
	description
});
const instant = (description: string): JsonSchema => ({
	type: 'string',
	format: 'date-time',
	description
});
const nullableInstant = (description: string): JsonSchema => ({
	type: ['string', 'null'],
	format: 'date-time',
	description
});
const minor = (description: string): JsonSchema => ({ type: 'integer', minimum: 0, description });
const growingSet = (values: readonly string[], description: string): JsonSchema => ({
	type: 'string',
	enum: [...values],
	description: `${description} The set may gain values: let one you do not know pass.`
});
const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

function record<T>(description: string, properties: SchemaOf<T>): JsonSchema {
	return { type: 'object', description, properties, required: Object.keys(properties) };
}

const AMOUNT: JsonSchema = {
	type: 'string',
	pattern: '^[0-9]+(\\.[0-9]+)?$',
	description:
		'Major units as a decimal string in the currency’s own digits: `51.50`, `2500` for JPY. `amount_minor` is the same figure as an integer.'
};
const CURRENCY: JsonSchema = {
	type: 'string',
	pattern: '^[A-Z]{3}$',
	description: 'ISO 4217 code.'
};

const GIFT = record<ApiGift>(
	'One settled gift, and where it stands now. Every field is present on every gift, null where the gift has nothing to say.',
	{
		id: text(
			'The gift’s id: the settled payment’s. Stable, and the `id` a `gift.made` post carries.'
		),
		donation_id: text('The donation this payment settled.'),
		occurred_at: instant('When the money moved, in UTC.'),
		amount: AMOUNT,
		amount_minor: minor('What the donor gave, in minor units of `currency`.'),
		currency: CURRENCY,
		covered_fee_minor: minor(
			'The processor fee the donor chose to add on top, included in `amount`, in minor units.'
		),
		method: growingSet(PAYMENT_METHODS, 'How the donor paid.'),
		recurring: { type: 'boolean', description: 'A charge under a recurring gift.' },
		frequency: growingSet(
			FREQUENCIES,
			'How often the donor chose to give: `one_time` for a single gift.'
		),
		form_id: nullableText('The donation form it came through; null for a gift entered by hand.'),
		form_name: nullableText('That form’s name.'),
		program_name: nullableText('The program the gift was designated to.'),
		dedication_kind: {
			type: ['string', 'null'],
			enum: [...TRIBUTE_KINDS, null],
			description: 'Given in honor or in memory of someone; null where it is neither.'
		},
		dedication_honoree: nullableText('Whom the dedication names.'),
		note: nullableText('What the donor wrote with the gift.'),
		donor_id: text('The donor, an `id` on the donors list.'),
		donor_name: text('The donor’s name as recorded.'),
		donor_email: nullableText('The donor’s email address.'),
		coin: nullableText('A crypto gift’s coin; null on every other rail.'),
		coin_amount: nullableText('How much of that coin arrived, as a decimal string.'),
		status: growingSet(
			GIFT_STATUSES,
			'What refunds and lost disputes have taken back: none, some, or all of it. An open dispute is `dispute_open`, never a status.'
		),
		amount_refunded_minor: minor(
			'What standing refunds and lost disputes have sent back, in minor units. A failed refund, a dispute won and a dispute still open send back nothing.'
		),
		dispute_open: {
			type: 'boolean',
			description: 'A dispute on this gift is open, and its money is withdrawn until it closes.'
		},
		updated_at: instant('When this gift last changed, in UTC: what `updated_since` compares.')
	}
);

const DONOR_PROPERTIES: SchemaOf<ApiDonor> = {
	id: text('The donor’s id, stable.'),
	name: text('The donor’s name as recorded.'),
	email: nullableText('The donor’s email address.'),
	consent: growingSet(
		CONSENT_STATES,
		'Whether the organisation may contact them: `unasked` is a person it may still ask, where `declined` is a decision to honour.'
	),
	created_at: instant('When the donor was first recorded, in UTC.'),
	updated_at: instant('When this donor last changed, in UTC: what `updated_since` compares.')
};

const DONOR = record<ApiDonor>(
	'One donor. Every field is present on every donor, null where the donor has nothing to say.',
	DONOR_PROPERTIES
);

const RECURRING_GIFT = record<ApiRecurringGift>(
	'One commitment to give on a schedule — never one of its charges, which are gifts. Every field is present, null where it has nothing to say.',
	{
		id: text('The recurring gift’s id, stable.'),
		donor_id: text('The donor, an `id` on the donors list.'),
		amount: AMOUNT,
		amount_minor: minor('Each charge, in minor units of `currency`.'),
		currency: CURRENCY,
		frequency: growingSet(RECURRING_INTERVALS, 'How often it charges.'),
		status: growingSet(
			RECURRING_GIFT_STATUSES,
			'Where it stands: `stopped` where the organisation ended it, `payment_failed` where the processor gave up on the donor’s card — which can turn `active` again.'
		),
		next_charge_at: nullableInstant(
			'When the next charge is expected, in UTC — an expectation, since the processor holds the schedule. Null for an ended gift, or one whose processor has not yet said.'
		),
		started_at: instant('When its first charge settled, in UTC.'),
		updated_at: instant(
			'When this recurring gift last changed, in UTC: what `updated_since` compares.'
		)
	}
);

const REFUNDED_GIFT = record<RefundedGift>(
	'Money sent back from a gift: a refund the organisation made, or a dispute it lost.',
	{
		id: text(
			'The refund’s own id, distinct from the gift’s: a second refund of one gift is a second event.'
		),
		occurred_at: instant(
			'When the money left, in UTC: for a refund, when it was made; for a dispute, when it opened, or where no opening was recorded, when it closed.'
		),
		amount: AMOUNT,
		amount_minor: minor('What left, in minor units of `currency`.'),
		currency: CURRENCY,
		source: growingSet(REFUND_SOURCES, 'What sent the money back.'),
		gift: { ...ref('Gift'), description: 'The gift it left, as the gifts list answers it now.' }
	}
);

const OPENED_DISPUTE = record<OpenedDispute>(
	'A dispute opened on a gift, and the money its opening withdrew.',
	{
		id: text(
			'The withdrawal’s id: the `id` a `gift.refunded` about the same dispute carries, should it be lost.'
		),
		opened_at: instant('When the dispute opened and withdrew the money, in UTC.'),
		amount: AMOUNT,
		amount_minor: minor('What the dispute holds, in minor units of `currency`.'),
		currency: CURRENCY,
		respond_by: nullableInstant(
			'The processor’s deadline for the organisation’s answer, in UTC; null where it named none.'
		),
		gift: { ...ref('Gift'), description: 'The disputed gift, as the gifts list answers it now.' }
	}
);

const ADDED_DONOR = record<AddedDonor>(
	'A donor whose first gift has settled: the donor as the donors list answers them, and that gift. Posted once per donor.',
	{
		...DONOR_PROPERTIES,
		first_gift: { ...ref('Gift'), description: 'The donor’s earliest settled gift.' }
	}
);

const FAILED_CHARGE = record<FailedCharge>(
	'One failed attempt at a recurring gift’s charge, as it was when it failed, and the recurring gift as it stands now.',
	{
		attempt_count: {
			type: 'integer',
			minimum: 1,
			description: 'Which attempt at this charge failed, from 1.'
		},
		next_retry_at: nullableInstant(
			'When the processor tries again, in UTC; null on its last attempt.'
		),
		failed_at: instant('When the attempt failed, in UTC.'),
		amount: AMOUNT,
		amount_minor: minor('What the attempt tried to charge, in minor units of `currency`.'),
		currency: CURRENCY,
		recurring_gift: ref('RecurringGift')
	}
);

const TEST_DATA: JsonSchema = {
	type: 'object',
	description:
		'A test post, sent from the destination’s page on the dashboard to check the receiver. It names no record and its keys are not promised: acknowledge it and act on nothing in it.'
};

/** each event's `data`, by the component schema that describes it. */
export const WEBHOOK_EVENT_DATA: Readonly<
	Record<WebhookEvent, { readonly schema: string; readonly about: string }>
> = {
	'gift.made': { schema: 'Gift', about: 'A gift settled. `data` is the gift.' },
	'gift.refunded': {
		schema: 'RefundedGift',
		about:
			'Money went back from a gift: a refund the organisation made, or a dispute it lost. Posted only while the refund still stands.'
	},
	'gift.dispute_opened': {
		schema: 'OpenedDispute',
		about: 'A donor’s bank opened a dispute on a gift, and withdrew its money until it closes.'
	},
	'donor.added': {
		schema: 'AddedDonor',
		about:
			'A donor’s first gift settled. Posted once per donor, on that gift — never when a gift is only started.'
	},
	'donor.updated': {
		schema: 'Donor',
		about: 'A donor changed. `data` is the donor as they stand when posted, not the change.'
	},
	'recurring_gift.started': {
		schema: 'RecurringGift',
		about: 'A recurring gift’s first charge settled.'
	},
	'recurring_gift.updated': {
		schema: 'RecurringGift',
		about:
			'A recurring gift changed. `data` is the recurring gift as it stands when posted, not the change.'
	},
	'recurring_gift.charge_failed': {
		schema: 'FailedCharge',
		about: 'An attempt at a recurring gift’s charge failed.'
	},
	'recurring_gift.ended': {
		schema: 'RecurringGift',
		about:
			'A recurring gift ended. `data` is the recurring gift as it stands when posted, which a revival since can show `active`.'
	}
};

/** `ms` as words: `1 minute`, `24 hours`. every entry the schedule holds is whole minutes. */
export function spokenDuration(ms: number): string {
	const minutes = ms / 60_000;
	const [count, unit] = minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
	return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** the waits between a post and each retry, in words. */
export function retryScheduleWords(): string {
	return WEBHOOK_RETRY_SCHEDULE_MS.map(spokenDuration).join(', ');
}

/** how many times a post is attempted before it is given up: the first, and one per wait. */
export const WEBHOOK_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1;

const DELIVERY_PROSE = [
	`**Signed to the Standard Webhooks spec** (https://www.standardwebhooks.com/): verify every post before trusting it. The signed content is \`{webhook-id}.{webhook-timestamp}.{body}\` — the body exactly as received, never re-serialized — HMAC-SHA256 keyed with the destination's signing secret's bytes: base64-decode what follows \`whsec_\`. \`webhook-signature\` is a space-separated list of \`v1,<base64 signature>\`; accept the post where any entry matches, compared in constant time, and reject a \`webhook-timestamp\` more than 5 minutes from now. A Standard Webhooks library does all of it.`,
	'**At least once, and unordered.** A post whose answer never came is posted again under the same `webhook-id`: dedupe on it. Each post carries the record as it stands when posted, so keep the latest per record by its `updated_at`.',
	`**Any 2xx is received.** Anything else, a redirect (never followed) or no answer is a failed post, retried after ${retryScheduleWords()} — ${WEBHOOK_ATTEMPTS} attempts in all — and then given up.`,
	`**A destination whose every post fails for ${spokenDuration(DESTINATION_PAUSE_AFTER_MS)} is paused**, and one answering 410 is paused at once. The organisation is emailed; what it is owed while paused is held, and posted when it is resumed.`,
	'**New event types may be added.** Answer a `type` you do not know with a 2xx and act on nothing in it.'
].join('\n\n');

/** the OpenAPI 3.1 document, with `origin` — the request's own — as the server. */
export function openApiDocument(origin: string) {
	const pageOf = (entry: string): JsonSchema => ({
		type: 'object',
		description: 'One page of a list.',
		properties: {
			data: { type: 'array', items: ref(entry), description: 'This page’s entries, in order.' },
			next_cursor: {
				type: ['string', 'null'],
				description:
					'Send as `cursor`, with the same other parameters, for the next page; null on the last.'
			},
			resume_updated_since: nullableInstant(
				'Where the next walk of changes resumes: on the last page of a walk with `updated_since`, and null everywhere else. Store it and send it as the next walk’s `updated_since`. It overlaps the walk it ends, so keep one row per `id`, the later answer winning.'
			)
		},
		required: ['data', 'next_cursor', 'resume_updated_since']
	});

	const codesAnswered = (status: number) =>
		(Object.keys(REFUSAL_STATUS) as IntegrationsRefusalCode[]).filter(
			(code) => REFUSAL_STATUS[code] === status
		);

	const refusal = (
		status: number,
		description: string,
		headers: Record<string, JsonSchema> = {}
	) => ({
		description,
		...(Object.keys(headers).length === 0 ? {} : { headers }),
		content: {
			'application/json': {
				schema: {
					type: 'object',
					properties: {
						error: {
							type: 'string',
							enum: codesAnswered(status),
							description: 'What to switch on. A code you do not know is read by its status.'
						},
						message: text('What was refused, naming the value.'),
						fix: text('What to send instead.')
					},
					required: ['error', 'message', 'fix']
				}
			}
		}
	});

	const header = (description: string, schema: JsonSchema = { type: 'string' }): JsonSchema => ({
		description,
		schema
	});

	const listOperation = (path: keyof typeof LIST_PATHS) => {
		const list = LIST_PATHS[path];
		return {
			get: {
				operationId: list.operationId,
				summary: list.summary,
				description: list.description,
				parameters: ['limit', 'cursor', 'updated_since'].map((name) => ({
					$ref: `#/components/parameters/${name}`
				})),
				responses: {
					'200': {
						description: 'A page.',
						content: { 'application/json': { schema: ref(`${list.entry}Page`) } }
					},
					'400': { $ref: '#/components/responses/InvalidQuery' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'405': { $ref: '#/components/responses/MethodNotAllowed' },
					'429': { $ref: '#/components/responses/RateLimited' }
				}
			}
		};
	};

	const eventName = (type: string) =>
		`${type.replace(/(^|[._])([a-z])/g, (_, __, letter: string) => letter.toUpperCase())}Event`;

	const webhook = (type: string, summary: string, about: string, data: JsonSchema) => ({
		type,
		post: {
			summary,
			description: about,
			parameters: ['webhook-id', 'webhook-timestamp', 'webhook-signature'].map((name) => ({
				$ref: `#/components/parameters/${name}`
			})),
			requestBody: {
				required: true,
				content: { 'application/json': { schema: ref(eventName(type)) } }
			},
			responses: {
				'2XX': { description: 'Received. Answer first and do the work after.' },
				'410': { description: 'The destination is withdrawn: it is paused at once.' },
				default: {
					description: `A failed post: retried after ${retryScheduleWords()}, then given up.`
				}
			}
		},
		envelope: {
			type: 'object',
			description: `The body of a \`${type}\` post.`,
			properties: {
				type: { const: type, description: 'The event.' },
				timestamp: instant(
					'When the event was recorded, in UTC: the same on every attempt at the post.'
				),
				data
			},
			required: ['type', 'timestamp', 'data']
		} satisfies JsonSchema
	});

	const events = [
		...WEBHOOK_EVENT_TYPES.map((type) =>
			webhook(
				type,
				WEBHOOK_EVENTS[type],
				WEBHOOK_EVENT_DATA[type].about,
				ref(WEBHOOK_EVENT_DATA[type].schema)
			)
		),
		webhook(
			WEBHOOK_TEST_TYPE,
			'Test',
			'Sent from the destination’s page on the dashboard to check the receiver: signed like every other post, and about nothing.',
			ref('TestData')
		)
	];

	return {
		openapi: '3.1.0',
		info: {
			title: 'Read API and webhooks',
			version: 'v1',
			description: [
				`This deployment’s records, read with a key: gifts, donors and recurring gifts, a page at a time, with \`updated_since\` to keep a copy in sync. And the webhooks it posts when they change. The same document, written as instructions for an AI coding agent, is at ${origin}${AGENT_PROMPT_PATH}.`,
				'**Every field is permanent.** An object may gain fields, never lose or rename one, and every field is present on every object, null where it has nothing to say. A value set marked as one that may gain values may: let a field or a value you do not know pass.',
				'**Ids are strings; times are ISO 8601 in UTC; money is `amount`, a decimal string in the currency’s own digits, beside `amount_minor`, an integer.**',
				`**Refusals** answer \`{ error, message, fix }\`: switch on \`error\`, and read \`message\` and \`fix\` for what to change.`,
				`**Rate limits**: ${KEY_RATE_LIMIT.requests} requests a minute per key, and ${ADDRESS_RATE_LIMIT.requests} a minute per calling address, counted before the key is checked. A refusal is a 429 with \`Retry-After\` in seconds.`,
				`## Webhooks\n\nThe organisation adds each destination on its dashboard, under Integrations → Webhooks, choosing its events; its signing secret is on that destination's page.\n\n${DELIVERY_PROSE}`
			].join('\n\n')
		},
		servers: [{ url: `${origin}${INTEGRATIONS_BASE_PATH}`, description: 'This deployment.' }],
		security: [{ apiKey: [] }],
		paths: Object.fromEntries(
			(Object.keys(LIST_PATHS) as (keyof typeof LIST_PATHS)[]).map((path) => [
				path,
				listOperation(path)
			])
		),
		webhooks: Object.fromEntries(events.map(({ type, post }) => [type, { post }])),
		components: {
			securitySchemes: {
				apiKey: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: `API key matching ${API_KEY_SHAPE.source}`,
					description:
						'An API key, sent as `Authorization: Bearer <key>` on every request. The organisation makes one per system on its dashboard, under Integrations → API, and it is shown once. It reads donors’ names and email addresses: keep it on a server, never in a browser or an app. This API sends no CORS headers.'
				}
			},
			parameters: {
				limit: {
					name: 'limit',
					in: 'query',
					description: 'How many entries a page holds. A larger one is refused, never cut.',
					schema: {
						type: 'integer',
						minimum: 1,
						maximum: PAGE_SIZE_CEILING,
						default: DEFAULT_PAGE_SIZE
					}
				},
				cursor: {
					name: 'cursor',
					in: 'query',
					description:
						'The `next_cursor` of the page before, exactly as it came, with the same other parameters. Opaque.',
					schema: { type: 'string' }
				},
				updated_since: {
					name: 'updated_since',
					in: 'query',
					description:
						'Every entry whose `updated_at` is at or after this instant, oldest change first. Send the `resume_updated_since` your last walk ended on, or an early instant such as `1970-01-01T00:00:00Z` for everything. An offset other than `Z` has its `+` sent as `%2B`.',
					schema: { type: 'string', format: 'date-time' }
				},
				'webhook-id': {
					name: 'webhook-id',
					in: 'header',
					required: true,
					description: 'The event’s id: the same on every attempt at it. Dedupe on it.',
					schema: { type: 'string' }
				},
				'webhook-timestamp': {
					name: 'webhook-timestamp',
					in: 'header',
					required: true,
					description:
						'When this attempt was signed, in whole seconds since the Unix epoch. Reject one more than 5 minutes from now.',
					schema: { type: 'string', pattern: '^[0-9]+$' }
				},
				'webhook-signature': {
					name: 'webhook-signature',
					in: 'header',
					required: true,
					description:
						'A space-separated list of `v1,<base64 signature>`: HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}`, keyed with the base64-decoded part of the signing secret after `whsec_`.',
					schema: { type: 'string' }
				}
			},
			responses: {
				InvalidQuery: refusal(400, 'The query names a value this list does not take.'),
				Unauthorized: refusal(401, 'No live API key was presented.', {
					'WWW-Authenticate': header('`Bearer`.')
				}),
				NotFound: refusal(
					404,
					`Nothing is served at the address: \`${INTEGRATIONS_BASE_PATH}\` itself is only the prefix.`
				),
				MethodNotAllowed: refusal(405, 'Only GET and HEAD are answered: nothing here writes.', {
					Allow: header('`GET, HEAD`.')
				}),
				RateLimited: refusal(
					429,
					`A bucket is spent: ${KEY_RATE_LIMIT.requests} requests a minute per key, or ${ADDRESS_RATE_LIMIT.requests} a minute per calling address. Nothing about the request is wrong.`,
					{
						'Retry-After': header('Seconds to wait before sending it again.', {
							type: 'string',
							pattern: '^[0-9]+$'
						})
					}
				)
			},
			schemas: {
				Gift: GIFT,
				Donor: DONOR,
				RecurringGift: RECURRING_GIFT,
				RefundedGift: REFUNDED_GIFT,
				OpenedDispute: OPENED_DISPUTE,
				AddedDonor: ADDED_DONOR,
				FailedCharge: FAILED_CHARGE,
				TestData: TEST_DATA,
				...Object.fromEntries(
					Object.values(LIST_PATHS).map((list) => [`${list.entry}Page`, pageOf(list.entry)])
				),
				...Object.fromEntries(events.map(({ type, envelope }) => [eventName(type), envelope]))
			}
		},
		'x-rate-limits': {
			per_key: { requests: KEY_RATE_LIMIT.requests, period_seconds: KEY_RATE_LIMIT.periodSeconds },
			per_address: {
				requests: ADDRESS_RATE_LIMIT.requests,
				period_seconds: ADDRESS_RATE_LIMIT.periodSeconds
			}
		},
		'x-webhook-delivery': {
			description: DELIVERY_PROSE,
			signature: {
				spec: 'https://www.standardwebhooks.com/',
				algorithm: 'HMAC-SHA256',
				signed_content: '{webhook-id}.{webhook-timestamp}.{body}',
				header: 'v1,<base64 signature>',
				secret: 'whsec_<base64 key bytes>',
				timestamp_tolerance_seconds: 300
			},
			at_least_once: true,
			ordered: false,
			retry_schedule_seconds: WEBHOOK_RETRY_SCHEDULE_MS.map((ms) => ms / 1_000),
			attempts: WEBHOOK_ATTEMPTS,
			pause_after_seconds: DESTINATION_PAUSE_AFTER_MS / 1_000,
			paused_at_once_on: 410
		}
	};
}
