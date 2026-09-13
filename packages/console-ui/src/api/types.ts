import type { DEPLOY_VARS } from '@better-giving/operator/deploy-split';

// what the binary answers, in the shapes it answers in.
//
// **these mirror go structs and are written by hand.** `packages/console/internal/server` decides
// the field names through its json tags, and nothing generates these from them — so a field renamed
// on one side is renamed on the other in the same change, and a shape that drifts is a value read as
// `undefined` on a page rather than a type error. every field a handler emits is stated here, and
// none is optional: the go side writes them all, empty strings and empty lists included.
//
// **no answer here carries a credential and none may.** the token this console signs in with stays
// in the binary — it travels into a cloudflare header and reaches nothing a browser reads — so what
// crosses this boundary about it is an account id, a name and a folder on this machine. a field
// carrying a token would be a token in the document, in the browser's memory and in whatever a page
// extension can read.

/** the cloudflare account this deployment is in. */
export type Account = { id: string; name: string };

/** why there is no workers.dev address, where there is none. */
export type NoWorkersDev = 'turned-off' | 'unregistered' | 'unknown';

/**
 * why nothing below the bar can be drawn, in the read's own terms.
 *
 * flat rather than a member per kind, which is what the wire is: the binary writes every field on
 * every answer and each is empty on the kinds that say nothing about it.
 *
 * each of them is repaired somewhere different — cloudflare's dashboard, this machine's connection,
 * a sign-in, this console's own press — so they are kinds and never one sentence about a console
 * that could not find out.
 */
export type Blocked = {
	kind: 'no-credential' | 'refused' | 'unreachable' | 'two-databases' | 'no-address' | 'no-values';
	/** cloudflare's own words about the read that did not land, and empty where it wrote none. */
	detail: string;
	/** how many databases of the one name the account holds. */
	count: number;
	/** which of the three reasons there is no workers.dev address. */
	why: NoWorkersDev | '';
};

/** what the deployment answered about itself, or which way it did not. */
export type NoReport =
	/**
	 * the deployment holds a different session, or none.
	 *
	 * the three members are the deployment's own and every one of them may be `null` together: a
	 * 401 in a shape the binary was not written against is still a refusal, and it is the console's
	 * own screen that says so where the deployment said nothing readable.
	 */
	| { kind: 'refused'; error: string | null; message: string | null; fix: string | null }
	/** this console holds no session, so there was no request to make. */
	| { kind: 'no-session' }
	/** something answers at that address and it serves no console surface. */
	| { kind: 'no-surface' }
	/** nothing was found out either way: no route to the deployment, or it took too long. */
	| { kind: 'unreachable'; detail: string }
	/**
	 * it answered, and in a shape the binary was not written against.
	 *
	 * `fix` is the deployment's second sentence, carried for the reason `refused` carries its own: a
	 * refusal outside 401 writes the same members, and the way out is the only one of them that says
	 * what to do about the state.
	 */
	| { kind: 'unreadable'; detail: string; fix: string | null };

/**
 * the one face on screen.
 *
 * the account is settled before the page is served (`better-giving start`), so every face is scoped
 * to one and an answer saying there is none is a shape the binary never writes.
 */
export type HomeFace =
	/** nothing after the bar can be read. */
	| { kind: 'blocked'; why: Blocked }
	/** no worker of this deployment's name is in the account. */
	| { kind: 'deploy'; database: 'absent' | 'present' }
	/**
	 * it is deployed and this console cannot read it: the session was replaced, or is not answering.
	 *
	 * the address is carried because it was read, and an operator standing on this face is the one
	 * likeliest to want to open the deployment and look.
	 */
	| { kind: 'unreachable'; address: string; read: NoReport }
	/** it is up, it answers, and the six folds are what is left. */
	| { kind: 'ready'; address: string };

/** one of the seventeen values an operator configures a deployment with, every one of them a var. */
export type DeployVarName = (typeof DEPLOY_VARS)[number];

/**
 * one var, as the deployment holds it.
 *
 * three states and not two. `absent` is nothing in the slot; `withheld` is a binding under one of
 * the seventeen names that is not plain text, which is a deployment that stored the value as a
 * secret — the value is there and the deployment reads it, and the free press is the way out.
 * collapsing them would print the same cell over two deployments an operator has to do different
 * things to.
 */
export type DeployedVar =
	| { readonly name: DeployVarName; readonly kind: 'value'; readonly value: string }
	| { readonly name: DeployVarName; readonly kind: 'withheld' }
	| { readonly name: DeployVarName; readonly kind: 'absent' };

/** what the seventeen read as, or which way they did not. */
export type VarsRead =
	| { kind: 'read'; vars: DeployedVar[] }
	/** the worker is not in the account, which is every run before a first deploy. */
	| { kind: 'not-deployed' }
	/** cloudflare answered and turned this sign-in down for this account. */
	| { kind: 'refused'; detail: string }
	/** this console holds no cloudflare sign-in to read with. */
	| { kind: 'no-credential'; detail: string }
	/** nothing was found out either way: no route to cloudflare, or it took too long. */
	| { kind: 'unreachable'; detail: string }
	/** it answered, and in a shape nothing was written against. */
	| { kind: 'unreadable'; detail: string };

