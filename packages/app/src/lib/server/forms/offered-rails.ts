import type { PaymentMethod } from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import type { RailChargeability } from '../payments/rail-chargeability';

// which of the rails this deployment lists a donor is actually shown, which is a fact about the
// processor's account and about no form.
//
// the deployment's own list is the ceiling and never the answer. `OFFERED_PAYMENT_METHODS` in
// ../../forms/offered-rails.ts says which rails this repository has a donation form for at all, and
// what narrows it here is whether the account can charge each one. so a rail joins that list before
// it can ever be offered, and being on it is not enough.
//
// the wallets are narrowed the same way every other rail is, and there is one thing that answer
// does not cover: a wallet also needs the site the form is embedded on registered against the
// account, per host, which no capability read here reports. the console keeps that registration
// levelled (`packages/app/src/lib/server/payments/wallet-domains.ts`), off the sites list and the
// Stripe keys run alike — but an unregistered host still draws no wallet rather than refusing one,
// so nothing downstream of this ever sees the gap.
//
// why this exists at all: ../payments/rail-chargeability.ts's header states that the processor
// enforces none of the operator's switches on a charge this app mints, because an intent and a
// commitment both name the one rail the donor was quoted on — so every path that puts a rail in
// front of a donor has to consult that module, and the failure when one does not is silent in both
// directions. serving the constant unconditionally is that failure: a form offering Bank on an
// account never approved for it, with the refusal arriving at the last step on a page nobody here
// can see.
//
// it lives under `$lib/server/**` rather than beside the constant because the answer comes off the
// payment port, which is server-only — the same reason ./offered-cadences.ts is here, and its header
// is the reasoning this extends. ./rail-cache.ts is the one place an answer is kept, at the edge
// with a TTL; its header states why that is not the balance CLAUDE.md bans caching.

/**
 * which rails a donor is shown, given what the account answered.
 *
 * a read that could not be made offers the deployment's list whole, and that is the opposite
 * direction from `offeredCadences` in ./offered-cadences.ts on purpose. narrowing a cadence leaves a
 * working form that shows one-time; narrowing every rail leaves no form at all — `readFormConfig` in
 * packages/form/src/config.ts drops a config offering no rail, so a processor blip answered narrowly would
 * take the donation form off every site it is embedded on. widened, the cost is the failure at the
 * last step this module exists to avoid, for the minutes a blip lasts and no longer, because
 * ./rail-cache.ts never stores an answer it could not read.
 *
 * the list is filtered rather than rebuilt, so the order a donor is shown the rails is the order
 * that constant states.
 */
export function offeredRails(chargeability: RailChargeability): readonly PaymentMethod[] {
	if (chargeability.state === 'unreadable') return OFFERED_PAYMENT_METHODS;
	// `approved` and nothing else. every other standing is a rail this deployment cannot charge
	// today, and the seven of them differ in what an operator does about it rather than in whether a
	// donor may pick it — which is what the console reads them for.
	return OFFERED_PAYMENT_METHODS.filter((rail) => chargeability.rails[rail] === 'approved');
}
