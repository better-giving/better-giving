import type { StripeUnreadableReason } from './stripe-read.js';

// what a deployment says about the Stripe account it charges on — which ways of paying it can
// actually take, whether the deliveries coming back are verified, whether they are all being sent,
// and which of its hostnames the account will draw wallet buttons on — named once for both ends of
// the wire, with the two presses that repair the last two of them.
//
// it is here for the reason ./recurring.ts is here: the deployment reads every fact against its own
// processor account with the key it holds, the operator console draws them, and the two packages
// import nothing of each other's.
//
// **every read here is the deployment's and can be nowhere else.** the rails, the endpoint's
// subscription and the hostnames the account holds for wallets are read through the deployment's
// payment port with the key the deployment holds, which no console has. the signing secret is stronger than that: it is a deploy-time secret that
// no read of any kind hands back —
// not Stripe's (../stripe/secret-fingerprint.ts says why), and not Cloudflare's, which reports only
// that a slot is filled. so the comparison that says whether deliveries verify can be made by the
// deployment and by nothing else, and a console asking anyone else gets `Stored` over a deployment
// verifying nothing.
//
// **no secret value crosses this wire, and none can.** what travels is which of four states the
// stored secret is in; the value and its digest stay inside the worker
// (`webhookSecretStanding` in `packages/app/src/lib/server/payments/webhook-secret.ts`). the
// endpoint's own id stays there too, and for a second reason: a console holding one could name it
// in the press below,
// which would be a button acting on whichever endpoint the request said.
//
// **it is a block and never a member of the report**, the same rule ./recurring.ts states: a rail
// an account was never approved for is not a deployment half set up. nothing here belongs in
// ./report.ts's envelope, and the report does not carry it.
//
// nothing here states a rule about the processor. what a standing means is decided in
// `packages/app/src/lib/server/payments/rail-chargeability.ts`, its sentences are written in
// `packages/app/src/lib/server/forms/rail-notes.ts`, and both arrive in the values below.

/**
 * why a deployment can or cannot charge one rail, as a closed set the console draws.
 *
 *   approved              — the account is approved for it and the operator has it switched on.
 *   in_review             — asked for, and the processor is still working through it.
 *   not_approved          — asked for and not usable: short of a requirement, paused, or refused.
 *   never_requested       — never asked for. never a refusal, in any word a console puts on it.
 *   switched_off          — approved, and the operator has switched it off at the processor.
 *   account_cannot_charge — the account cannot take a payment at all, so no rail on it can.
 *
 * **`approved` is a necessary condition and never a sufficient one, and no word a console writes
 * over it may say otherwise.** a rail reported `approved` still refuses a real gift over the
 * currency, the amount, or where the donor's bank is — the reasoning is in
 * `packages/app/src/lib/server/payments/rail-chargeability.ts`'s header, and the members are named
 * for approval rather than for outcome so that "this will work" has no word to be written in.
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
 * one way of paying, as the deployment reports it.
 *
 * `label` travels rather than being spelled here: the vocabulary of rails is the donation form's
 * (`PAYMENT_METHOD_LABELS` in `packages/form/src/v1.ts`), which this package does not import, and a
 * second spelling on the console side is a name that quietly stops matching what a donor is shown.
 *
 * `note` is the deployment's own sentence for the standing and is `null` where there is nothing to
 * say — one sentence per standing, written in
 * `packages/app/src/lib/server/forms/rail-notes.ts`. it is drawn rather than printed: it marks a
 * command or a variable name with paired backticks (../code-spans.ts).
 */
export interface RailLine {
	/** the processor-independent name of the rail, which is what makes a line identifiable. */
	readonly rail: string;
	/** what it is called where a donor is shown one. */
	readonly label: string;
	readonly standing: RailStanding;
	readonly note: string | null;
}

/**
 * where a deployment stands on every way of paying its form offers.
 *
 * `unreadable` is the read that could not be made — no credentials, a rejected key, a processor
 * that did not reply — carried as a state rather than as a failure of the request, because it says
 * nothing about the account. no rail is reported on that arm: a rail drawn as blocked would be a
 * statement about an answer nobody was given.
 *
 * `reason` says which of those it was, in the closed set ./stripe-read.ts states: a deployment
 * holding no key asked nothing, and a deployment holding one asked and came away without an answer.
 * `detail` is the sentence and `reason` is the fact — a console deciding between them off the prose
 * would be a screen that changes what it draws when somebody edits a string.
 *
 * `chargesEnabled` rides beside the rails rather than only folded into them, so a console can say
 * which of the two kinds of problem it is looking at.
 *
 * the rails arrive in the deployment's order and no consumer sorts them: the order is a donor's,
 * decided once where the vocabulary is.
 */