/** the seventeen as the one door answered for them, whether or not it landed. */
export type DeployedValues = { vars: VarsRead };

/**
 * the account this console was started in, and the two names every screen under it is about.
 *
 * it answers within a loopback round trip because everything in it is this machine's own memory and
 * the release the binary was baked from. `better-giving start` records the account before the page
 * is served, so there is always one to state.
 *
 * `remembered` is whether this machine will still know the account after a restart: it is false
 * where the state directory could not be written, and the choice then holds for this run.
 */
export type HomeShape = {
	workerName: string;
	databaseName: string;
	account: Account;
	remembered: boolean;
	/**
	 * the folder a sign-in this machine could not write down would have gone in, and `null` where
	 * nothing failed to keep.
	 *
	 * the credential in hand is good either way and the loss shows at the next launch
	 * (`packages/console/internal/oauth/flow.go`'s `kept`). the binary is the only half that knows
	 * the folder — it is the operating system's own config home — and a sentence sending an operator
	 * to make a folder writable without naming it is one they cannot act on.
	 */
	notKept: string | null;
};

/**
 * the whole slower reading, as one answer.
 *
 * one answer rather than three, because the face is a function of every read on the page: nothing
 * about it can be drawn before the slowest of them lands, so one is one checking state rather than
 * a page that resolves three times under the reader.
 */
export type HomeReading = {
	face: HomeFace;
	values: DeployedValues;
	/** the deployment's own site list, which the sites fold seeds its boxes from. */
	sites: string[];
	/**
	 * where this deployment answers, which is where its donation page is served, and `''` where the
	 * binary could read no address for it (`packages/console/internal/deployment/address.go`).
	 *
	 * it is on no site row and on no form's allowed origins, so the sites fold states it beside that
	 * list rather than holding it in one: nothing an operator can untick takes their own donation
	 * page down (CLAUDE.md → Product surface). `''` on every face but the ready one.
	 */
	donatePage: string;
	/** the organisation's profile as the deployment holds it, carried through unread. */
	org: unknown;
	/**
	 * whether there is anything to ask the deployment on the addresses that are Stripe's alone.
	 *
	 * each of those reaches Stripe with the stored secret and answers in a shape that says there was
	 * none, which this console draws as an answer it could not read (../lib/unread-answer.ts) — so a
	 * deployment nobody has finished setting up would report a failure rather than the empty boxes
	 * that are the whole truth of it.
	 *
	 * **the payments reading is not one of them and may not be put back under it.** that reading
	 * answers for every processor and carries an arm for one this deployment holds no credentials for
	 * ({@link ProcessorPayments}), so a key that charges on one processor gating it is a deployment
	 * set up on the other reporting nothing at all about the processor it does charge on.
	 *
	 * `false` on every face but the ready one, and `false` where the values read did not land: a read
	 * that came back in none of its ways found nothing out either way. a key the deployment is
	 * holding as a credential is a key it charges with, so `withheld` is `true` here.
	 */
	holdsStripeKey: boolean;
};

/**
 * why there was nowhere to write one of the seventeen to.
 *
 * two members and not the seven an address read has: a write finds out from its own answer, and the
 * only two things it can find out are that the account holds no such worker and that the binary
 * holds no sign-in to ask with.
 */
export type NoWhere = { kind: 'not-deployed' } | { kind: 'no-credential'; detail: string };

/**
 * the ways a write of one of the seventeen did not happen.
 *
 * shared by both doors because they are the same four facts about the machine and the account:
 * every fold on this surface already draws the one it got.
 */
export type ValuesRefusal =
	| { kind: 'nowhere'; address: NoWhere }
	/** cloudflare answered and turned this sign-in down for this account. */
	| { kind: 'refused'; detail: string }
	/** nothing was found out either way: no route to cloudflare, or it took too long. */
	| { kind: 'unreachable'; detail: string }
	/** it answered, it would not store them, and these are cloudflare's own words about why. */
	| { kind: 'failed'; detail: string };

/**
 * how a write of one or more of the seventeen went, which is the one answer every press on the page
 * gets: each of them is a var and they all go through one door.
 *
 * `set` is the only one that left anything on the deployment. `nothing` is a press the binary
 * answered before cloudflare was asked — a write naming nothing changes nothing and answers 200,
 * which a reader keying on the status would draw as a save that happened. the last two are the
 * press decided against a fresh read: `unchanged` is every name already holding what was asked for,
 * and `withheld` is a name the deployment holds in a form nothing can read back, so there is
 * nothing to compare against and the value is not written over.
 */
export type VarsWritten =
	| { kind: 'set' }
	| { kind: 'nothing' }
	| { kind: 'unchanged' }
	| { kind: 'withheld'; names: DeployVarName[] }
	| ValuesRefusal;

/**
 * the ways each of the two writes did not land, which is what a chain that stopped at one carries.
 *
 * the kinds that changed something, or found nothing to change, are not among them: a run reports a
 * write only where the write is why it stopped.
 */
export type VarsUnwritten = Exclude<
	VarsWritten,
	{ kind: 'set' } | { kind: 'nothing' } | { kind: 'unchanged' }
>;

