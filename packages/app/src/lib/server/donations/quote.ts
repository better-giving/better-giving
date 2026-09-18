import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { estimateDeductedFee, estimateFee } from '@better-giving/form/fee';
import type { ApiErrorCode, Deposit, FormConfig, Frequency, Quote } from '@better-giving/form/v1';
import { majorText } from '../../forms/amounts';
import type { TurnstileCheck, TurnstileResult } from '../api/turnstile';
import type { Db } from '../db/client';
import { donation, payment } from '../db/schema';
import type { EmailProvider } from '../email/provider';
import type { FormRecord } from '../forms/form-input';
import { cachedCadences } from '../forms/cadence-cache';
import { cachedCoins } from '../forms/coin-cache';
import { readPublishedConfig } from '../forms/published-config';
import { cachedRails } from '../forms/rail-cache';
import { processorSetupFix, type Processors } from '../payments/factory';
import {
	commitmentMetadata,
	type DepositInstructions,
	type Intent,
	type ProcessorName,
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	FEE_RAIL_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	processorOf,
	PROCESSOR_LABELS,
	type QuotedRail,
	type RecurringInterval
} from '../payments/provider';
import { alert } from './delivery';
import { depositQr } from './deposit-qr';
import { commitDonor } from './donor';
import { sendCryptoPending } from './crypto-pending';
import { sendGrantRequested } from './grant-requested';
import { parseQuoteRequest, type DafAuthorization, type ParsedQuoteRequest } from './quote-input';
import { recordAuthorizedGift, recordDonation } from './record';

// one donation attempt, from a posted body to a payment token — the server half of
// `POST /api/v1/forms/:id/donations`.
//
// it is a module rather than the route's body for the reason ../forms/published-config.ts is one:
// every refusal below is a decision, and a decision made inside a `RequestHandler` can only be
// tested through a `Response`. what stays on the route is which status each refusal answers with
// and which callers may read the answer; what lives here is the order things are checked in and
// what each check says.
//
// ---------------------------------------------------------------------------
// the order is the design, and three parts of it are load-bearing.
//
// the config ladder runs first, whole. `readPublishedConfig` is the same function the config
// endpoint answers with, so a form this deployment will not serve a config for cannot take a gift
// either — one ladder, one vocabulary, and no second copy to drift. it also hands back exactly what
// the rest of this needs: the bounds to re-check the amount against, the rails and frequencies the
// form offers, the fee rules, and the row carrying `revenue_account_id` and `allowed_origins`.
//
// the challenge runs before the intent. a token is what stands between a public,
// payment-initiating endpoint and a script pointed at it (CLAUDE.md), so it is checked before
// anything is minted at the processor — a refusal after `createIntent` would leave a live intent
// behind for every rejected submission.
//
// the write runs last, and it is the only step that is not undone by returning early. the intent
// exists at the processor by then; if the write fails, the donor is refused and an intent nobody
// confirmed is left to expire, which is the right way round — the alternative is a gift recorded
// against a payment that was never minted.
//
// ---------------------------------------------------------------------------
// how often the gift repeats is the last thing decided, and the two branches order themselves
// oppositely on purpose.
//
// everything above the branch is shared and every refusal in it is shared, which is the point of
// deciding this late: the challenge, the bounds and the fee are the same checks whichever kind of
// gift this is, and a second copy of them under the second branch is how one of them quietly stops
// running for repeating gifts.
//
// both branches mint at the processor and then write the gift, and both record it before anything
// has been collected: an unfinished gift is a gift the organisation can see and contact, whichever
// cadence the donor picked. what separates them is one step in front. a repeating gift commits the
// donor first, because the gift row it writes afterwards names that donor and `donation.contact_id`
// is a foreign key — and that row is the whole of what every later charge is attributed through
// (`commitmentMetadata` in ../payments/provider.ts). a single gift's intent needs no such row in
// front of it.
//
// what neither branch writes is the ledger and the `recurring_plan` row. no money has moved, so
// nothing is in the books (./record.ts), and a commitment exists from its first charge that settles
// (./collect.ts) — which is also the charge that claims the gift written here.
// ---------------------------------------------------------------------------

/**
 * why a quote was not minted, as a closed set.
 *
 * the members through `payments_not_configured` are `readPublishedConfig`'s own, carried through
 * under their own names so that a caller answering both endpoints answers them the same way. the
 * rest are this path's.
 *
 * not every member is a wire code, and `QUOTE_REFUSAL_CODES` below is the subset that is. the ones
 * that are not name no screen: an integrator's malformed body is fixed in their own code, and an
 * outage or a defect of ours is fixed by nobody reading the response.
 */
export const QUOTE_REFUSALS = [
	'form_not_found',
	'form_not_published',
	'form_retired',
	'form_unservable',
	'org_profile_incomplete',
	'payments_not_configured',
	/** the posted body. see ./quote-input.ts. */
	'invalid_request',
	/**
	 * a repeating gift the processor would not commit to, on a cadence this deployment offered.
	 *
	 * `offeredCadences` in ../forms/offered-cadences.ts narrows the served list to what every
	 * configured processor's account can collect, so the ordinary donor never picks a cadence that
	 * reaches this. what does reach it is a page served while the account still held what a
	 * repeating gift is charged against, posted after it stopped — ../forms/cadence-cache.ts keeps
	 * that answer at the edge for minutes, and the donation path deliberately does not gate on the
	 * capability a second time (CLAUDE.md, *Bans* → **Repeating gifts**), so the submission is
	 * carried to the processor and refused there rather than turned away here.
	 *
	 * answered 503 rather than 4xx (src/routes/api.v1.forms.$id.donations.ts): nothing the donor
	 * sent is wrong, and a single gift on the same rail still goes through.
	 */
	'frequency_unsupported',
	/** the token was not one Cloudflare would honour. a fresh challenge is the answer. */
	'challenge_failed',
	/**
	 * the challenge could not be made at all — no credentials, or Cloudflare did not answer.
	 *
	 * separate from `challenge_failed` because no new token fixes either one, and telling a donor to
	 * solve another challenge would put them in a loop. `TurnstileResult`'s own split is what this
	 * carries through (../api/turnstile.ts): its `operatorFix` is written for the deployment's log.
	 */
	'challenge_unavailable',
	/** the processor refused, shed load, or did not answer. */
	'payments_unavailable',
	/**
	 * a donor-advised fund gift whose approval in the fund's window is more than 15 minutes old, so
	 * Chariot no longer holds it and no grant was created. the donor reopens the fund's window.
	 */
	'daf_authorization_expired',
	/**
	 * a donor-advised fund gift the fund will not grant — below its minimum, above the donor's
	 * balance — carrying Chariot's reason. nothing about the deployment is wrong; the donor gives a
	 * different amount.
	 */
	'daf_grant_declined',
	/**
	 * a crypto gift in a coin the account does not take today, so no address was minted. checked
	 * against the account at the moment of the quote, so a coin switched off after the served list
	 * was cached lands here. the donor picks another coin.
	 */
	'coin_not_accepted',
	/**
	 * a crypto gift converting to less of the coin than NOWPayments accepts, so no address was minted
	 * — a deposit under the floor lands failed or part-paid rather than as a gift. where the adapter
	 * read the floor, the message names it in dollars and `minAmountMinor` carries it as a gift.
	 */
	'below_minimum',
	/** a crypto gift NOWPayments refused as more than it takes in the coin. no address was minted. */
	'above_maximum',
	/** a defect of ours. nothing about the request or the deployment fixes it. */
	'internal_error'
] as const;
export type QuoteRefusal = (typeof QUOTE_REFUSALS)[number];

