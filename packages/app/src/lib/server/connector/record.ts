import { uuidv7 } from 'uuidv7';
import { GIFT_IN_HAND_INPUT } from '../../donations/input-schema';
import { IN_HAND_METHODS, type InHandMethod } from '../../donations/methods';
import { FORM_CURRENCY, readAmount } from '../../forms/amounts';
import { readAccountingDate } from '../../ledger/input-schema';
import {
	type ContactField,
	type ContactFormValues,
	parseContact,
	type ParsedContact,
	WHITESPACE_RUN
} from '../contacts/contact-input';
import type { Db } from '../db/client';
import { findRecordedGift } from '../donations/queries';
import {
	holdsSubmittedGift,
	recordGiftInHand,
	type SubmittedGiftInHand
} from '../donations/record-in-hand';
import { readGifts } from '../integrations/gift';
import type { ConnectorGift } from './reads';

// `donations.record`: a gift that arrived in hand, recorded from the chat. the body is translated
// into what the dashboard's Add a donation submits (src/routes/_app.admin.donations.new.tsx) and
// checked by the same rules — each box's rule in `GIFT_IN_HAND_INPUT`
// (../../donations/input-schema.ts), the donor's in `parseContact` — then written by the same writer,
// `recordGiftInHand` (../donations/record-in-hand.ts), which is the one that inserts. nothing here
// writes a row of its own, and no receipt is sent: the dashboard's box for one is the operator's to
// tick.
//
// the donor is always the writer's new arm: an email on file files the gift under that donor, as
// `resolveDonor` (../donations/donor.ts) matches one, and a name with no email makes a new donor.
//
// **one gift per idempotency key.** with an `Idempotency-Key`, the gift's and its payment's ids are
// derived from the connection's key id and that key, so a retry presents the ids the first call
// wrote and the database refuses it on the gift's primary key — the dashboard's second press, by
// the same writer. a retry of the same gift is answered as the first was, and a different gift
// under a key already spent is refused rather than called recorded. without the header the ids
// are minted fresh, and a retry is a second gift.

type Issue = { readonly path: string; readonly message: string };

/** what a call to record a gift came to. */
export type RecordOutcome =
	| { readonly ok: true; readonly status: 200 | 201; readonly gift: ConnectorGift }
	| {
			readonly ok: false;
			readonly status: 409 | 422 | 500;
			readonly code: string;
			readonly detail: string;
			readonly errors?: readonly Issue[];
	  };

const WRITABLE = ['amount', 'date', 'donor', 'campaign_id', 'method', 'note'] as const;
const DONOR_FIELDS = ['name', 'email'] as const;

/** the wire's four ways a gift arrived; `cash` and `check` are the writer's `InHandMethod`. */
const WIRE_METHODS = ['cash', 'check', 'bank_transfer', 'other'] as const;

const METHOD_IS = `is ${IN_HAND_METHODS.join(' or ')}, the ways this deployment records a gift in hand`;

/** where a refusal of each of the donor's parsed fields is answered on the wire. */
const DONOR_PATH: Record<ContactField, string> = {
	kind: 'donor.name',
	first_name: 'donor.name',
	last_name: 'donor.name',
	legal_name: 'donor.name',
	display_name: 'donor.name',
	primary_email: 'donor.email',
	primary_phone: 'donor.email'
};

/** a gift in hand as the body states it, parsed. */
type GiftCall = {
	readonly amountMinor: number;
	readonly dated: Date;
	readonly method: InHandMethod;
	readonly donor: ParsedContact;
	readonly source: string | null;
};

const ruleMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
	result.success ? null : (result.error?.issues[0]?.message ?? 'is refused');

/** the amount's text, from a decimal string or a `{ amount, currency }`; or its issue. */
function amountText(value: unknown): string | Issue {
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value !== null) {
		const { amount, currency } = value as { amount?: unknown; currency?: unknown };
		if ((currency ?? FORM_CURRENCY) !== FORM_CURRENCY)
			return { path: 'amount.currency', message: `is ${FORM_CURRENCY}, the one currency recorded` };
		if (typeof amount === 'string') return amount;
	}
	return {
		path: 'amount',
		message: `is a decimal string such as "25.00", or { "amount": "25.00", "currency": "${FORM_CURRENCY}" }`
	};
}