/**
 * how the press that opens this console's session on the deployment went.
 *
 * `connected` is the only one that left anything anywhere. `unkept` is the deployment holding a
 * session this machine could not write down — its own state and not a failure of the write, because
 * the value is live there and the way out is the folder rather than the press.
 */
export type Connection = {
	kind: 'connected' | 'nowhere' | 'refused' | 'unreachable' | 'failed' | 'unkept';
	/** when the session ends, and empty on every other kind. */
	expiresAt: string;
	/** where it was written, which is the deployment the operator is looking at. */
	origin: string;
	/** cloudflare's own words about the call, or this machine's about a record it could not write. */
	detail: string;
};

/**
 * how a write of the organisation's profile went. `saved` is the only one that changed a row.
 *
 * a refusal comes back keyed by field, which is the whole point of the endpoint answering that way:
 * each sentence is drawn under the box it is about, and every offending box comes back at once
 * rather than one per round trip. `message` and `fix` are the deployment's own two sentences and are
 * carried whole beside the keys — either may be `null`, because a refusal in a shape the binary was
 * not written against is still a save that did not land.
 *
 * the stored profile comes back off the write itself, which is what the boxes are re-seeded from —
 * the site list is carried back the same way and for the same reason ({@link SitesWrite}). it is
 * `unknown` for the reason the reading's own member is: the envelope checked nothing about it, and
 * ../lib/org-fields.ts's `orgBoxes` is where it stops being one. a deployment older than this
 * console answers with a report naming no profile at all, so it may be absent.
 */
export type OrgWrite =
	| { kind: 'saved'; org: unknown }
	| OrgRefused
	| { kind: 'unwritten'; read: NoReport };

export type OrgRefused = {
	kind: 'refused';
	message: string | null;
	fix: string | null;
	errors: Record<string, string>;
	/** how many keys came back that this console draws no box for. */
	unread: number;
};

/** one donation form standing in the way of a removal, as the deployment names it. */
export type BlockingForm = { id: string; name: string };

/** one site that could not be removed, and every form still listing it. */
export type BlockedSite = { site: string; forms: BlockingForm[] };

/**
 * how a write of the site list went. `saved` is the only one that changed the deployment.
 *
 * the stored list comes back off the write itself, which is what the boxes are re-seeded from —
 * and it is what each row normalised to rather than what was typed, so a box comes back holding the
 * address the deployment will compare an `Origin` header against. a refusal carries one sentence
 * and not a map keyed by row: the parse says what is wrong with the list and names no address in
 * it, because the boxes are still on the screen holding what was typed.
 */
export type SitesWrite =
	| { kind: 'saved'; sites: string[] }
	| { kind: 'refused'; message: string; fix: string | null }
	| { kind: 'blocked'; message: string; fix: string | null; inUse: BlockedSite[] }
	| { kind: 'unwritten'; read: NoReport };

/** what a test send did, as the deployment reports it. */
export type TestSendReport = {
	outcome: 'sent' | 'failed';
	/** what went wrong, verbatim, and `null` on the arm where nothing did. */
	detail: string | null;
	/** the address it was addressed to: what the press named, echoed back. */
	to: string;
};

/**
 * how a test send went.
 *
 * `bad-address` carries no sentence: what is in the way is the box on this screen, and the
 * deployment's own refusal is written for a caller sending JSON rather than for the operator
 * holding the box. `unanswered` rather than "unsent" — a deployment that answered in a shape the
 * binary was not written against may well have sent the message.
 */
export type TestSend =
	| { kind: 'reported'; report: TestSendReport }
	| { kind: 'bad-address' }
	| { kind: 'unanswered'; read: NoReport };

/** why a reading the deployment makes against its processor account could not be made. */
export type StripeUnreadableReason = 'no_key' | 'failed';

/**
 * the processors a deployment can be set up to charge on, as a closed set both ends name.
 *
 * the vocabulary is `PAYMENT_PROCESSORS` in `packages/operator/src/console/payments.ts`, and the
 * order is the deployment's: nothing here sorts, so the sections always stand in one order.
 */
export type PaymentProcessor = 'stripe' | 'paypal';

/** where one way of paying stands on that account. */
export type RailStanding =
	| 'approved'
	| 'in_review'
	| 'not_approved'
	| 'never_requested'
	| 'switched_off'
	| 'account_cannot_charge';

/** one way of paying, as the deployment reports it. */
export type RailLine = {
	/** the processor-independent name, which is what makes a line identifiable. */
	rail: string;
	/** what it is called where a donor is shown one. */
	label: string;
	standing: RailStanding;
	note: string | null;
};

/**
 * what the standings under a rails reading are worth, which is not the same question as what they
 * say.
 *
 * `per_rail_approval` is an approval the processor publishes against this account, read back.
 * `credentials_only` is a processor that publishes none: what was proven is that the credentials
 * authenticate, every rail is reported `approved` on the strength of that alone, and which funding
 * sources a payer is offered is decided in the payer's own browser. a screen reads this before it
 * words a single standing, or it tells an operator a way of paying is switched on for an account
 * that has never enabled it — and the operator finds out from a donor.
 */
export type RailEvidence = 'per_rail_approval' | 'credentials_only';