/**
 * the refusals that are also `API_ERROR_CODES` members, and therefore reach the wire as `error`.
 *
 * declared `satisfies readonly ApiErrorCode[]` so a member added here without being minted in
 * packages/form/src/v1.ts is a compile error — that file is where the add-never-rename rule is stated, so a
 * code is minted there and spent here, never the other way round.
 */
export const QUOTE_REFUSAL_CODES = [
	'form_not_found',
	'form_not_published',
	'form_retired',
	'form_unservable',
	'org_profile_incomplete',
	'payments_not_configured',
	'challenge_failed',
	'payments_unavailable',
	'daf_authorization_expired',
	'daf_grant_declined',
	'coin_not_accepted',
	'below_minimum',
	'above_maximum'
] as const satisfies readonly ApiErrorCode[];

/** whether a refusal carries an `error` code on the wire, or only a sentence. */
export function refusalCode(reason: QuoteRefusal): ApiErrorCode | null {
	return (QUOTE_REFUSAL_CODES as readonly string[]).includes(reason)
		? (reason as ApiErrorCode)
		: null;
}

/**
 * a quote, or the reason there is none.
 *
 * the form row is carried on both branches for the reason ../forms/published-config.ts carries it:
 * the CORS headers on every answer, refusals included, are decided from that row's
 * `allowed_origins`, and a refusal a browser cannot read is a refusal that reaches nobody. `null`
 * only where there is no row — an id nothing matches.
 */
export type QuoteResult =
	| { readonly ok: true; readonly quote: Quote; readonly form: FormRecord }
	| {
			readonly ok: false;
			readonly reason: QuoteRefusal;
			readonly message: string;
			readonly fix: string;
			readonly form: FormRecord | null;
			/**
			 * `below_minimum` only, where the processor named its floor: the least gift the coin takes,
			 * in the minor units and terms of `QuoteRequest.amountMinor` — the donor's own figure, any
			 * covered fee left out.
			 */
			readonly minAmountMinor?: number;
	  };

/** everything this needs that it may not build for itself. */
export type QuoteDeps = {
	readonly db: Db;
	/** the raw platform env, narrowed by the readers that take it. never returned from a loader. */
	readonly env: unknown;
	/**
	 * the processors this deployment can charge on, already sealed by `createPaymentProviders`.
	 *
	 * built by the route from the same env, per request. it arrives as a dependency rather than
	 * being constructed here so that a spec can drive every arm of `PaymentResult` without an
	 * account — the seam ../payments/stripe.spec.ts takes one level lower.
	 *
	 * the set rather than one provider, because the route cannot select: it builds this before the
	 * body is read, and which processor mints the intent is decided by the rail the donor picked
	 * (`Processors.forRail` in ../payments/factory.ts), which is a value on the parsed submission.
	 */
	readonly processors: Processors;
	/**
	 * the challenge check, injected for the same reason and required rather than defaulted.
	 *
	 * a default would make a spec that forgot to pass one reach Cloudflare over the network from
	 * inside the test runner, which is a test that passes or fails on somebody else's uptime.
	 */
	readonly verifyChallenge: (check: TurnstileCheck) => Promise<TurnstileResult>;
	/**
	 * the mail transport, for the donor's notices sent at quote time — that a fund's grant request went
	 * (./grant-requested.ts) and where to send a crypto gift (./crypto-pending.ts) — and the alerts for
	 * a grant that may exist with no gift recorded against it. its failures are reported and never
	 * change the answer.
	 */
	readonly email: EmailProvider;
	/**
	 * work that finishes after the answer: the Worker's `ctx.waitUntil`.
	 *
	 * the donor's notices and the operator's alerts go here, since slow mail would otherwise
	 * count against the form's 30-second wait on a gift already recorded or already refused.
	 * required for `verifyChallenge`'s reason.
	 */
	readonly defer: (task: Promise<unknown>) => void;
};

/** the request this is minting a quote for. */
export type QuoteAttempt = {
	/** the form id as the path spelled it. */
	readonly formId: string;
	/** the parsed JSON body, read exactly once by the route that owns it. */
	readonly body: unknown;
	/** the submission itself — for the challenge's client address and the `Origin` header. */
	readonly request: Request;
};

/**
 * what a line item taken through a donation form is called.
 *
 * a donor-facing word rather than the form's staff-facing `name` (CLAUDE.md keeps schema and staff
 * vocabulary off anything a donor reads), and a constant rather than a column because v0 itemizes
 * every gift the same way: one line, the whole amount, to the fund the form names.
 */
const LINE_LABEL = 'Donation';

/**
 * mints one quote: checks everything, opens an intent, writes the gift.
 *
 * never throws for a refusal. the payment port is sealed and `recordDonation` returns a result, so
 * the only way out of here is a `QuoteResult` — which is what keeps a public endpoint from
 * answering 500 with no body where it could have named a value.
 */