export type RailsReading =
	| {
			readonly state: 'unreadable';
			readonly reason: StripeUnreadableReason;
			readonly detail: string;
	  }
	| {
			readonly state: 'read';
			readonly chargesEnabled: boolean;
			readonly rails: readonly RailLine[];
	  };

/**
 * whether the signing secret a deployment holds is the one its endpoint is signed with, as a closed
 * set the console draws.
 *
 *   verifying     — the endpoint at this deployment's address was created with the secret it holds.
 *                   the only member that says deliveries are being verified.
 *   stale         — a secret is stored and it is a different endpoint's. every delivery fails
 *                   verification and no gift reaches the books, with every other row on the screen
 *                   reading fine.
 *   unset         — nothing is stored.
 *   unconfirmable — there is nothing to compare against: no endpoint is registered, the account
 *                   could not be read, or the endpoint carries no fingerprint. an endpoint
 *                   registered in the Stripe dashboard carries none and a deployment on one is
 *                   working, so a console drawing this as a mismatch would send an operator to
 *                   replace a working endpoint and cost them the secret they have.
 *
 * four members and not a boolean, because `unconfirmable` and `stale` are opposite instructions
 * wearing the same absence of a match.
 */
export const WEBHOOK_SECRET_STANDINGS = ['verifying', 'stale', 'unset', 'unconfirmable'] as const;

export type WebhookSecretStanding = (typeof WEBHOOK_SECRET_STANDINGS)[number];

/**
 * where the stored signing secret stands, as the deployment reports it.
 *
 * `detail` is the deployment's own sentence and is `null` on every state it has nothing to add to.
 * only `stale` carries one, and what it carries is a way out no console could write: the secret is
 * deploy-time (CLAUDE.md), so setting it without a redeploy changes nothing, and the sentence names
 * both halves. drawn rather than printed, for `RailLine.note`'s reason.
 */
export interface WebhookSecretReading {
	readonly state: WebhookSecretStanding;
	readonly detail: string | null;
}

/**
 * what the endpoint at this deployment's address is subscribed to and whether it is switched on, as
 * the deployment reports it.
 *
 *   unreadable   — the deployment could not ask its processor. `detail` is its own sentence, which
 *                  names the value to fix. it says nothing about the endpoint.
 *   unregistered — the account holds nothing at this deployment's address, so nothing is delivered
 *                  anywhere. the fresh-fork state, and the one the setup press belongs to.
 *   complete     — switched on and subscribed to everything this app records. nothing to do.
 *   incomplete   — the endpoint is the right one and is not doing the whole job.
 *
 * **the two faults `incomplete` carries are kept apart and both are true at once.** an endpoint
 * switched off delivers nothing at all; an endpoint delivering while short of an event drops
 * exactly what it is not subscribed to and reads fine on every other line. one press repairs
 * either, and a console with only the press has nothing to say about which one an operator is
 * looking at.
 *
 * **no endpoint id and no fingerprint is on any arm, and neither may be added.** the endpoint is
 * found by URL inside the worker on every call that acts on it
 * (`packages/app/src/lib/server/payments/webhook-registration.ts`), so an id here would have no
 * reader — and one a console held is one a press could name, which is a button acting on whichever
 * endpoint the request said rather than on this deployment's own.
 */
export type WebhookSubscriptionReading =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: 'unregistered' }
	| { readonly state: 'complete' }
	| {
			readonly state: 'incomplete';
			/** whether the processor is delivering to it at all. */
			readonly delivering: boolean;
			/**
			 * what it is not subscribed to and has to be, in the processor's own spelling and in the
			 * required list's order.
			 *
			 * empty where the only fault is that delivery is switched off. the order is the
			 * deployment's and no consumer sorts it, so the same gap always reads the same way.
			 */
			readonly missingEventTypes: readonly string[];
	  };