/**
 * which ways of paying this deployment can take on one account, or that the read could not be made.
 *
 * it carries no reason beside `detail`, which {@link RecurringReading} does without for the same
 * reason: a rails reading exists only under a processor this deployment is configured for
 * ({@link ProcessorPayments}), so the one thing a reason could say here — that nothing was asked
 * because no credential is set — is already the arm above it.
 */
export type RailsReading =
	| { state: 'unreadable'; detail: string }
	| { state: 'read'; chargesEnabled: boolean; evidence: RailEvidence; rails: RailLine[] };

/** whether deliveries from the processor verify. */
export type WebhookSecretReading = {
	state: 'verifying' | 'stale' | 'unset' | 'unconfirmable';
	detail: string | null;
};

/**
 * what this deployment's endpoint is subscribed to.
 *
 * the two faults the incomplete arm holds are the whole reason a screen can say which one an
 * operator is looking at: a missing `delivering` read as `true` would draw a switched-off endpoint
 * as one merely short of an event.
 */
export type WebhookSubscriptionReading =
	| { state: 'unreadable'; detail: string }
	| { state: 'unregistered' }
	| { state: 'complete' }
	| { state: 'incomplete'; delivering: boolean; missingEventTypes: string[] };

/** one wallet the deployment draws inside the payment element. */
export type Wallet = 'apple_pay' | 'google_pay' | 'link';

/**
 * one wallet on one registered hostname, as the deployment reports it.
 *
 * `detail` is the processor's own sentence about a wallet it is not drawing and is `null` where it
 * wrote none — the ordinary case for a wallet that is drawn, so absence is "nothing to say" and
 * never "the reason could not be read". it is nobody's sentence in this repository, so it is printed
 * as it came rather than drawn.
 */
export type WalletLine = { state: 'active' | 'inactive'; detail: string | null };

/**
 * where one hostname stands for wallets on that account.
 *
 * `drawing` is the only one that needs no press. `wallet_inactive` is held and honoured with at
 * least one wallet not drawn, and each wallet's own line says which. `switched_off` is held and not
 * honoured, which draws no wallet whatever the wallets say. `unregistered` is the account holding
 * nothing for it, which is the fresh-fork state.
 */
export type WalletHostStanding = 'drawing' | 'wallet_inactive' | 'switched_off' | 'unregistered';

/**
 * one hostname this deployment wants wallet buttons on, and where it stands.
 *
 * `own` is the address the deployment answers on, and at most one line carries it: the donation page
 * a deployment serves is on no site row, so a screen draws that line as the donation page and every
 * other as a site the operator listed.
 *
 * the wallets are on the three registered standings and on none other, which is why this is a union
 * where its neighbours are flat: a hostname the account does not hold has nothing to report about a
 * button, and a line carrying three of them would be a screen drawing blanks under a site nothing
 * has been asked about yet. every registered line carries all of them — the binary drops a reading
 * short of one rather than reporting a hostname with a button missing from it.
 *
 * the lines arrive in the deployment's order and nothing here sorts them — the deployment's own
 * address first, then the operator's sites in their stored order.
 */
export type WalletHostLine =
	| { host: string; own: boolean; standing: 'unregistered' }
	| {
			host: string;
			own: boolean;
			standing: Exclude<WalletHostStanding, 'unregistered'>;
			wallets: Record<Wallet, WalletLine>;
	  };

/**
 * which hostnames the account draws wallet buttons on, or that the read could not be made.
 *
 * the same two arms {@link RailsReading} takes and for the same reasons, the absence of a reason
 * included. the failing arm is the whole reading rather than one hostname's — one read of the
 * account answers for all of them.
 */
export type WalletsReading =
	| { state: 'unreadable'; detail: string }
	| { state: 'read'; hosts: WalletHostLine[] };

/**
 * where a deployment stands on one processor, which is what one section of the payments fold is
 * drawn from.
 *
 * **`unconfigured` and a failing reading are different answers, and this is the arm that keeps them
 * apart.** a deployment set up on one processor holds none of the other's credentials, so nothing
 * was asked of it and nothing about its account is known — which is not an account that was asked
 * and did not answer, and a screen drawing either as the other reports a fault on keys nobody has
 * set. this arm carries no reading at all rather than empty ones, so a screen has no blank row to
 * colour in.
 *
 * `label` travels rather than being spelled on this side: what an operator is shown a processor
 * called is decided once, on the deployment.
 *
 * `wallets` is `null` on the configured arm too, for a processor that draws none anywhere, and that
 * is a third answer rather than an empty reading: a processor whose funding sources are drawn in its
 * own window on its own domain registers no hostname, so there is nothing to read, nothing to press
 * and no section to draw.
 */
export type ProcessorPayments =
	| {
			processor: PaymentProcessor;
			label: string;
			state: 'unconfigured';
			/**
			 * the names this deployment would have to hold before any of it could be asked, in the
			 * deployment's own order. names only — no value of any of them crosses this wire, set or
			 * unset.
			 */
			unset: DeployVarName[];
	  }
	| {
			processor: PaymentProcessor;
			label: string;
			state: 'configured';
			rails: RailsReading;
			webhook: WebhookSecretReading;
			subscription: WebhookSubscriptionReading;
			wallets: WalletsReading | null;
	  };