export async function mintQuote(deps: QuoteDeps, attempt: QuoteAttempt): Promise<QuoteResult> {
	// how often a gift may repeat and which rails a donor is shown are both read off this
	// deployment's processor accounts through the edge cache, and the port is `deps.processors` — the
	// same injected one every other call here uses, so this reaches no network a spec did not ask
	// for. the request's own origin is spent as a cache key — an entry in `caches.default` belongs to
	// the zone that asked for it, see ../forms/cadence-cache.ts and ../forms/rail-cache.ts — and as the
	// deployment origin an intent is minted with, never the `Origin` header.
	//
	// what comes back narrows what this path *offers* and never what it *accepts*, and two things
	// hold that. `parseQuoteRequest` below reads both vocabularies whole rather than the served
	// lists — `FREQUENCIES` in packages/form/src/v1.ts for the cadence and `OFFERED_PAYMENT_METHODS`
	// for the rail; and `readPublishedConfig` mints no refusal over an empty rail list at all — the one that exists is `renderableConfig` in
	// ../forms/published-config.ts, which only the config route composes. so a donor on a cached page
	// holding a rail this deployment has since stopped offering is charged rather than turned away
	// (CLAUDE.md), and so is every donor mid-checkout on an account whose last capability just went
	// to `pending`.
	const origin = new URL(attempt.request.url).origin;
	const served = await readPublishedConfig(
		deps.db,
		attempt.formId,
		deps.env,
		() => cachedCadences(deps.processors, origin),
		() => cachedRails(deps.processors, origin),
		// the coin list is read for a crypto quote alone, so a slow NOWPayments is no other donor's
		// wait. the method is peeked before the body is parsed, because the parse is handed the config
		// this read builds; `parseQuoteRequest` reads the same field, and the adapter checks a crypto
		// quote's coin against the account whatever the list held.
		async () => (postsCrypto(attempt.body) ? cachedCoins(deps.processors, origin) : [])
	);
	if (!served.ok) {
		return {
			ok: false,
			reason: served.reason,
			message: served.error.message,
			fix: served.error.fix ?? '',
			form: served.form
		};
	}
	const { config, form } = served;

	const parsed = parseQuoteRequest(attempt.body, config);
	if (!parsed.ok) {
		return refuse(form, 'invalid_request', parsed.message, parsed.fix);
	}
	const submission = parsed.value;

	const challenge = await deps.verifyChallenge({
		secretKey: readTurnstileSecret(deps.env),
		siteKey: readTurnstileSiteKey(deps.env),
		token: submission.turnstileToken,
		allowedHostnames: acceptableHostnames(form.allowedOrigins, origin),
		request: attempt.request
	});
	if (!challenge.ok) {
		if (challenge.operatorFix !== null) {
			// the one sentence on this path written for whoever runs the deployment rather than for
			// whoever sent the request. it names a deploy-time variable, so it goes to the log and
			// never into the body — see `TurnstileResult` in ../api/turnstile.ts.
			console.error('a donation was refused by the challenge check:', challenge.operatorFix);
		}
		return challenge.reason === 'rejected'
			? refuse(
					form,
					'challenge_failed',
					challenge.detail,
					'Reset the Turnstile widget and send the token it produces next as `turnstileToken`. ' +
						'A token is valid once and for five minutes.'
				)
			: refuse(
					form,
					'challenge_unavailable',
					challenge.detail,
					'Nothing about the request is wrong and nothing was charged. Try again shortly; if it ' +
						'persists, this deployment’s Turnstile keys need checking.'
				);
	}

	// a donor-advised fund gift has been authorized in the fund's window already, so its figures
	// come from that authorization rather than from the form's amount. after the challenge, like
	// every other mint, and before the fee below, which prices a gift the donor has not yet been
	// charged for.
	if (submission.authorization !== null) {
		return mintGrant(deps, form, config, submission, submission.authorization, attempt, origin);
	}

	// the authoritative numbers, both of them the server's own. the donor's amount is an input that
	// has already been looked up against the form's bounds; nothing they sent is charged.
	const rule = config.feeRules[submission.method];
	const priced = price(submission, rule);
	if (priced === null) {
		return refuse(
			form,
			'internal_error',
			'The processing fee for this gift could not be computed, so nothing was charged.',
			'This is a bug in this app rather than anything about the request or the deployment. The ' +
				'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
				'checkout).'
		);
	}

	// the branch, and everything above it has already run for both kinds of gift. it is here rather
	// than at the top because every check in front of it is shared: put earlier, each of them would
	// need a second copy under the second branch, and a copy is how one of them stops running.
	if (submission.frequency !== 'one_time') {
		return mintCommitment(
			deps,
			form,
			submission,
			submission.frequency,
			config.currency,
			priced,
			attempt
		);
	}

	// minted before the intent, because the intent is told it. `IntentRequest.metadata` carries the
	// donation id so that a settlement event arriving before the write below is readable can still
	// say which gift it was — reading the id back off the write afterwards would be a second round
	// trip, which is a second commit, with the intent already live.
	const donationId = uuidv7();

	// the rail the donor was quoted on selects the adapter, and the same value carries the processor
	// onto the row below: `payment_provider_txn_idx` is keyed on the pair, so the name a row is
	// written under has to be the name of whatever minted the id beside it.
	const provider = deps.processors.forRail(submission.method);

	const intent = await provider.createIntent({
		amountMinor: priced.chargeMinor,
		currency: config.currency,
		method: submission.method,
		// one key per attempt, because one press is one attempt: `CheckoutPorts.quote` in
		// packages/form/src/ports.ts says a donor who backs out of the confirm screen and presses again is
		// minting a second intent on purpose. what the key buys is that a repeat of this exact call
		// resolves to the intent it already made rather than a second one.
		idempotencyKey: donationId,
		deploymentOrigin: origin,
		// checked against the account at this moment by the adapter, never against the served list.
		...(submission.coin === null ? {} : { coin: submission.coin }),
		// the id is the pointer and the other three are what the charge says about itself, so a
		// reconciler reading it in the processor's dashboard is not looking anything up here. the
		// gift is stated rather than the charge because the charge is already the amount above:
		// `chargeMinor` is the grossed-up total, and the donor's own figure is the difference.
		metadata: {
			[DONATION_METADATA_KEY]: donationId,
			[GIFT_MINOR_METADATA_KEY]: String(priced.chargeMinor - priced.feeMinor),
			[FEE_COVERED_METADATA_KEY]: submission.coversFee ? 'true' : 'false',
			[FEE_RAIL_METADATA_KEY]: submission.method
		}
	});
	if (!intent.ok) {
		return paymentRefusal(
			form,
			submission.method,
			submission.frequency,
			intent.reason,
			intent.detail,
			intent.minimumMinor === undefined
				? undefined
				: (leastGiftCharging(intent.minimumMinor, submission.coversFee, rule) ?? undefined)
		);
	}

	const deposit = intent.value.deposit;
	const quote: Quote = {
		paymentToken: intent.value.paymentToken,
		feeMinor: priced.feeMinor,
		totalMinor: priced.chargeMinor,
		...(deposit === undefined ? {} : { deposit: wireDeposit(deposit) })
		// `mandate` is absent, and absent is its correct value. the wording that authorizes a bank
		// debit is the provider's and never ours (packages/form/src/v1.ts), and none arrives at intent
		// creation — the Payment Element renders it in the donor's own browser.
	};

	const written = await recordDonation(deps.db, {
		donationId,
		donor: submission.donor,
		formId: form.id,
		origin: attributedOrigin(attempt.request, form.allowedOrigins),
		currency: config.currency,
		totalMinor: priced.chargeMinor,
		feeMinor: priced.feeMinor,
		lines: [
			{
				label: LINE_LABEL,
				revenueAccountId: form.revenueAccountId,
				amountMinor: priced.chargeMinor
			}
		],
		method: submission.method,
		processor: provider.processor,
		providerTxnId: intent.value.providerTxnId,
		...(deposit === undefined ? {} : { deposit }),
		occurredAt: new Date(),
		consentedToContact: submission.consentedToContact,
		note: submission.note,
		tribute: submission.tribute,
		programId: creditedProgram(form, submission)
	});

	if (!written.ok) {
		// a duplicate is a success, and it is the one refusal from the writer that is. it means the
		// intent this call was handed already had a payment recorded against it, which is only
		// reachable when an earlier call minted that same intent — so the gift exists, written by
		// that call, and the token above is the token for it. `Quote` carries no donation id, so this
		// answer is complete and true. refusing instead would fail a donation that succeeded.
		if (written.reason === 'duplicate_intent') return { ok: true, quote, form };

		return refuse(
			form,
			'internal_error',
			`The gift could not be recorded, so nothing will be charged: ${written.detail}`,
			'This is a bug in this app or a fault in its database rather than anything about the ' +
				'request. The cause is in this deployment’s logs (the Cloudflare dashboard, or ' +
				'`pnpm run logs` from a checkout).'
		);
	}

	if (deposit !== undefined) {
		later(
			deps,
			sendCryptoPending(deps, {
				donationId,
				donorName: submission.donor.displayName,
				donorEmail: submission.donor.primaryEmail,
				...coinAsShown(config, deposit),
				network: deposit.network,
				coinAmount: deposit.coinAmount,
				address: deposit.address,
				memo: deposit.memo,
				validUntil: deposit.validUntil
			})
		);
	}

	return { ok: true, quote, form };
}