/**
 * a donor's one name as the boxes Add a donation's new donor fills: an individual, the last word
 * their last name and the rest their first, so the name they are filed under reads as it was sent.
 */
function donorValues(name: string, email: string | null): ContactFormValues {
	const words = name.replace(WHITESPACE_RUN, ' ').trim().split(' ');
	const last = words.length > 1 ? words.pop() : undefined;
	return {
		kind: 'individual',
		first_name: words.join(' '),
		...(last === undefined ? {} : { last_name: last }),
		...(email === null ? {} : { primary_email: email })
	};
}

function parseGift(body: unknown): GiftCall | Issue[] {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return [{ path: '', message: 'the body is a JSON object' }];
	const input = body as Record<string, unknown>;
	const issues: Issue[] = [];
	for (const key of Object.keys(input))
		if (!(WRITABLE as readonly string[]).includes(key))
			issues.push({
				path: key,
				message: `is not a field a gift takes; the fields are ${WRITABLE.join(', ')}`
			});

	let amountMinor: number | null = null;
	const text = amountText(input.amount);
	if (typeof text !== 'string') issues.push(text);
	else {
		const problem = ruleMessage(GIFT_IN_HAND_INPUT.shape.amount.safeParse(text));
		if (problem !== null) issues.push({ path: 'amount', message: problem });
		else amountMinor = readAmount(text, FORM_CURRENCY).minor;
	}

	let dated: Date | null = null;
	const day = input.date;
	const dayProblem =
		typeof day === 'string'
			? ruleMessage(GIFT_IN_HAND_INPUT.shape.received_on.safeParse(day))
			: 'is required';
	if (dayProblem !== null || typeof day !== 'string')
		issues.push({ path: 'date', message: `${dayProblem}, written YYYY-MM-DD` });
	else dated = readAccountingDate(day).at;

	const method = (IN_HAND_METHODS as readonly unknown[]).includes(input.method)
		? (input.method as InHandMethod)
		: null;
	if (method === null)
		issues.push({
			path: 'method',
			message: (WIRE_METHODS as readonly unknown[]).includes(input.method)
				? `${METHOD_IS}; ${String(input.method)} has no counterpart here, so ask the operator how it arrived`
				: METHOD_IS
		});

	if (input.campaign_id !== undefined && input.campaign_id !== null)
		issues.push({
			path: 'campaign_id',
			message: 'is left out: a hand-recorded gift is not tied to a campaign, and counts toward none'
		});

	let source: string | null = null;
	if (input.note !== undefined && input.note !== null) {
		const read = GIFT_IN_HAND_INPUT.shape.source.safeParse(input.note);
		if (!read.success) issues.push({ path: 'note', message: ruleMessage(read) ?? 'is refused' });
		else source = read.data.trim() === '' ? null : read.data.trim();
	}

	const donor = parseDonor(input.donor, issues);

	if (issues.length > 0 || amountMinor === null || dated === null || method === null || !donor)
		return issues;
	return { amountMinor, dated, method, donor, source };
}

function parseDonor(value: unknown, issues: Issue[]): ParsedContact | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		issues.push({ path: 'donor', message: 'is { "name": "…", "email": "…" }, the email optional' });
		return null;
	}
	const donor = value as Record<string, unknown>;
	for (const key of Object.keys(donor))
		if (!(DONOR_FIELDS as readonly string[]).includes(key))
			issues.push({
				path: `donor.${key}`,
				message: 'is not a field a donor takes; they are name, email'
			});
	const { name, email } = donor;
	if (typeof name !== 'string') {
		issues.push({ path: 'donor.name', message: 'is the donor’s name, as a string' });
		return null;
	}
	if (email !== undefined && email !== null && typeof email !== 'string') {
		issues.push({ path: 'donor.email', message: 'is an email address, or left out' });
		return null;
	}
	const parsed = parseContact(donorValues(name, typeof email === 'string' ? email : null));
	if (parsed.ok) return parsed.value;
	const seen = new Set<string>();
	for (const [field, message] of Object.entries(parsed.errors)) {
		const path = DONOR_PATH[field as ContactField];
		if (seen.has(path)) continue;
		seen.add(path);
		issues.push({ path, message });
	}
	return null;
}