/**
 * the whole of what a deployment answers about the accounts it charges on.
 *
 * one entry per member of {@link PaymentProcessor} and never only the configured ones: a screen
 * draws a section for each either way — the unconfigured one is where the boxes that configure it
 * are — and a processor left out of the list would be a section with nothing to key off.
 */
export type PaymentsReport = { processors: ProcessorPayments[] };

/** where those accounts stand, or which way the binary did not find out. */
export type PaymentsRead =
	| { kind: 'read'; report: PaymentsReport }
	| { kind: 'unread'; read: NoReport };

/**
 * one hostname after the press that registers them, and whether the press moved anything on it.
 *
 * `line` is where the hostname stands now — what the press left behind where it landed, and what was
 * already there where it did not — so a fold redraws the whole block from this answer without
 * reading the account again, and a hostname the press failed on still shows what it is rather than
 * going blank.
 *
 * `changed` is false for both "it was already right" and "the press failed", which `detail` tells
 * apart: `detail` is the deployment's own sentence for a hostname the press could not move, and
 * `null` where there was nothing to say. one hostname's failure stops no other.
 */
export type LevelledWalletHost = {
	line: WalletHostLine;
	changed: boolean;
	detail: string | null;
};

/**
 * what one press of the registration left behind, per hostname it was asked about.
 *
 * `unreadable` is the account read that opens the press rather than any hostname's own failure: the
 * press has to know what the account already held before it can say what it changed, so a read that
 * did not land means nothing was attempted at all.
 *
 * no outcome word over the whole of it: this press acts on a list, and one word over four hostnames
 * would have to be either the best or the worst of them.
 */
export type WalletLevellingReport =
	| { state: 'unreadable'; reason: StripeUnreadableReason; detail: string }
	| { state: 'levelled'; hosts: LevelledWalletHost[] };

/**
 * how one press to register them went.
 *
 * the same two kinds a repeating-gifts press answers in ({@link RecurringSetup}): `reported` is the
 * deployment saying what it did, and `unanswered` is nothing coming back that says.
 */
export type WalletsLevel =
	| { kind: 'reported'; report: WalletLevellingReport }
	| { kind: 'unanswered'; read: NoReport };

/** what one processor account holds for gifts that repeat. */
export type RecurringStanding = 'ready' | 'absent' | 'archived';

/**
 * what the deployment answered a read of one account with.
 *
 * `unreadable` is the read that could not be made — a rejected key, a processor that did not reply
 * — carried as a state rather than as a failure of the request, because it says nothing about what
 * the account holds. `detail` is the deployment's own sentence, which names the value to fix.
 *
 * it carries no reason beside `detail`, for the reason {@link RailsReading} carries none: a
 * standing is reported only under a processor the deployment holds the credentials for, so the one
 * thing a reason could say — that nothing was asked because no key is set — is a processor that is
 * absent from the report altogether.
 */
export type RecurringReading =
	| { state: 'unreadable'; detail: string }
	| { state: RecurringStanding };

/** where one processor's account stands, under the name the fold draws it by. */
export type ProcessorRecurring = {
	processor: PaymentProcessor;
	label: string;
	reading: RecurringReading;
};

/**
 * where every account this deployment can reach stands on gifts that repeat.
 *
 * one entry per processor the deployment holds the credentials for, in the deployment's own order.
 * empty is an answer and not a read that failed: it is every fork before any processor is set up.
 */
export type RecurringReport = { processors: ProcessorRecurring[] };

export type RecurringRead =
	| { kind: 'read'; report: RecurringReport }
	| { kind: 'unread'; read: NoReport };

/**
 * why one account's press did not land, as a closed set the fold switches on.
 *
 * `no_key` is the deployment holding none of the credentials that processor is called with, so
 * nothing was asked of the account at all: the answer to a press naming a processor whose
 * credentials were stored seconds ago, and the one worth making again in a moment. `failed` is the
 * deployment holding them and the processor refusing the call, which answers the same way every
 * time and where `detail` is what says what to do instead.
 *
 * a fact rather than a sentence read for one, for the reason {@link StripeUnreadableReason} is:
 * the prose beside it is written for an operator and free to change wording, and a fragment naming
 * one processor's variable can never match another's.
 */
export type RecurringSetupReason = 'no_key' | 'failed';

/** what the one press did to one account. */
export type ProcessorRecurringSetup = {
	processor: PaymentProcessor;
	label: string;
	/** the two successes are the same finished state said differently, and both are worth saying. */
	outcome: 'set_up' | 'already_set_up' | 'failed';
	detail: string | null;
	/**
	 * the same failure as a fact rather than as a sentence, and `null` on both arms that worked.
	 *
	 * the deployment decides it off which credentials it holds rather than off the words its payment
	 * port wrote (`packages/console/internal/deployment/recurring.go`, whose `AwaitsKey` is what
	 * reads it).
	 */
	reason: RecurringSetupReason | null;
};

/**
 * what one press to provision it did, per account it acted on.
 *
 * `outcome` is the worst of them: a donor is offered a gift that repeats only where every
 * configured processor can collect one, so one account left short is the whole press left short.
 */
export type RecurringSetupReport = {
	outcome: ProcessorRecurringSetup['outcome'];
	processors: ProcessorRecurringSetup[];
};

export type RecurringSetup =
	| { kind: 'reported'; report: RecurringSetupReport }
	| { kind: 'unanswered'; read: NoReport };