/**
 * the coin's name and memo rule off the served list, which is the list the donor picked from.
 *
 * the adapter read the account a moment ago and took the coin, so a coin missing from that list is one
 * enabled after the list was cached: it is named by its code, uppercased, and its memo is treated as
 * required exactly where the payment carries one — a memo present is never one a donor may skip.
 */
function coinAsShown(
	config: FormConfig,
	deposit: DepositInstructions
): { readonly coinName: string; readonly memoRequired: boolean } {
	const listed = config.coins?.find((coin) => coin.coin === deposit.coin);
	return listed === undefined
		? { coinName: deposit.coin.toUpperCase(), memoRequired: deposit.memo !== null }
		: { coinName: listed.name, memoRequired: listed.memoRequired };
}

/**
 * the repeating half: the donor written, the commitment created at the processor, then the gift.
 *
 * it answers the same `Quote` the single branch does, carrying the same kind of token — a donation
 * form confirms a repeating gift with exactly the code that confirms a one-off one, and no second
 * way of confirming exists anywhere in this app (`RecurringGift.paymentToken` in
 * ../payments/provider.ts).
 *
 * both figures are the server's, and the fee is the one the donor was already shown: a repeating
 * gift they chose to cover the fee on collects the grossed-up total every interval, which is the
 * same arithmetic the single branch charges once. `RecurringGiftRequest` states the stake — a wrong
 * amount here is not one charge but every charge.
 *
 * the metadata is one pointer, a cadence and two figures, every one of them this app's own: no name
 * a donor typed is on it, and the map is assembled by `commitmentMetadata` in ../payments/provider.ts
 * rather than here, because what fits the field is that file's argument to make and every rail sends
 * the same four.
 *
 * `donation_id` is the pointer, and the one this branch could not have carried before it wrote a
 * gift. it names the row below, and the first charge that settles claims that row instead of opening
 * a second one for money the donor is already recorded as giving — so the donor, the fund, the
 * dedication, the note and the attributed origin all reach the opening charge and every later one
 * through that row, without any of them being exported to the processor. ./collect.ts refuses a
 * collection whose commitment names no gift, and treats a blank pointer as absent.
 *
 * the split is `gift_minor` and `fee_covered`, carried for the same reason the single branch writes
 * them onto its intent and spent for one more: a collection reads what moved and nothing else, so
 * without them `donation.fee_minor` is zero on every charge under a commitment the donor chose to
 * cover the fee on — the fee is collected every interval and stated on no receipt. `coveredFeeOf` in
 * ./collect.ts is what reads them back.
 *
 * the write runs last, exactly as it does on the single branch and for the same reason: the
 * commitment exists at the processor by then, and a gift recorded against a commitment that was
 * never created is a row nothing can ever collect against.
 */
