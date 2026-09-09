import { PAYMENT_METHODS, type PaymentMethod } from '@better-giving/form/v1';
import type {
	AccountChargeability,
	RailCapabilityState,
	PaymentProvider,
	RailSwitchboard
} from './provider';

// which of this deployment's own rails it can actually charge, and why not where it cannot.
//
// **approved is not working, and no vocabulary here may be read as saying otherwise.** every fact
// this module reports is a *necessary* condition and none of them is sufficient. a rail reported
// `approved` still refuses a real donation over the currency it is charged in, the amount — every
// currency has a minimum and a maximum charge
// (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts) — and where the donor's
// bank is: a US bank debit is USD-only and wants a US bank account
// (https://docs.stripe.com/payments/ach-direct-debit). so a screen built on this may say "this
// account is approved for bank debits" and may never say "bank debits will work". the standings
// below are named for approval rather than for outcome so that the second sentence has no word to
// be written in.
//
// two independent sources, and that is the shape rather than a detail. one is the processor's own
// approval of the account, which arrives through `readAccountChargeability` on ./provider.ts.
// another is what the operator has switched on where the processor keeps that setting, which arrives
// through `readRailSwitchboard` beside it — approval and intent are different facts, and a rail can
// be missing for either. this deployment's own form is not a third: the wallets are drawn inside the
// provider's own box by the `wallets` hash in packages/form/src/embed/stripe.ts and confirmed on
// the card intent they settle as (`RAILS` in packages/form/src/embed/rails.ts), so there is no
// state a wallet can be in here that the processor's two answers do not already carry.
//
// **this app honours the operator's switches itself, and the processor does not enforce them on its
// charges.** an intent minted here names the one rail the donor was quoted on, because the fee that
// produced their total was priced for that rail (`IntentRequest.method` on ./provider.ts, and
// `INTENT_METHODS` in ./stripe.ts). naming a rail that way opts the charge out of the processor's
// own dashboard-driven selection, which is the integration shape that sends no method at all
// (https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods) — so an operator's
// switches are readable on this path and applied by nothing on it. this module is what makes them
// mean anything: a rail reaches `approved` only where its switch is on, and every path that mints an
// intent has to be gated on that. the failure mode is silent in both directions — a path that mints
// one without consulting this breaks no test and logs nothing, while the switch an operator turned
// off quietly stops meaning anything to a donor.
//
// it imports no SDK and names no processor. ./provider.ts is the whole of what it knows, which is
// the rule ./sole-importer.spec.ts holds over the tree. nothing here writes anything down either:
// the approvals live on somebody else's account, so a copy in a row would be a claim about a third
// party's state that nothing in this deployment could ever be told had changed.

/**
 * why this deployment can or cannot charge one rail, as a closed set.
 *
 * six members because there are six different things to do about them, and a member exists
 * exactly where the answer to "what now" differs. collapsed to a boolean, the whole module would be
 * a list of rails with nothing said about which of them somebody can fix, or how.
 *
 *   approved             — the account is approved for this rail and the operator has it switched
 *                          on. necessary, not sufficient: see the header. this is the only member a
 *                          caller may act on, and the only one a rail may be charged on.
 *   in_review            — asked for, and the processor is still working through it. waiting is the
 *                          fix, and there is nothing for an operator to do.
 *   not_approved         — asked for and not usable: short of a requirement, paused, or refused.
 *                          what to do about it is on the processor's dashboard.
 *   never_requested      — the account has never asked for this rail. the fix is to ask, and it is
 *                          the member that must never be reported as a refusal — an operator sent to
 *                          appeal a rejection nobody issued has nowhere to go.
 *   switched_off         — the account is approved for this rail and the operator has switched it
 *                          off where the processor keeps that setting. one switch is the whole of the
 *                          fix, which is why it is not `not_approved`: those two look identical from
 *                          a screen and are a click and a fortnight apart.
 *   account_cannot_charge — the account cannot process a charge at all, so no rail on it can be
 *                          charged whatever its own approval says. reported in place of the rail's
 *                          own state because this is the block that has to be cleared first:
 *                          approving a capability underneath it changes nothing a donor would see.
 */
export const RAIL_STANDINGS = [
	'approved',
	'in_review',
	'not_approved',
	'never_requested',
	'switched_off',
	'account_cannot_charge'
] as const;
export type RailStanding = (typeof RAIL_STANDINGS)[number];

/**
 * where this deployment stands on every rail its form vocabulary holds.
 *
 *   unreadable — the port could not answer: no credentials, a rejected key, a processor that did not
 *                reply. `detail` is the port's own sentence, which names the value to fix. no rail
 *                is reported on this arm, because a rail reported as blocked would be a statement
 *                about an answer that was never given.
 *   read       — the account answered. `chargesEnabled` is the account-level fact, carried beside
 *                the rails rather than only folded into them so that a caller can say which of the
 *                two kinds of problem it is looking at.
 */
export type RailChargeability =
	| { readonly state: 'unreadable'; readonly detail: string }
	| {
			readonly state: 'read';
			/** whether the account may process a charge at all. */
			readonly chargesEnabled: boolean;
			/**
			 * one standing per rail, total over the form's own vocabulary.
			 *
			 * `PAYMENT_METHODS` in packages/form/src/v1.ts is a permanent contract that may gain a member
			 * (CLAUDE.md), and total here means a rail added there without an answer is a compile error
			 * rather than a screen with a gap in it.
			 */
			readonly rails: Readonly<Record<PaymentMethod, RailStanding>>;
	  };