/**
 * where this deployment answers, as the binary read it out of the cloudflare account.
 *
 * no hostname is committed to this repository (CLAUDE.md), so the address is worked out from the
 * account and the worker name every time it is needed. `workersDev` is `null` where the worker
 * answers on no workers.dev address and `why` says which of the three reasons; `domains` is `null`
 * where the custom domains could not be read, which is a different sentence from the empty list
 * that means cloudflare said there are none.
 */
export type AddressRead =
	| {
			kind: 'deployed';
			workersDev: string | null;
			why: NoWorkersDev | null;
			domains: string[] | null;
	  }
	/** the worker is not in the account, which is every run before a first deploy. */
	| { kind: 'not-deployed' }
	/** the binary holds no cloudflare sign-in to read with. */
	| { kind: 'no-credential'; detail: string }
	| { kind: 'refused'; detail: string }
	| { kind: 'unreachable'; detail: string }
	| { kind: 'unreadable'; detail: string };

/** the account a pasted secret key belongs to, as the screen names it back. */
export type StripeAccount = { id: string; name: string };

/**
 * one endpoint on that account, in the facts the console acts on.
 *
 * the signing secret is deliberately not among them: it is populated only on the answer to a create
 * and absent from every other read, so a field for it would be a credential in a value a list is
 * drawn from.
 */
export type StripeEndpoint = {
	id: string;
	url: string;
	/**
	 * whether the processor is currently delivering to it.
	 *
	 * an endpoint that exists and is switched off is the shape that reads as a finished setup while
	 * nothing ever arrives, and the processor switches one off itself after a run of failures.
	 */
	delivering: boolean;
	eventTypes: string[];
	/** the stamp the signing secret's fingerprint was written under, or `null` where it carries none. */
	fingerprint: string | null;
};

/** who the secret key belongs to — what the screen says back. */
export type StripeNamed = {
	account: StripeAccount;
};

/**
 * what the press did about the endpoint.
 *
 * there is no arm for leaving one alone, and that is the decision the chain turns on: the press
 * re-establishes the endpoint against the pair of keys it was given, because an endpoint already at
 * this address belongs to whatever pair came before it — and because the processor hands a signing
 * secret over once, so an endpoint that is kept is one nothing can store a secret for.
 */
export type StripeRegistration = {
	kind: 'created' | 'replaced';
	id: string;
	stamped: boolean;
	/** the endpoint that was there, on `replaced` alone. */
	replaced: StripeEndpoint | null;
};

/** what the chain found out along the way, which the fold states beside its lines. */
export type StripeFacts = {
	named: StripeNamed | null;
	registration: StripeRegistration | null;
	/** endpoints on this account carrying this deployment's path at some other address. */
	elsewhere: StripeEndpoint[];
};

/**
 * the ways a call to the processor did not answer, which are the ones a screen has a sentence for.
 *
 * `refused` is a key it would not accept, and the way out is the box the key was typed in;
 * `rejected` is a request it understood and would not carry out, and the detail names what was
 * wrong; `unreachable` is nothing found out either way, a 5xx included.
 */
export type StripeFailure = {
	kind: 'refused' | 'rejected' | 'unreachable' | 'unreadable';
	detail: string;
};

/**
 * which part of the chain is running.
 *
 * every one of them is the chain arriving at a call it makes itself, which is observed by having
 * made it. `publishing` is a settings patch and seconds rather than a deploy: a var is written in
 * place, with every secret held where it stands.
 */
export type StripeStage =
	| 'naming'
	| 'registering'
	| 'storing'
	| 'publishing'
	| 'repeating'
	| 'covering';

/**
 * the two acts that are a run.
 *
 * a removal is neither: it is one write of the deployment's own credentials and seconds, so it goes
 * through the same door as any other credential and is answered where it was pressed.
 */
export type StripeRunAct = 'errand' | 'publish';

/**
 * how the chain ended.
 *
 * every arm but `done` carries the answer of the step that stopped it, whole: each of those answers
 * already tells a refused key from a processor nothing could reach, and the fold draws it at the
 * line the stage belongs to rather than as one sentence about a press that failed.
 */