async function mintCommitment(
	deps: QuoteDeps,
	form: FormRecord,
	submission: ParsedQuoteRequest,
	interval: RecurringInterval,
	currency: string,
	priced: { readonly chargeMinor: number; readonly feeMinor: number },
	attempt: QuoteAttempt
): Promise<QuoteResult> {
	const donor = await commitDonor(deps.db, submission.donor, submission.consentedToContact);
	if (!donor.ok) {
		return refuse(
			form,
			'internal_error',
			`The gift could not be set up, so nothing will be charged: ${donor.detail}`,
			'This is a bug in this app or a fault in its database rather than anything about the ' +
				'request. The cause is in this deployment’s logs (the Cloudflare dashboard, or ' +
				'`pnpm run logs` from a checkout).'
		);
	}

	// minted before the commitment, because the commitment is told it — the same order and the same
	// reason the single branch mints its donation id before `createIntent`. it is spent twice: as the
	// pointer the first collection claims this gift by, and as the key that makes a repeat of this
	// exact call resolve to the commitment it already made rather than a second one. one press is one
	// attempt (`CheckoutPorts.quote` in packages/form/src/ports.ts), so a donor who backs out of the
	// confirm screen and presses again mints a second gift and a second commitment on purpose — a key
	// derived from the donor instead would hand them back the one they already had.
	const donationId = uuidv7();

	const gift = await deps.processors.forRail(submission.method).createRecurringGift({
		amountMinor: priced.chargeMinor,
		currency,
		interval,
		// the rail the fee above was priced for, carried the same way the single branch carries it.
		// it is the server's decision rather than the processor's: left off the request, what the
		// commitment may be collected on is whatever an operator's dashboard has switched on
		// (`RecurringGiftRequest.method` in ../payments/provider.ts), and this branch charges that
		// choice again every interval rather than once.
		method: submission.method,
		idempotencyKey: donationId,
		metadata: commitmentMetadata({
			donationId,
			interval,
			// the gift stated rather than the charge, exactly as the single branch states it: the
			// charge is `amountMinor` above, and the donor's own figure is the difference.
			giftMinor: priced.chargeMinor - priced.feeMinor,
			coversFee: submission.coversFee
		})
	});
	if (!gift.ok) {
		return paymentRefusal(form, submission.method, interval, gift.reason, gift.detail);
	}

	const written = await recordAuthorizedGift(deps.db, {
		donationId,
		contactId: donor.value.contactId,
		formId: form.id,
		origin: attributedOrigin(attempt.request, form.allowedOrigins),
		currency,
		totalMinor: priced.chargeMinor,
		feeMinor: priced.feeMinor,
		lines: [
			{
				label: LINE_LABEL,
				revenueAccountId: form.revenueAccountId,
				amountMinor: priced.chargeMinor
			}
		],
		note: submission.note,
		tribute: submission.tribute,
		programId: creditedProgram(form, submission),
		occurredAt: new Date()
	});
	if (!written.ok) {
		// no duplicate arm, unlike the single branch: this write opens no `payment` row, so there is
		// no transaction id for a second call to collide on and every refusal here is a fault. the
		// commitment is live and nothing has been collected under it — the processor abandons an
		// unconfirmed one within 23 hours (../payments/stripe.ts), so refusing the donor leaves
		// nothing to clean up.
		return refuse(
			form,
			'internal_error',
			`The gift could not be recorded, so nothing will be charged: ${written.detail}`,
			'This is a bug in this app or a fault in its database rather than anything about the ' +
				'request. The cause is in this deployment’s logs (the Cloudflare dashboard, or ' +
				'`pnpm run logs` from a checkout).'
		);
	}

	return {
		ok: true,
		quote: {
			paymentToken: gift.value.paymentToken,
			feeMinor: priced.feeMinor,
			totalMinor: priced.chargeMinor
			// `mandate` is absent for the reason the single branch states it: the wording that
			// authorizes a bank debit is the provider's and arrives in the donor's own browser.
		},
		form
	};
}

/**
 * the donor-advised fund half: the authorized total split and checked, the grant created from the
 * donor's session, then the gift written against it.
 *
 * the figures are the fund window's rather than the form's. the donor may change the amount there,
 * and what the fund grants is what the gift is recorded as: with the fee covered the fee is
 * Chariot's rate on that total and the gift is the rest, and the form's bounds hold the gift
 * portion rather than the total. a gift portion outside them creates no grant.
 *
 * the grant is created before the write, as the single branch mints before it writes, and for more
 * than its reason: a `payment` row attributed to a processor carries that processor's id
 * (`payment_processor_needs_txn_id_check` in ../db/schema.ts), so the gift and its payment are one
 * `batch()` once the grant id exists. Create Grant answers the grant it already holds for a session,
 * so a second submission of the same session is `duplicate_intent` below and answers that grant.
 *
 * a write that fails against a created grant is told to an operator with the grant id, and a Create
 * Grant whose outcome is unknown with the session id. the grant is a pledge the fund will pay, and
 * the settlement path answers a grant no row names quietly (./settle.ts), so this is the one place
 * its loss is visible.
 */
