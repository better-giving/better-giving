import { uuidv7 } from 'uuidv7';
import { estimateFee } from '@better-giving/form/fee';
import type { ApiErrorCode, Quote } from '@better-giving/form/v1';
import type { TurnstileCheck, TurnstileResult } from '../api/turnstile';
import type { Db } from '../db/client';
import type { FormRecord } from '../forms/form-input';
import { cachedCadences } from '../forms/cadence-cache';
import { readPublishedConfig } from '../forms/published-config';
import { cachedRails } from '../forms/rail-cache';
import { processorSetupFix, type Processors } from '../payments/factory';
import {
	CONTACT_METADATA_KEY,
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	FEE_RAIL_METADATA_KEY,
	FORM_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	processorOf,
	type QuotedRail,
	type RecurringInterval
} from '../payments/provider';
import { commitDonor } from './donor';
import { parseQuoteRequest, type ParsedQuoteRequest } from './quote-input';
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
// donor first, and the reason is `CONTACT_METADATA_KEY` (../payments/provider.ts): a commitment
// carries that id to the processor and every charge it ever collects is attributed by it, so a
// commitment created before the row it names is money collecting against a donor the webhook can
// never find. a single gift's intent needs no such row in front of it.
//
// what neither branch writes is the ledger and the `recurring_plan` row. no money has moved, so
// nothing is in the books (./record.ts), and a commitment exists from its first charge that settles
// (./collect.ts) — which is also the charge that claims the gift written here.
// ---------------------------------------------------------------------------

/**
 * why a quote was not minted, as a closed set.
 *
 * six of the twelve are `readPublishedConfig`'s own, carried through under their own names so that
 * a caller answering both endpoints answers them the same way. the other six are this path's.
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
	 * a repeating gift this path could not carry out — and nothing here produces it.
	 *
	 * it is kept, and keeping it is the rule rather than an oversight. this array is the wire
	 * vocabulary of a refusal, `v1` is add-never-rename (packages/form/src/v1.ts), and a member removed from
	 * a vocabulary is a breaking change where a member with no producer is nothing at all. an
	 * integrator holding a `switch` over these keeps a branch that no longer runs; delete it and they
	 * hold a `switch` that no longer compiles.
	 *
	 * what would produce it is a path that mints a single payment through `createIntent` with no way
	 * to collect a second time, while the form offers whatever cadences this deployment's processor
	 * account can collect (`offeredCadences` in ../forms/offered-cadences.ts) — a donor picking
	 * monthly and being refused. `mintQuote` creates a commitment through `createRecurringGift`
	 * instead, and a cadence the account cannot collect is never offered in the first place, so
	 * there is nothing left for this to refuse.
	 *
	 * the endpoint still answers it 503 (src/routes/api.v1.forms.$id.donations.ts). that
	 * mapping is what makes the member re-usable rather than merely tolerated: a deployment that one
	 * day cannot honour a cadence it offered has a code already minted and already answered.
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
	'payments_unavailable'
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
	// for. the request's own origin is spent as a cache key and nothing else: an entry in
	// `caches.default` belongs to the zone that asked for it. see ../forms/cadence-cache.ts and
	// ../forms/rail-cache.ts.
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
		() => cachedRails(deps.processors, origin)
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

	// the authoritative numbers, both of them the server's own. the donor's amount is an input that
	// has already been looked up against the form's bounds; nothing they sent is charged.
	const priced = price(submission, config.feeRules[submission.method]);
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
		return paymentRefusal(form, submission.method, intent.reason, intent.detail);
	}

	const quote: Quote = {
		paymentToken: intent.value.paymentToken,
		feeMinor: priced.feeMinor,
		totalMinor: priced.chargeMinor
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

	return { ok: true, quote, form };
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
 * the metadata is four pointers and two figures, every one of them this app's own: no name a donor
 * typed is on it. a repeat charge carries none of its own, so this is the whole of what ties charge
 * fifty back to the donor, the fund and the cadence it belongs to; ./collect.ts refuses a
 * collection it cannot read the donor and the form from, and treats a blank one as absent.
 *
 * the split is `gift_minor` and `fee_covered`, written here for the same reason the single branch
 * writes them onto its intent and spent for one more: a collection reads what moved and nothing
 * else, so without them `donation.fee_minor` is zero on every charge under a commitment the donor
 * chose to cover the fee on — the fee is collected every interval and stated on no receipt.
 * `coveredFeeOf` in ./collect.ts is what reads them back.
 *
 * `donation_id` is the fourth pointer and the one this branch could not have carried before it
 * wrote a gift. it names the row below, and the first charge that settles claims that row instead
 * of opening a second one for money the donor is already recorded as giving — so the dedication,
 * the note and the attributed origin all reach the opening charge without any of them being
 * exported to the processor.
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
		metadata: {
			[CONTACT_METADATA_KEY]: donor.value.contactId,
			[FORM_METADATA_KEY]: form.id,
			[INTERVAL_METADATA_KEY]: interval,
			[DONATION_METADATA_KEY]: donationId,
			// the gift stated rather than the charge, exactly as the single branch states it: the
			// charge is `amountMinor` above, and the donor's own figure is the difference.
			[GIFT_MINOR_METADATA_KEY]: String(priced.chargeMinor - priced.feeMinor),
			[FEE_COVERED_METADATA_KEY]: submission.coversFee ? 'true' : 'false'
		}
	});
	if (!gift.ok) return paymentRefusal(form, submission.method, gift.reason, gift.detail);

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
 * three of the nine are the processor being unable to answer well, and they are the ones a donor
 * acts on by trying again. `not_configured` is a deployment with keys unset, which is the same
 * finding the config ladder already reports under its own code. the rest — a malformed call, a
 * signature, an object that is not there, an adapter that threw — are ours, and a donation form has
 * no screen to render about our defect. `fee_not_ready` is on that list without belonging to it:
 * nothing minting an intent can produce it, since it is a settled charge's fee still being computed
 * and this path settles nothing.
 */
function paymentRefusal(
	form: FormRecord,
	rail: QuotedRail,
	reason: string,
	detail: string
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
	return refuse(
		form,
		'internal_error',
		`No payment could be started, and nothing was charged: ${detail}`,
		'This is a bug in this app rather than anything about the request or the deployment. The ' +
			'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
			'checkout).'
	);
}

function refuse(
	form: FormRecord | null,
	reason: QuoteRefusal,
	message: string,
	fix: string
): QuoteResult {
	return { ok: false, reason, message, fix, form };
}