/**
 * what one press of the repair did, as a closed set the console switches on.
 *
 * two members and no third for "nothing to do": the press is only offered under an `incomplete`
 * reading, and an endpoint already level is brought level again by the same call with nothing
 * changed — a word for it would be a state the screen has no way to reach.
 */
export const WEBHOOK_REPAIR_OUTCOMES = ['repaired', 'failed'] as const;

export type WebhookRepairOutcome = (typeof WEBHOOK_REPAIR_OUTCOMES)[number];

/**
 * what the repair reports back, in one total shape whichever arm produced it.
 *
 * `detail` is the deployment's own sentence and is `null` on the arm that worked. an endpoint
 * deleted in the processor's dashboard since the screen was drawn lands on `failed` carrying the
 * sentence that says to reload and register again.
 *
 * **nothing about the endpoint itself is on it** — no id, no signing secret, no fingerprint. the
 * repair leaves the secret alone, so there is nothing here for a console to store and nothing for
 * an operator to carry anywhere.
 */
export interface WebhookRepairReport {
	readonly outcome: WebhookRepairOutcome;
	readonly detail: string | null;
}

/**
 * the wallets a deployment draws inside the payment element, as a closed set both ends name.
 *
 * declared here rather than imported: this package reaches nothing of the app's (CLAUDE.md). the
 * vocabulary is `WALLETS` in `packages/app/src/lib/server/payments/provider.ts`, and the route that
 * builds the reading below satisfies this list from it — so a wallet added on one side and not the
 * other is a deployment that no longer compiles rather than a wallet missing from every answer.
 *
 * the processor reports a block per wallet and holds more of them than this — PayPal, Amazon Pay,
 * Klarna — and this deployment draws none of those, so none of them reaches a line here. a member
 * with no reader is a state a screen has to find a sentence for.
 */
export const WALLETS = ['apple_pay', 'google_pay', 'link'] as const;

export type Wallet = (typeof WALLETS)[number];

/**
 * how far the processor has got with one wallet on one registered hostname, as a closed set the
 * console draws.
 *
 *   active   — the processor draws this wallet on this hostname.
 *   inactive — it does not, because a requirement for it is unmet.
 *
 * two words because the processor's own vocabulary here is two, and the deployment reads anything
 * else it ever reports as `inactive` — the direction safe to be wrong in, argued at `WALLET_STATES`
 * in `packages/app/src/lib/server/payments/provider.ts`.
 */
export const WALLET_STATES = ['active', 'inactive'] as const;

export type WalletState = (typeof WALLET_STATES)[number];

/**
 * one wallet on one registered hostname, as the deployment reports it.
 *
 * `detail` is the processor's own sentence about a wallet it is not drawing and is `null` where it
 * wrote none — the ordinary case for a wallet that is drawn, so absence is "nothing to say" and
 * never "the reason could not be read".
 *
 * it is the only thing either end of this wire can say about what to do: what an inactive wallet is
 * short of is a requirement on the operator's own domain, settled somewhere neither this package
 * nor the deployment can see. so it is somebody else's prose, and it arrives already bounded,
 * flattened to one line and stripped of anything key-shaped by the port that carried it
 * (`WalletStanding` in `packages/app/src/lib/server/payments/provider.ts`). unlike `RailLine.note`
 * it is nobody's sentence in this repository, so it is printed as it came rather than drawn.
 */
export interface WalletLine {
	readonly state: WalletState;
	readonly detail: string | null;
}

/**
 * where one hostname stands for wallets, as a closed set the console draws.
 *
 *   drawing         — the account holds it, honours it, and every wallet this deployment draws is
 *                     active on it. the only member that needs no press.
 *   wallet_inactive — held and honoured, with at least one wallet not being drawn. each wallet's
 *                     own line says which, and carries the processor's sentence about it.
 *   switched_off    — held and not honoured. it draws no wallet whatever its wallets say, which is
 *                     the shape that reads as a finished setup: the account holds the site, the
 *                     buttons are missing, and nothing on the account says why.
 *   unregistered    — the account holds nothing for this hostname. the fresh-fork state, and the
 *                     one the press below belongs to.
 *
 * four members and not a flag, because a donor sees the same missing button over three different
 * causes and only one word per cause tells an operator which screen fixes it — and because a
 * hostname that is switched off is reported as that whatever its wallets say, rather than as one
 * wallet's problem.
 *
 * **no `pmd_` id is on any arm and none may be added**, for the reason `WebhookSubscriptionReading`
 * above states about the endpoint's: the press finds the registration from the hostname inside the
 * worker (`registerWalletDomain` in `packages/app/src/lib/server/payments/provider.ts`), so an id
 * here would have no reader — and one a console held is one a press could name, which is a button
 * registering whichever hostname the request said on the operator's own account.
 */