async function mintGrant(
	deps: QuoteDeps,
	form: FormRecord,
	config: FormConfig,
	submission: ParsedQuoteRequest,
	authorization: DafAuthorization,
	attempt: QuoteAttempt,
	origin: string
): Promise<QuoteResult> {
	if (config.currency !== 'USD') {
		return refuse(
			form,
			'invalid_request',
			`A donor-advised fund gift is granted in USD, and this form is priced in ${config.currency}.`,
			'Offer the donor-advised fund option on a form priced in USD.'
		);
	}

	const total = authorization.authorizedMinor;
	const split = splitGrant(total, submission.coversFee, config.feeRules.daf);
	const gift = split === null ? 0 : total - split.feeMinor;
	if (split === null || gift < config.minAmountMinor || gift > config.maxAmountMinor) {
		const range = `$${majorText(config.minAmountMinor, 'USD')} to $${majorText(config.maxAmountMinor, 'USD')}`;
		return refuse(
			form,
			'invalid_request',
			`The fund approved $${majorText(total, 'USD')}, which leaves a gift of ` +
				`$${majorText(gift, 'USD')}, outside this form’s range of ${range}. No grant was created.`,
			`Give again through the fund’s window with an amount whose gift is between ${range}.`
		);
	}

	const donationId = uuidv7();
	const provider = deps.processors.forRail('daf');
	const created = await provider.createIntent({
		amountMinor: total,
		currency: config.currency,
		method: 'daf',
		idempotencyKey: donationId,
		deploymentOrigin: origin,
		authorizedSessionId: authorization.id
	});
	if (!created.ok) {
		// no answer settled whether Chariot created the grant. a donor who tries again records it,
		// since the same session answers the grant it holds; one who leaves does not, and the
		// settlement path answers a grant no row names quietly (./settle.ts).
		if (created.reason === 'unreachable') {
			later(
				deps,
				alert(deps, {
					headline:
						'A donor-advised fund grant may have been created with no gift recorded against it',
					body:
						'Chariot did not say whether it created the grant, so the donor was asked to try again. ' +
						'If they did, the gift is recorded and nothing more is needed. If not, the grant may ' +
						'exist in Chariot, and when the fund pays it this deployment will not know which gift ' +
						'it is.',
					facts: [
						{ label: 'Session', value: authorization.id },
						{ label: 'Amount', value: `$${majorText(total, 'USD')}` },
						{ label: 'Reason', value: created.detail }
					],
					action:
						'Look for a grant on this session in the Chariot dashboard. If one is there and no gift ' +
						'for it is in the dashboard here, record the gift by hand.'
				})
			);
		}
		return grantRefusal(form, created.reason, created.detail);
	}

	const quote: Quote = {
		paymentToken: created.value.paymentToken,
		feeMinor: split.feeMinor,
		totalMinor: total
	};

	const written = await recordDonation(deps.db, {
		donationId,
		donor: submission.donor,
		formId: form.id,
		origin: attributedOrigin(attempt.request, form.allowedOrigins),
		currency: config.currency,
		totalMinor: total,
		feeMinor: split.feeMinor,
		lines: [{ label: LINE_LABEL, revenueAccountId: form.revenueAccountId, amountMinor: total }],
		method: 'daf',
		processor: provider.processor,
		providerTxnId: created.value.providerTxnId,
		occurredAt: new Date(),
		consentedToContact: submission.consentedToContact,
		note: submission.note,
		tribute: submission.tribute,
		programId: creditedProgram(form, submission)
	});
	if (written.ok) {
		later(
			deps,
			sendGrantRequested(deps, {
				donationId,
				donorName: submission.donor.displayName,
				donorEmail: submission.donor.primaryEmail,
				// the gift portion the form's bounds held, never the total with a covered fee in it.
				amountMinor: gift,
				currency: config.currency,
				tribute: submission.tribute
			})
		);
		return { ok: true, quote, form };
	}
	// the session's grant already has its gift, and its donor was told when that gift was written.
	// the answer is that gift's figures: a resend may carry another split of the same total.
	if (written.reason === 'duplicate_intent') {
		const recorded = await recordedQuote(deps.db, provider.processor, created.value);
		if (recorded !== null) return { ok: true, quote: recorded, form };
		return refuse(
			form,
			'internal_error',
			'The gift for this grant is recorded and could not be read back.',
			'This is a fault in this deployment rather than anything about the request. The cause is in ' +
				'this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout).'
		);
	}

	later(
		deps,
		alert(deps, {
			headline: 'A donor-advised fund grant was created with no gift recorded against it',
			body:
				'Chariot created the grant and the gift could not be written here, so the donor was told ' +
				'it did not go through. The fund will still pay the grant, and nothing in this deployment ' +
				'will record it when it does.',
			facts: [
				{ label: 'Grant', value: created.value.providerTxnId },
				{ label: 'Amount', value: `$${majorText(total, 'USD')}` },
				{ label: 'Reason', value: written.detail }
			],
			action: 'Find the grant in the Chariot dashboard and record the gift by hand.'
		})
	);
	return refuse(
		form,
		'internal_error',
		`The gift could not be recorded: ${written.detail}`,
		'This is a fault in this deployment rather than anything about the request, and an operator ' +
			'has been told. The cause is in this deployment’s logs (the Cloudflare dashboard, or ' +
			'`pnpm run logs` from a checkout).'
	);
}

/** where and how much to send, as `Deposit` in packages/form/src/v1.ts carries it. */
function wireDeposit(deposit: DepositInstructions): Deposit {
	return {
		address: deposit.address,
		memo: deposit.memo,
		coin: deposit.coin,
		network: deposit.network,
		coinAmount: deposit.coinAmount,
		...(deposit.giftCoinAmount === undefined ? {} : { giftCoinAmount: deposit.giftCoinAmount }),
		validUntil: deposit.validUntil.toISOString(),
		qr: depositQr(deposit.address)
	};
}

/** the figures of the gift already recorded against this intent, or `null` where none reads back. */
async function recordedQuote(
	db: Db,
	processor: ProcessorName,
	intent: Intent
): Promise<Quote | null> {
	try {
		const [row] = await db
			.select({ totalMinor: donation.totalMinor, feeMinor: donation.feeMinor })
			.from(payment)
			.innerJoin(donation, eq(payment.donationId, donation.id))
			.where(and(eq(payment.provider, processor), eq(payment.providerTxnId, intent.providerTxnId)))
			.limit(1);
		return row === undefined
			? null
			: { paymentToken: intent.paymentToken, totalMinor: row.totalMinor, feeMinor: row.feeMinor };
	} catch (error) {
		console.error('a recorded gift could not be read back:', error);
		return null;
	}
}

/**
 * an authorized grant total as the gift and the fee in it, or `null` where the fee would be the whole
 * of it.
 *
 * covered, the fee is `estimateDeductedFee` on the total — Chariot's rate rounded up to a whole
 * dollar — which is the inverse of the gross-up the form showed: a total `estimateFee` produced for
 * a gift splits back into that gift and that fee exactly, and a total the donor changed splits at the
 * same rate. not covered, the whole total is the gift and the fee recorded is zero, as `price` below
 * records it.
 */
function splitGrant(
	totalMinor: number,
	coversFee: boolean,
	rule: Parameters<typeof estimateDeductedFee>[1]
): { readonly feeMinor: number } | null {
	if (!coversFee) return { feeMinor: 0 };
	const deducted = estimateDeductedFee(totalMinor, rule);
	return deducted === null ? null : { feeMinor: deducted.feeMinor };
}

/**
 * a Create Grant failure as one of this path's own.
 *
 * the three a donor acts on are the fund's: an approval past its window (`authorization_expired`,
 * from Chariot's 410), an approval Chariot holds nothing for (`not_found`, its 404 — a body naming
 * the wrong session, so `invalid_request` and never a claim that it expired), and an amount the fund
 * will not grant (`invalid_request`, carrying Chariot's reason — the adapter's own local refusals
 * cannot reach it, because the parser and the checks above refuse those figures first). a call whose
 * outcome is unknown (`unreachable`) is retryable, and never says nothing was given. everything else
 * is what any single gift's processor failure answers.
 */