export type StripeSetup =
	/** every step landed. */
	| { kind: 'done' }
	/** the secret key could not name an account, so nothing was read, created or stored. */
	| { kind: 'unnamed'; failure: StripeFailure }
	/** there is nowhere to register against, and the address read is what says why. */
	| { kind: 'nowhere'; address: AddressRead }
	/** the account's endpoints could not be read, so nothing was deleted or created. */
	| { kind: 'unlisted'; failure: StripeFailure }
	/** the endpoint being replaced could not be deleted, so the account is exactly as it was. */
	| { kind: 'undeleted'; endpoint: StripeEndpoint; failure: StripeFailure }
	/**
	 * the processor would not create the endpoint.
	 *
	 * `gone` is the endpoint this press had already deleted, and is the whole reason this arm
	 * carries anything: the deployment now receives nothing at all.
	 */
	| { kind: 'uncreated'; gone: StripeEndpoint | null; failure: StripeFailure }
	/**
	 * the endpoint exists on the account and its signing secret is stored nowhere.
	 *
	 * `no-secret` is the processor creating it and answering with none; `not-stored` is the secret
	 * being in hand and the deployment refusing it, and `written` is that write's own answer.
	 */
	| { kind: 'unkept'; endpointId: string; why: 'no-secret'; written: null }
	| { kind: 'unkept'; endpointId: string; why: 'not-stored'; written: VarsUnwritten }
	/**
	 * the deployment could not put the repeating-gift item on the account.
	 *
	 * everything in front of it landed, so what it leaves is a deployment that serves a donation
	 * form and takes one-time gifts.
	 *
	 * `awaitingKey` is that refusal being the deployment not holding the secret key yet: the store
	 * landed seconds earlier and its edge has not caught up. `setup` still carries what the
	 * deployment said, and on that arm it is not drawn — the sentence names a value this press has
	 * already set.
	 */
	| { kind: 'unrepeating'; setup: RecurringSetup; awaitingKey: boolean }
	/**
	 * the deployment could not register the hostnames wallet buttons are drawn on.
	 *
	 * everything in front of it landed, so what it leaves is a deployment taking gifts on every rail
	 * but Apple Pay, Google Pay and Link.
	 *
	 * **a hostname the processor refused is not this arm.** that is one line of a levelling that
	 * worked, drawn where the hostnames are; this is the press not answered at all, or answered with
	 * the account read that opens it not landing. `awaitingKey` is that second one being the
	 * deployment not holding the secret key yet, and means what it means on `unrepeating`.
	 */
	| { kind: 'uncovered'; levelled: WalletsLevel; awaitingKey: boolean }
	/** everything on the processor account landed and the publishable key was not written. */
	| { kind: 'not-published'; published: VarsUnwritten }
	/**
	 * the console failed part way through the press, and how far it got was not observed.
	 *
	 * its own arm and never one of the nine the chain reaches: every one of those is a step
	 * answering, and a run that died on the console's own goroutine answered nothing — so an arm
	 * borrowed from one would be a claim about the processor account that nothing observed. it
	 * carries no member, and the press it died inside was holding a secret key
	 * (`packages/console/internal/stripe/run.go`).
	 */
	| { kind: 'console-stopped' };

/**
 * what the fold reads off the run, which is a stage and its facts and never the chain.
 *
 * on an ended run `stage` is the one the chain stopped at, which is the line the failure is drawn
 * under.
 */
export type StripeRunRead =
	| { kind: 'running'; act: StripeRunAct; stage: StripeStage; facts: StripeFacts }
	| {
			kind: 'ended';
			act: StripeRunAct;
			stage: StripeStage;
			facts: StripeFacts;
			outcome: StripeSetup;
	  };

/**
 * what a press to set the processor up was answered with.
 *
 * `started` is false where a run is already going: the binary answers the press with the one it is
 * holding rather than starting a second, because two chains racing each other would leave the
 * account holding whichever endpoint was created last and the deployment holding whichever secret
 * was stored last.
 */
export type StripeStarted =
	/** the chain is going, or one already was — either way this is the run to draw. */
	| { started: boolean; run: StripeRunRead }
	/**
	 * the binary's own door would not take the pair, so no run began and there is nothing to poll.
	 *
	 * it keeps one reading of its own about the published slot, because whatever lands there is
	 * handed to every browser that asks for a donation form and the browser is not the guard
	 * (`asking` in `packages/console/internal/server/stripe.go`). the pair reaches Stripe not at
	 * all, so what a screen has to say about it is the same sentence a key Stripe turns down gets
	 * and there are no words of Stripe's to quote.
	 */
	| { started: false; turnedDown: true }
	/**
	 * the binary could not write at all — this machine holds no cloudflare sign-in — so no run
	 * began (`writing` in `packages/console/internal/server/values.go`).
	 */
	| { started: false; unwritten: ValuesRefusal };

/** one webhook listener on a PayPal app, in the facts the console acts on. */
export type PaypalListener = { id: string; url: string; eventTypes: string[] };

/**
 * the ways a call to PayPal did not answer.
 *
 * `refused` is a pair PayPal would not accept or an app it would not let do this, and the way out
 * is the boxes the pair was typed in; `rejected` is a request it understood and would not carry
 * out; `unreachable` is nothing found out either way, a 5xx included.
 */
export type PaypalFailure = {
	kind: 'refused' | 'rejected' | 'unreachable' | 'unreadable';
	detail: string;
};

/**
 * which part of the PayPal chain is running (`packages/console/internal/paypal/setup.go`).
 *
 * `registering` is the address derived, the app's listeners read and the one here settled;
 * `storing` is the pair and that listener's id written onto the deployment in one write.
 */
export type PaypalStage = 'authorizing' | 'registering' | 'storing';

/**
 * what the press did about the listener at this deployment's address.
 *
 * `kept` and `resubscribed` are both a listener already here: a PayPal delivery is verified by the
 * listener's own id, which every list hands back, so one already here is kept rather than replaced.
 */
export type PaypalRegistration = { kind: 'created' | 'kept' | 'resubscribed'; id: string };

export type PaypalFacts = {
	registration: PaypalRegistration | null;
	/** listeners on this app carrying this deployment's path at another address, named and never touched. */
	elsewhere: PaypalListener[];
};