export const WALLET_HOST_STANDINGS = [
	'drawing',
	'wallet_inactive',
	'switched_off',
	'unregistered'
] as const;

export type WalletHostStanding = (typeof WALLET_HOST_STANDINGS)[number];

/**
 * one hostname this deployment wants wallet buttons on, and where it stands on the account.
 *
 * `own` is the address the deployment answers on, and exactly one line carries it: the donation
 * page a deployment serves is on no `site` row (CLAUDE.md), so the console draws that line as the
 * donation page and every other as a site the operator listed. it is a flag rather than a separate
 * member of the reading because it is the same registration on the same account either way — what
 * differs is only the words a screen puts beside it.
 *
 * the wallets are on the three registered arms and on no other: a hostname the account does not
 * hold has no wallet state to report, and a line carrying three of them would be a screen drawing
 * blanks under a site nothing has been asked about yet.
 *
 * the lines arrive in the deployment's order and no consumer sorts them — the deployment's own
 * address first, then the operator's sites in their stored order.
 */
export type WalletHostLine =
	| {
			readonly host: string;
			readonly own: boolean;
			readonly standing: 'unregistered';
	  }
	| {
			readonly host: string;
			readonly own: boolean;
			readonly standing: Exclude<WalletHostStanding, 'unregistered'>;
			readonly wallets: Readonly<Record<Wallet, WalletLine>>;
	  };

/**
 * which hostnames the account will draw wallet buttons on, as the deployment reports them.
 *
 * the same two arms `RailsReading` above takes and for the same reasons. `unreadable` is the read
 * that could not be made, carried as a state rather than as a failure of the request because it
 * says nothing about the account; `reason` is the fact and `detail` the sentence, so a console
 * never decides what to draw by reading prose somebody may reword.
 *
 * the failing arm is the whole reading rather than one hostname's: one read of the account answers
 * for all of them, so an arm per hostname would be the same sentence repeated once per site.
 */
export type WalletsReading =
	| {
			readonly state: 'unreadable';
			readonly reason: StripeUnreadableReason;
			readonly detail: string;
	  }
	| {
			readonly state: 'read';
			readonly hosts: readonly WalletHostLine[];
	  };

/**
 * one hostname after the press, and whether the press moved anything on it.
 *
 * `line` is where the hostname stands now — what the press left behind where it landed, and what
 * was already there where it did not — so a console redraws the whole block from this answer
 * without reading the account again, and a hostname the press failed on still shows what it is
 * rather than going blank.
 *
 * `changed` is false for both "it was already right" and "the press failed", which `detail` tells
 * apart: `detail` is the deployment's own sentence for a hostname the press could not move, and
 * `null` where there was nothing to say. one hostname's failure stops no other, so a press over
 * four sites comes back with three levelled and one carrying a reason.
 */
export interface LevelledWalletHost {
	readonly line: WalletHostLine;
	readonly changed: boolean;
	readonly detail: string | null;
}

/**
 * what one press of the wallet registration left behind, per hostname it was asked about.
 *
 * `unreadable` is the account read that opens the press rather than any hostname's own failure: the
 * press has to know what the account already held before it can say what it changed, so a read that
 * did not land means nothing was attempted at all — and it is the same two-part fact the reading
 * above carries, so a console has one decision to make about both.
 *
 * one total shape and no outcome word, unlike `WebhookRepairReport` above: this press acts on a
 * list rather than on one object, and a single word over four hostnames would have to be either the
 * best or the worst of them.
 */
export type WalletLevellingReport =
	| {
			readonly state: 'unreadable';
			readonly reason: StripeUnreadableReason;
			readonly detail: string;
	  }
	| {
			readonly state: 'levelled';
			readonly hosts: readonly LevelledWalletHost[];
	  };

/** the whole of what a deployment answers about the account it charges on. */
export interface PaymentsReport {
	readonly rails: RailsReading;
	readonly webhook: WebhookSecretReading;
	readonly subscription: WebhookSubscriptionReading;
	readonly wallets: WalletsReading;
}