function grantRefusal(form: FormRecord, reason: string, detail: string): QuoteResult {
	if (reason === 'authorization_expired') {
		return refuse(
			form,
			'daf_authorization_expired',
			'The approval in the fund’s window expired before the grant could be created, so nothing ' +
				'was given.',
			'Open the fund’s window again and approve the gift; an approval is good for 15 minutes.'
		);
	}
	if (reason === 'not_found') {
		return refuse(
			form,
			'invalid_request',
			'The fund’s approval for this gift couldn’t be found, so nothing was given.',
			'Approve the gift again in the fund’s window.'
		);
	}
	if (reason === 'unreachable') {
		return refuse(
			form,
			'payments_unavailable',
			detail,
			'Your fund may already have the grant request. Try again in a moment — the same approval ' +
				'sends it at most once.'
		);
	}
	if (reason === 'invalid_request') {
		const said = fundsReason(detail);
		return refuse(
			form,
			'daf_grant_declined',
			said === null
				? 'Your fund didn’t approve this gift, so nothing was given.'
				: `Your fund didn’t approve this gift: ${said}`,
			'Give an amount the fund allows — at least its minimum and no more than the balance ' +
				'available — through the fund’s window.'
		);
	}
	return paymentRefusal(form, 'daf', 'one_time', reason, detail);
}

/**
 * the fund's own words out of the adapter's sentence, which names the processor and is written for
 * the deployment's log. `classifyStatus` in ../payments/chariot.ts ends every failure it sorts with
 * this marker and the quoted problem body.
 */
function fundsReason(detail: string): string | null {
	const marker = 'Chariot said: ';
	const at = detail.lastIndexOf(marker);
	return at === -1 ? null : detail.slice(at + marker.length);
}

/**
 * the cause a gift is credited to, decided from the form record and the body together.
 *
 * the two halves are asymmetric on purpose, and it is the asymmetry `Program` in
 * packages/form/src/v1.ts states from the wire's side. a `pinned` form serves the cause's name and
 * no id, so the pin is written from the row and a body carrying one is refused by
 * `parseQuoteRequest` in ./quote-input.ts before this runs — reading the body here would let a
 * client overwrite a decision it was only told about. a `choice` form serves the ids because the
 * donor picks, so the pick is what is written, already checked against the list this request was
 * served.
 *
 * null on every other shape, which is a gift credited to no cause — the same thing an absent pick
 * means, and what every staff-entered gift says (`donation.program_id` in ../db/schema.ts).
 *
 * it reads `form.programMode` rather than `config.program`, and the two cannot disagree: the config
 * is built from this row a few lines above. the row is the narrower reading — a `choice` whose
 * options are all retired is served as no program at all, and a donor who sent nothing is written
 * null either way.
 */
function creditedProgram(form: FormRecord, submission: ParsedQuoteRequest): string | null {
	if (form.programMode === 'pinned') return form.programId;
	if (form.programMode === 'choice') return submission.programId ?? null;
	return null;
}

/**
 * what the donor is charged and what of it is fee, in minor units. `null` when the arithmetic will
 * not produce a figure this app is willing to state.
 *
 * two shapes, decided by whether the donor is covering the fee:
 *
 *   covering     — the charge is grossed up so the organisation nets the gift the donor chose, and
 *                  the fee is the difference. `estimateFee` in packages/form/src/fee.ts does that in fixed
 *                  point, and it is reused rather than re-derived: the element showed the donor a
 *                  number from that same function, and a second implementation here is how the
 *                  confirm screen and the charge end up a minor unit apart.
 *   not covering — the charge is the gift, and the fee recorded is zero. that is not a claim the
 *                  processor takes nothing; it is that the donor agreed to no fee, which is what
 *                  `donation.fee_minor` holds (see `Settlement.feeMinor` in ../payments/provider.ts
 *                  for the figure that does reconcile against a statement, read at settlement).
 */
function price(
	submission: { readonly amountMinor: number; readonly coversFee: boolean },
	rule: Parameters<typeof estimateFee>[1]
): { readonly chargeMinor: number; readonly feeMinor: number } | null {
	if (!submission.coversFee) return { chargeMinor: submission.amountMinor, feeMinor: 0 };
	const estimate = estimateFee(submission.amountMinor, rule);
	if (estimate === null) return null;
	return { chargeMinor: estimate.totalMinor, feeMinor: estimate.feeMinor };
}

/**
 * the least gift `price` charges at least `chargeMinor` for — `price` run backwards, so a floor the
 * processor states on the charge is named in the donor's own terms. with the fee covered that is a
 * gift below the floor by about the fee; uncovered it is the floor itself. searched rather than
 * solved, because `estimateFee` rounds and caps and any closed-form inverse is a second copy of both;
 * its charge never falls as the gift grows, which is what the search leans on. `null` where no gift up
 * to the floor prices at all.
 */
function leastGiftCharging(
	chargeMinor: number,
	coversFee: boolean,
	rule: Parameters<typeof estimateFee>[1]
): number | null {
	const reaches = (gift: number) =>
		(price({ amountMinor: gift, coversFee }, rule)?.chargeMinor ?? -1) >= chargeMinor;
	if (!reaches(chargeMinor)) return null;
	let below = 0;
	let least = chargeMinor;
	while (least - below > 1) {
		const middle = Math.floor((below + least) / 2);
		if (reaches(middle)) least = middle;
		else below = middle;
	}
	return least;
}

/**
 * the bare hostnames a challenge for this form may have been solved on: the sites it is allowed to
 * be embedded on, and this deployment's own host.
 *
 * this deployment's own host is accepted on every form and is not something an operator ticks —
 * every form served here loads on this deployment's own donation page, which is on no `site` row.
 * it comes off the request rather than off anything stored: the host a request arrived on is one
 * this worker answers on. so a form ticked onto no site at all still has an acceptable host and can
 * be given to, which is what lets an organisation with no website of its own finish setting up and
 * take a gift, and the list is never empty.
 */
function acceptableHostnames(allowedOrigins: readonly string[], ownOrigin: string): string[] {
	return hostnamesOf([...allowedOrigins, ownOrigin]);
}

/**
 * the bare hostnames a list of whole origins names.
 *
 * the origins a form is allowed to be embedded on are stored whole — `https://example.org`, scheme
 * and all — while Cloudflare reports a bare host. an entry that is not a URL contributes nothing
 * rather than being passed through: the literal `null` an opaque origin sends is the case that
 * actually occurs, and no hostname Cloudflare reports can equal it.
 */