/**
 * how the PayPal chain ended.
 *
 * the wire is flat — every field on every answer, empty where a kind says nothing about it — and
 * this is it read per kind. **every stop in front of `storing` wrote nothing**: the pair and the
 * listener id are one write at the end, so a deployment is never left holding a pair with no
 * listener behind it.
 */
export type PaypalSetup =
	| { kind: 'done' }
	/** the pair minted no token, so nothing was read, registered or stored. */
	| { kind: 'unauthorized'; failure: PaypalFailure }
	/** there is nowhere to register against, and the address read says why. */
	| { kind: 'nowhere'; address: AddressRead }
	/** the deployment's address is not https, which PayPal delivers to nothing but. */
	| { kind: 'insecure'; origin: string }
	/** the app's listeners could not be read. */
	| { kind: 'unlisted'; failure: PaypalFailure }
	/** the app already holds PayPal's ten listeners, none of them here; `listeners` is all ten. */
	| { kind: 'full'; listeners: PaypalListener[] }
	/** PayPal refused the create, so nothing listens here. */
	| { kind: 'uncreated'; failure: PaypalFailure }
	/** PayPal refused to bring the listener here to the list; it is still subscribed as it was. */
	| { kind: 'unresubscribed'; listenerId: string; failure: PaypalFailure }
	/** the listener is settled and the write did not land; the next press finds and keeps it. */
	| { kind: 'unstored'; listenerId: string; written: VarsUnwritten }
	/** the console failed part way through, and how far it got was not observed. carries nothing. */
	| { kind: 'console-stopped' };

/** what the section reads off the PayPal run. on an ended run `stage` is the one it stopped at. */
export type PaypalRunRead =
	| { kind: 'running'; stage: PaypalStage; facts: PaypalFacts; outcome: null }
	| { kind: 'ended'; stage: PaypalStage; facts: PaypalFacts; outcome: PaypalSetup };

/**
 * what a press to set PayPal up was answered with.
 *
 * `started` is false where a run is already going, and that run is the one to draw.
 */
export type PaypalStarted =
	| { started: boolean; run: PaypalRunRead }
	/** the binary's door would not take the pair, so no run began. */
	| { started: false; turnedDown: true }
	/**
	 * the binary could not write at all — this machine holds no cloudflare sign-in — so no run
	 * began (`writing` in `packages/console/internal/server/values.go`).
	 */
	| { started: false; unwritten: ValuesRefusal };

/**
 * which way the account's own turnstile widgets were not read.
 *
 * `no-credential` is its own member and never a refusal: a refusal is "member, not administrator"
 * and sends an operator to ask an administrator for access they already have, and what is true here
 * is that this machine is signed out.
 */
export type WidgetNoList = {
	kind: 'refused' | 'unreachable' | 'no-credential';
	detail: string;
};

/**
 * one of the four ways a widget request did not answer with a widget.
 *
 * `unreadable` carries no detail, and that is deliberate rather than an omission: every success on
 * these three requests is the widget whole, pair included, so every character of that body is a
 * credential until proven otherwise and the sentence an operator reads is the screen's own.
 */
export type WidgetFailure = {
	kind: 'refused' | 'failed' | 'unreachable' | 'unreadable';
	detail: string;
};

/**
 * what happened to cloudflare's copy of the site list.
 *
 * flat rather than a member per kind, which is what the wire is. `level` and `levelled` are the two
 * that end with the two lists the same; everything else says which way this console could not get
 * them there, and none of them is a claim about a donor passing a challenge — what is reported is
 * what the binary read and wrote.
 *
 * `unasked` is the one member the binary never writes: it is the page's own, for a press whose list
 * the deployment did not take, so cloudflare was never reached at all.
 */
export type WidgetLevel = {
	kind:
		| 'level'
		| 'levelled'
		| 'unasked'
		| 'nothing'
		| 'no-widget'
		| 'many'
		| 'unread'
		| WidgetFailure['kind'];
	/** the hosts the widget carries now, on `level` and `levelled`. */
	domains: string[];
	/** the widgets carrying this deployment's name, on `many` alone. */
	sitekeys: string[];
	/** which way the account's list was not read, on `unread` alone. */
	read: WidgetNoList | null;
	/** cloudflare's own words about the call, and empty where it wrote none. */
	detail: string;
};

/**
 * what one press of Save sites did, on the deployment and on the account.
 *
 * `wallets` is `null` for a press whose list the deployment did not take, which is the page's own
 * member exactly as `unasked` is on {@link WidgetLevel}: the registration is levelled behind the
 * list that was stored, so a press that stored nothing reached the processor not at all.
 */
export type SitesPress = {
	written: SitesWrite;
	widget: WidgetLevel;
	wallets: WalletsLevel | null;
};

/**
 * the release this binary was built as.
 *
 * **it is the one fact the console holds that is true without a cloudflare account.** everything
 * else here is scoped to one — the database, the worker, the address, the session — so this is what
 * the foot carries on every screen, the one that says the console has stopped included
 * (../lib/product-foot.tsx).
 *
 * both are empty on a binary built from a checkout rather than a tagged release, and empty is also
 * what a reading nobody could take answers with (../api/client.ts): the strip draws no line for
 * either.
 */
export type ConsoleVersion = {
	version: string;
	commit: string;
};