/**
 * the fields on `AccountChargeability` that carry a capability state, derived rather than listed.
 *
 * derived so that `chargesEnabled` cannot be named as a rail's source. listed by hand, the table
 * below would take any key on that type and a rail pointed at the account-level boolean would be a
 * lookup returning `true` where a state belongs — which type-checks nowhere useful and reads as a
 * standing nobody wrote.
 */
type CapabilityField = {
	[K in keyof AccountChargeability]: AccountChargeability[K] extends RailCapabilityState
		? K
		: never;
}[keyof AccountChargeability];

/**
 * which capability answers for a rail.
 *
 * total over `PaymentMethod`, so a rail added to packages/form/src/v1.ts has to be given a source
 * here rather than inheriting one.
 *
 * the wallets answer to the card capability, which is not the card rail's answer borrowed: a wallet
 * settles as a card charge (`RAILS` in packages/form/src/embed/rails.ts), so the approval that
 * governs it is the same approval, while the switch below is each wallet's own — an account
 * approved for cards with Apple Pay switched off reports `switched_off` for the wallet and
 * `approved` for the card, which is exactly the difference an operator needs to see.
 */
const RAIL_CAPABILITY: Readonly<Record<PaymentMethod, CapabilityField>> = Object.freeze({
	card: 'cardPayments',
	ach: 'achPayments',
	apple_pay: 'cardPayments',
	google_pay: 'cardPayments'
});

/**
 * where this deployment stands on each of its rails, read fresh from the processor.
 *
 * never throws and never rejects: every arm of the port answers with a value, and this turns the
 * failing one into a state rather than passing it up. that is what keeps a processor nobody can
 * reach from taking down the screen an operator opened to find out why nothing works.
 */
export async function readRailChargeability(provider: PaymentProvider): Promise<RailChargeability> {
	// both reads issued together rather than one after the other. neither needs the other's answer,
	// and a caller waiting on this is an operator holding a screen open: run in sequence, the worst
	// case is two of the port's timeouts end to end instead of one.
	const [chargeability, switchboard] = await Promise.all([
		provider.readAccountChargeability(),
		provider.readRailSwitchboard()
	]);

	// either failure is the whole read failing, and the sentence says which one it was. a partial
	// answer is the one thing this must not report: approval without the operator's intent — or the
	// other way round — is not enough to state what a deployment offers, and half an answer rendered
	// as a whole one is a screen that is confidently wrong rather than honestly blank.
	if (!chargeability.ok) {
		return {
			state: 'unreadable',
			detail: `The account’s own approvals could not be read. ${chargeability.detail}`
		};
	}
	if (!switchboard.ok) {
		return {
			state: 'unreadable',
			detail: `The rails switched on with the processor could not be read. ${switchboard.detail}`
		};
	}

	const account = chargeability.value;
	const rails = {} as Record<PaymentMethod, RailStanding>;
	for (const rail of PAYMENT_METHODS) rails[rail] = standingOf(rail, account, switchboard.value);

	return { state: 'read', chargesEnabled: account.chargesEnabled, rails };
}

/**
 * one rail's standing, in the order the sources have to be read in.
 *
 * the order is the whole of the decision. the account-level block is read first because it blocks
 * every rail underneath it — reported second, a rail would answer for its own approval on an
 * account that cannot charge at all, and an operator would go and fix the wrong thing. only then
 * does the rail itself answer.
 *
 * `offered` is what says a rail is chargeable, and it is taken rather than recomputed: it is the
 * processor's own conjunction of the two facts below it, so deriving `approved` from the capability
 * and the switch separately would be this app's second opinion about a question the processor
 * already answered — and the two would part company on the day either of them gains a condition.
 * the capability and the switch are read only to say *why* a rail that is not offered is not, which
 * is the distinction this module exists for.
 *
 * a rail that is approved and switched on and still not offered is reported `not_approved` rather
 * than `approved`: the two explanations contradict the answer, and the direction that is safe to be
 * wrong in is the one that never claims a rail can be charged.
 */
function standingOf(
	rail: PaymentMethod,
	account: AccountChargeability,
	switchboard: RailSwitchboard
): RailStanding {
	if (!account.chargesEnabled) return 'account_cannot_charge';

	const setting = switchboard[rail];
	if (setting.offered) return 'approved';

	const approval = APPROVAL[account[RAIL_CAPABILITY[rail]]];
	if (approval !== 'approved') return approval;
	return setting.switchedOn ? 'not_approved' : 'switched_off';
}

/**
 * the processor's four capability states in this module's vocabulary.
 *
 * a rename and nothing more, which is why it is a table rather than a function: what makes a
 * standing is `standingOf` above, and the only job here is that the words a screen reads are named
 * for approval rather than for a rail working. total over `RailCapabilityState`, so a fifth state added
 * to the port is a compile error here.
 */
const APPROVAL: Readonly<Record<RailCapabilityState, RailStanding>> = Object.freeze({
	active: 'approved',
	pending: 'in_review',
	inactive: 'not_approved',
	unrequested: 'never_requested'
});