function hostnamesOf(origins: readonly string[]): string[] {
	const hostnames: string[] = [];
	for (const origin of origins) {
		try {
			hostnames.push(new URL(origin).hostname);
		} catch {
			// not a URL, so it names no host. see above.
		}
	}
	return hostnames;
}

/**
 * the `Origin` header, kept only where the form names it.
 *
 * `donation.origin` is documented as the validated header captured server-side, and this is the
 * validation: one form is embedded on several sites, so this rather than `form_id` is the
 * attribution key — and an unchecked header would make that column whatever a caller typed.
 * `Origin` is an attribution signal and never an authorization control (CLAUDE.md), which is
 * exactly what storing it and not gating on it means.
 */
function attributedOrigin(request: Request, allowedOrigins: readonly string[]): string | null {
	const origin = request.headers.get('origin');
	return origin !== null && allowedOrigins.includes(origin) ? origin : null;
}

/** whether an unparsed body names the crypto rail. */
function postsCrypto(body: unknown): boolean {
	return (
		typeof body === 'object' && body !== null && (body as { method?: unknown }).method === 'crypto'
	);
}

/** `TURNSTILE_SECRET_KEY` off the platform env, without narrowing anything else out of it. */
function readTurnstileSecret(env: unknown): string | undefined {
	if (typeof env !== 'object' || env === null) return undefined;
	const value = (env as Record<string, unknown>).TURNSTILE_SECRET_KEY;
	return typeof value === 'string' ? value : undefined;
}

/**
 * `TURNSTILE_SITE_KEY` off the same env, read for the same reason and never sent anywhere.
 *
 * the public half of the pair, and it is handed to the check so that a deployment which serves no
 * widget is told so as `challenge_unavailable` rather than telling a donor their token failed —
 * see `TurnstileCheck.siteKey` in ../api/turnstile.ts. it is the same value
 * ../forms/published-config.ts copies into the served config.
 */
function readTurnstileSiteKey(env: unknown): string | undefined {
	if (typeof env !== 'object' || env === null) return undefined;
	const value = (env as Record<string, unknown>).TURNSTILE_SITE_KEY;
	return typeof value === 'string' ? value : undefined;
}

/**
 * a `PaymentFailureReason` as one of this path's own.
 *
 * three of them are the processor being unable to answer well, and they are the ones a donor
 * acts on by trying again. `not_configured` is a deployment with keys unset, which is the same
 * finding the config ladder already reports under its own code. the rest — a malformed call, a
 * signature, an adapter that threw — are ours, and a donation form has no screen to render about
 * our defect. `fee_not_ready` is on that list without belonging to it: nothing minting an intent
 * can produce it, since it is a settled charge's fee still being computed and this path settles
 * nothing.
 *
 * the three crypto reasons are the donor's choice of coin or amount, carried under their own codes
 * with the adapter's sentence, which names the figure.
 *
 * `frequency` is what splits the two remaining ones, and it is why this takes the cadence at all.
 * on a single gift `unsupported` and `not_found` are ours — an arm no release builds, or an object
 * `createIntent`'s own parameters named. on a commitment they are the account no longer holding
 * what a repeating gift is charged against, which is the donor's cached page rather than a bug.
 */
function paymentRefusal(
	form: FormRecord,
	rail: QuotedRail,
	frequency: Frequency,
	reason: string,
	detail: string,
	minAmountMinor?: number
): QuoteResult {
	if (reason === 'rate_limited' || reason === 'unreachable' || reason === 'provider_error') {
		return refuse(
			form,
			'payments_unavailable',
			detail,
			'Nothing was charged. Try again in a moment — this is the payment processor rather than ' +
				'anything about the request.'
		);
	}
	if (reason === 'not_configured') {
		return refuse(
			form,
			'payments_not_configured',
			detail,
			// the processor that settles the rail the donor picked, and never the one this deployment
			// happens to hold: a donor on a cached page may name a rail whose processor was cleared
			// since, and the pair that is set is not the pair to go and re-check.
			processorSetupFix([processorOf(rail)])
		);
	}
	if (reason === 'coin_not_accepted' || reason === 'below_minimum' || reason === 'above_maximum') {
		const refused = refuse(form, reason, detail, CRYPTO_CHOICE_FIX[reason]);
		return minAmountMinor === undefined ? refused : { ...refused, minAmountMinor };
	}
	if (frequency !== 'one_time' && (reason === 'unsupported' || reason === 'not_found')) {
		return refuse(
			form,
			'frequency_unsupported',
			`A gift that repeats cannot be collected on ${PROCESSOR_LABELS[processorOf(rail)]} here, ` +
				`and nothing was charged: ${detail}`,
			// written for the donor reading it, who has no account to set up and no deployment to
			// fix. a single gift needs nothing on the processor's account, so it is the one thing
			// this deployment can always still take.
			'Nothing was charged and nothing about the request is wrong. Give once instead.'
		);
	}
	return refuse(
		form,
		'internal_error',
		`No payment could be started, and nothing was charged: ${detail}`,
		'This is a bug in this app rather than anything about the request or the deployment. The ' +
			'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
			'checkout).'
	);
}

/**
 * what a donor does about a crypto refusal. the adapter's `detail` is the message and names the coin
 * and the figure; these say which of the two choices to move, and where the other coins are listed.
 */
const CRYPTO_CHOICE_FIX = {
	coin_not_accepted:
		'Nothing was charged. Pick another coin from `coins` on this form’s config ' +
		'(`GET /api/v1/forms/:id/config`), which lists what the organisation’s account takes.',
	below_minimum:
		'Nothing was charged. Give at least the minimum named, or pick another coin from `coins` on ' +
		'this form’s config (`GET /api/v1/forms/:id/config`).',
	above_maximum:
		'Nothing was charged. Give a smaller amount, or pick another coin from `coins` on this form’s ' +
		'config (`GET /api/v1/forms/:id/config`).'
} as const;

/** hands a send to `deps.defer`, logging a throw there is nobody left to answer. */
function later(deps: QuoteDeps, task: Promise<void>): void {
	deps.defer(
		task.catch((error: unknown) => {
			console.error('a message after a donation could not be sent:', error);
		})
	);
}

function refuse(
	form: FormRecord | null,
	reason: QuoteRefusal,
	message: string,
	fix: string
): Extract<QuoteResult, { ok: false }> {
	return { ok: false, reason, message, fix, form };
}