const MAX_IDEMPOTENCY_KEY = 255;

/** a uuid in canonical form from 16 bytes, marked version 8 (RFC 9562's custom layout). */
function uuidOf(bytes: Uint8Array): string {
	const marked = Uint8Array.from(bytes);
	marked[6] = ((marked[6] ?? 0) & 0x0f) | 0x80;
	marked[8] = ((marked[8] ?? 0) & 0x3f) | 0x80;
	const hex = [...marked].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * the gift's and payment's ids: the two halves of SHA-256 over `<connector key id>:<idempotency
 * key>`, so one key on one connection always names the same gift; or fresh ones without a key.
 */
async function giftIds(
	keyId: string,
	idempotencyKey: string | null
): Promise<{ donationId: string; paymentId: string }> {
	if (idempotencyKey === null) return { donationId: uuidv7(), paymentId: uuidv7() };
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${keyId}:${idempotencyKey}`))
	);
	return { donationId: uuidOf(digest.subarray(0, 16)), paymentId: uuidOf(digest.subarray(16, 32)) };
}

const invalid = (issues: readonly Issue[]): RecordOutcome => ({
	ok: false,
	status: 422,
	code: 'invalid',
	detail: `The gift was refused: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}. Nothing was recorded.`,
	errors: issues
});

const WRITE_FAILED: RecordOutcome = {
	ok: false,
	status: 500,
	code: 'write_failed',
	detail:
		'Recording this gift did not complete, and it may have been recorded anyway. Retry with the same Idempotency-Key, which cannot record it twice; without one, check donations.list before retrying.'
};

/** the gift recorded under `paymentId`, as `donations.list` answers it. */
async function readBack(db: Db, paymentId: string): Promise<ConnectorGift> {
	const gift = (await readGifts(db, [paymentId])).get(paymentId);
	if (gift === undefined) throw new Error(`gift ${paymentId} was recorded and does not read back`);
	// a gift in hand names no form, so no campaign.
	return { ...gift, campaign_id: null };
}

/**
 * records the gift `body` states, on the connection `keyId` names, under `idempotencyKey` where the
 * call carried one.
 */
export async function recordConnectorGift(
	db: Db,
	keyId: string,
	idempotencyKey: string | null,
	body: unknown
): Promise<RecordOutcome> {
	if (
		idempotencyKey !== null &&
		(idempotencyKey.trim() === '' || idempotencyKey.length > MAX_IDEMPOTENCY_KEY)
	)
		return invalid([
			{
				path: 'Idempotency-Key',
				message: `is 1 to ${MAX_IDEMPOTENCY_KEY} characters naming this one gift, or left out`
			}
		]);
	const parsed = parseGift(body);
	if (Array.isArray(parsed)) return invalid(parsed);

	const { donationId, paymentId } = await giftIds(keyId, idempotencyKey);
	const recorded = await recordGiftInHand(db, {
		donationId,
		paymentId,
		donor: { kind: 'new', contact: parsed.donor },
		amountMinor: parsed.amountMinor,
		dated: parsed.dated,
		method: parsed.method,
		programId: null,
		source: parsed.source
	});
	if (recorded.ok) return { ok: true, status: 201, gift: await readBack(db, paymentId) };
	if (recorded.reason === 'write_failed') return WRITE_FAILED;

	const found = await findRecordedGift(db, donationId);
	const submitted: SubmittedGiftInHand = {
		amountMinor: parsed.amountMinor,
		receivedAt: parsed.dated,
		method: parsed.method,
		programId: null,
		source: parsed.source,
		donor: { kind: 'new', email: parsed.donor.primaryEmail, name: parsed.donor.displayName }
	};
	if (found === null || !holdsSubmittedGift(found, submitted))
		return {
			ok: false,
			status: 409,
			code: 'idempotency_conflict',
			detail:
				'This Idempotency-Key already recorded a different gift, so this one was not recorded. Send a new key for a new gift, or the same body to read back the gift the key recorded.'
		};
	return { ok: true, status: 200, gift: await readBack(db, paymentId) };
}
