// the `/api/v1` shapes the flow machine is allowed to know, and nothing else.
//
// this file is the flow's only view of the backend, and that is a boundary rather than a
// convenience. the form is served from the deployment it talks to, so the two can never be a
// version apart — but the same modules are meant to be extractable as a package a third party
// installs, and such a consumer pins a version while the deployment moves on. what bounds that
// drift is this file naming nothing outside it. the moment a type here widens to something
// deployment-internal, the bound is gone and nobody notices until a donation page breaks on a
// site we cannot reach.
//
// while Standalone is alpha (AGENTS.md → Public surface while Standalone is alpha) `v1` may
// change in place: no `v2` alongside and no backward-compatibility code. a field may be renamed,
// retyped or removed, and the `as const` arrays change with it.
//
// not under `src/lib/server/**`, and more strongly than `../contacts/kinds.ts` is: this module is
// consumed by code that runs on a stranger's website. it imports nothing — no framework, no
// DOM, no Stripe SDK — and it never will.
//
// minor units always, with the unit in the name. CLAUDE.md fixes that encoding for the ledger
// and the wire shares it for the reason the ledger has it: a float dollar amount is a rounding
// error that reconciles to nothing. the `Minor` suffix is why `suggestedAmountsMinor` reads
// more awkwardly than `suggestedAmounts` would, and it is worth the awkwardness.

/**
 * how often the gift repeats.
 *
 * one flat list of suggested amounts across all three, which is the rule this union's
 * existence makes tempting to break: $250 is $250, and the frequency control is what says how
 * often it repeats. the cost, recorded so it is not rediscovered, is that an org cannot say
 * "$1,000 one-time is fine, $1,000/month is not" — they pick amounts that read sanely at every
 * frequency they enable. keying `suggestedAmountsMinor` by frequency is the change that looks
 * obvious later and would change the shape of the config.
 */
export const FREQUENCIES = ['one_time', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * what a frequency is called on the radio a donor reads.
 *
 * keyed by `Frequency` rather than `string`, so a fourth frequency is a type error here
 * rather than a raw `one_time` rendered by a `?? value` fallback — the same reason
 * `KIND_LABELS` is keyed by `ContactKind`.
 */
export const FREQUENCY_LABELS: Record<Frequency, string> = {
	one_time: 'One-time',
	monthly: 'Monthly',
	yearly: 'Yearly'
};

/**
 * which of the two a gift given for someone else is.
 *
 * american spelling, token and label alike: `honor`, and the endpoint refuses `honour` as a near
 * miss (`parseTribute` in `packages/app/src/lib/server/donations/quote-input.ts`). the two members
 * exist to slot into "in ___ of", which is what `TRIBUTE_KIND_LABELS` below writes out.
 *
 * a closed vocabulary on the wire, and the only thing
 * holding a stored `donation.tribute_kind` to it is a check the app makes on the way in — the
 * column carries no constraint and cannot be given one. it is also the app's one list: every
 * surface there imports it from here rather than from a copy of its own.
 */
export const TRIBUTE_KINDS = ['honor', 'memory'] as const;
export type TributeKind = (typeof TRIBUTE_KINDS)[number];

/**
 * what a kind is called on the control a donor reads.
 *
 * keyed by `TributeKind` rather than `string`, for `FREQUENCY_LABELS`' reason: a third kind is a
 * type error here rather than a raw `memory` rendered through a `?? value` fallback.
 */
export const TRIBUTE_KIND_LABELS: Record<TributeKind, string> = {
	honor: 'In honor of',
	memory: 'In memory of'
};

/**
 * the cause a gift is credited to, in the two shapes a form can carry.
 *
 * absent is a form with no program at all, which is the ordinary one, and it is the whole of how
 * that is said — there is no third mode meaning "none", for `tributeKind`'s reason above: a mode
 * standing for an absence is a value every reader has to remember is not one.
 *
 * `pinned` carries the name and no id. the form is for one cause, the server writes that pin onto
 * the gift from the form record, and a client that sent an id back would be offering to overwrite a
 * decision it was only told about — so what the wire carries here is what a donor reads and nothing
 * a request is built from.
 *
 * `choice` carries the ids, because there the donor picks and the pick has to travel. the options
 * are the form's own list in the org's own order, which is the order they are drawn in: this is a
 * set of causes rather than a vocabulary, so unlike `PAYMENT_METHODS` above there is nothing here
 * for a client to order it against.
 *
 * an empty `options` is read as no program at all (./config.ts): a select drawn over nothing is a
 * question with no answers, and the gift goes where it is needed most either way.
 */
export type Program =
	| { readonly mode: 'pinned'; readonly name: string }
	| {
			readonly mode: 'choice';
			readonly options: readonly { readonly id: string; readonly name: string }[];
	  };

/**
 * what a gift with no cause chosen is called, wherever one is stated.
 *
 * a name for the absence, which is what puts it beside the two label tables above rather than in a
 * renderer: the option a picker rests on and the line a receipt states are two readings of one
 * answer, and a second copy of these words is a card that offers one wording and confirms another.
 *
 * it is not a member of anything and travels on no request — an absent `programId` is how the
 * endpoint is told this, so nothing is ever parsed back out of these words.
 */
export const NO_PROGRAM_LABEL = 'Where it’s needed most';

/**
 * the fiscal sponsor a gift is given to, where the organisation supported is sponsored rather than
 * a charity in its own name.
 *
 * the sponsor is the donee, and the recipient of any `Contribution` below. where `FormConfig.sponsor`
 * is present, `FormConfig.ein` and `FormConfig.deductibilityStatement` are the sponsor's, and
 * `FormConfig.orgLegalName` stays the organisation the gift supports.
 */
export type Sponsor = { readonly legalName: string; readonly ein: string };

/**
 * a contribution to the `Sponsor` above, asked beside the gift, as rates of it.
 *
 * a deployment offers one only beside a `sponsor`, and ./config.ts drops one that arrives without
 * a sponsor. what the donor chose travels as `QuoteRequest.contributionMinor`, in minor units
 * rather than as a rate, and the quote answers it as `Quote.contributionMinor`.
 */
export type Contribution = {
	/** rates of the gift, as fractions. a custom amount is always allowed beside them. */
	readonly options: readonly number[];
	/** the option the row starts on. absent is a row that starts off. */
	readonly startsAt?: number;
};

/**
 * how the donor is asked to cover the processing fee.
 *
 * one mode: the receipt's fee line renders as a decision the donor makes, on a control that states
 * which way it is set, and it is the donor's to turn off from a default of covered. a fee added to a
 * gift without the donor agreeing to it is a charge they did not consent to, and that is not
 * something this project offers an org a setting for — so the field carries a vocabulary of one
 * rather than a boolean, and a second reading would be a member added here.
 *
 * a config naming anything else reads as this mode: ./config.ts is where that is done, and it is
 * the direction that leaves the decision with the donor.
 */
export const FEE_COVERAGE_MODES = ['optional'] as const;
export type FeeCoverage = (typeof FEE_COVERAGE_MODES)[number];

/**
 * every rail a config may report, as `/api/v1/forms/:id/config` names them.
 *
 * the whole vocabulary and never the list a given response carries: which of these a deployment
 * offers is that deployment's own decision and no part of this contract — the one serving this
 * repository is `OFFERED_PAYMENT_METHODS` in `src/lib/forms/offered-rails.ts`, and it is shorter than
 * this. the machine must never assume a member of this union is available: it reads
 * `config.paymentMethods` as data, and `methodIsChargeable` in ./value.ts is where that is
 * enforced.
 *
 * more than one processor's rails, and no rail is offered by two of them: `card`, `ach` and the
 * wallets are settled by the processor whose fields the card draws inline, `paypal` and `venmo` by
 * the processor whose own window collects them, `daf` by the processor whose window asks the
 * donor's fund for a grant, and `crypto` by the processor that mints an address the donor sends a
 * coin to. `STRIPE_RAILS`, `PAYPAL_RAILS`, `CHARIOT_RAILS` and `NOWPAYMENTS_RAILS` in
 * ./embed/rails.ts are that split written down, and `providers` on `FormConfig` below is the field that lets one
 * config name more than one.
 *
 * `stock` and `ira_qcd` are no processor's: a donor pledges a gift their broker or IRA custodian
 * sends later, and the organisation's staff mark it received (`PLEDGE_RAILS` in ./embed/rails.ts).
 * a quote on either is a pledge saved — `Quote.pledge` below — and nothing is charged.
 */
export const PAYMENT_METHODS = [
	'card',
	'ach',
	'apple_pay',
	'google_pay',
	'paypal',
	'venmo',
	'daf',
	'crypto',
	'stock',
	'ira_qcd'
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * what a rail is called where a donor is shown one.
 *
 * `ach` is the schema's word and never the donor's — CLAUDE.md keeps table vocabulary off a
 * screen, and "ACH" is exactly the kind of initialism a fundraiser's donor does not use.
 *
 * `paypal` and `venmo` are the two a donor does read as the processor's own name, because that is
 * what a donor is being sent to: the word on the control is the brand whose window opens.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	card: 'Card',
	ach: 'Bank account',
	apple_pay: 'Apple Pay',
	google_pay: 'Google Pay',
	paypal: 'PayPal',
	venmo: 'Venmo',
	daf: 'Donor-advised fund',
	crypto: 'Crypto',
	stock: 'Stocks',
	ira_qcd: 'IRA (QCD)'
};

/**
 * the subset whose own sheet is the consent moment.
 *
 * a wallet is a way of presenting a card rather than a rail of its own, and that is the whole of
 * what this names: the `wallets` hash in ./embed/stripe.ts draws each of these inside the
 * provider's own box where the deployment offers it, `RAILS` in ./embed/rails.ts maps it onto the
 * card wire type, and the sheet opens at confirmation rather than at the press — the donor picks
 * the wallet as an option, presses the form's own control, and the quote is minted before any
 * authorization is taken. Link is drawn by that same hash and is deliberately not a member here:
 * it has no name in `PAYMENT_METHODS` above, and `chosenRail` in ./embed/stripe.ts quotes a donor
 * who picks it on the card rail.
 *
 * `satisfies` rather than an annotation, so this stays a two-member literal union and is
 * checked to be a subset of `PAYMENT_METHODS`. A wallet added to one list and not the other is
 * then a compile error rather than a rail nothing prices.
 */
export const WALLET_METHODS = [
	'apple_pay',
	'google_pay'
] as const satisfies readonly PaymentMethod[];
export type WalletMethod = (typeof WALLET_METHODS)[number];

/**
 * a processor's price for one rail: a proportion of the total plus a flat charge, the proportion
 * optionally bounded.
 *
 * a rule, not an amount, and that is the whole point. a fee rate hardcoded into the client is
 * wrong the day Stripe prices one method differently from another, so the rate arrives per
 * method and from the server, and what the client computes from it is an *estimate*: the figure
 * the form states before authority has spoken, and the one `reconcile` measures the authoritative
 * total against. see ./fee.ts.
 *
 * `percent` is a fraction (0.029), never 2.9 — a percentage stored as a percentage is the
 * classic hundred-fold error, and here it would be a hundred-fold error on the screen asking
 * for money.
 *
 * the price of a card and the price of a bank debit are different shapes, which is why the cap
 * is on the rule rather than on the rail: `{ percent: 0.029, fixedMinor: 30 }` prices a card and
 * `{ percent: 0.008, fixedMinor: 0, capMinor: 500 }` prices US ACH. without the bound, every
 * bank-debit gift past the cap quotes a fee larger than the one the processor takes, which is an
 * over-collection stated on the screen that asks for money.
 */
export type FeeRule = {
	readonly percent: number;
	readonly fixedMinor: number;
	/**
	 * the ceiling on the proportional part alone, absent where the rail has none.
	 *
	 * the flat charge is still added above it: the fee is
	 * `min(proportional, capMinor) + fixedMinor`. a cap read as bounding the whole fee would
	 * quote under what the processor takes on a rail priced with both, and the shortfall is the
	 * org's.
	 */
	readonly capMinor?: number;
	/**
	 * the step the whole fee is rounded up to, absent where the rail charges to the minor unit.
	 *
	 * applied last, to `min(proportional, capMinor) + fixedMinor`: a DAF grant's price is
	 * `{ percent: 0.029, fixedMinor: 0, roundUpMinor: 100 }`, 2.9% rounded up to a whole dollar.
	 */
	readonly roundUpMinor?: number;
};

/**
 * the fee rule per rail, because Stripe's price is not one number.
 *
 * total over `PaymentMethod`, so a rail added to the union without a price is a type error
 * rather than a fee line that silently reads zero.
 */
export type FeeRules = Readonly<Record<PaymentMethod, FeeRule>>;

/** the org-authored monthly-ask copy, absent when the org has not enabled the interstitial. */
export type MonthlyAsk = {
	readonly headline: string;
	readonly body: string;
	/**
	 * what the donor is asked to give per month instead.
	 *
	 * org-authored and server-supplied, never derived from the one-time amount. a computed
	 * "increase your impact by 2.4×" figure puts an unmeasured impact claim in a nonprofit's
	 * mouth, on the screen where money moves, generated by software the nonprofit did not
	 * write — so the org says what it can defend, and a multiplier computed here would be the
	 * same claim wearing arithmetic.
	 */
	readonly askAmountMinor: number;
};

/**
 * one payment provider this deployment uses, and the public key its SDK is initialised with.
 *
 * the vendor is data, not a field name. `name` is what tells an adapter which SDK to reach for,
 * so the contract can carry a provider without a field named after one.
 *
 * `name` is a string rather than a union of the processors this repository has an adapter for,
 * and that is the same decision: a deployment naming a processor this snippet does not know draws
 * the rails it does know and no screen renders a word it cannot place.
 *
 * neither field is secret, by construction: both are embedded in public HTML on the org's site,
 * and a publishable key is designed to be.
 */
export type Provider = {
	readonly name: string;
	readonly publishableKey: string;
	/**
	 * the script this processor's SDK is loaded from, absent where the adapter's own default is the
	 * one to load.
	 *
	 * the deployment states it because a publishable key starts an SDK only against the address it
	 * was issued at, and the deployment is what knows that address. an absolute `https:` url
	 * whose path is {@link PAYPAL_SDK_PATH} — ./config.ts refuses the entry for anything else — so
	 * the one script a served config can point a stranger's page at is PayPal's core, from whichever
	 * host serves it.
	 */
	readonly sdkUrl?: string;
};

/** the path PayPal serves the core of its v6 SDK at, on every host that serves it. */
export const PAYPAL_SDK_PATH = '/web-sdk/v6/core';

/**
 * one coin the deployment's crypto account takes, as a donor picks it.
 *
 * `coin` is NOWPayments' own code, lowercased (`usdttrc20`), and it is the value `QuoteRequest.coin`
 * carries back — never the ticker, which names the base asset and is shared by the same asset on
 * several chains. `ticker` is NOWPayments' ticker, lowercased (`usdt`), for display and search only;
 * `coin` still identifies the coin. `network` is the network's own words, already derived from the
 * processor's list by the deployment, and is shown beside the ticker because a deposit sent on the
 * wrong chain reaches no gift. `memoRequired` says a deposit without the payment's memo cannot be
 * matched at all; where it is false the quote's `Deposit.memo` still says whether that one payment
 * carries one.
 *
 * the last three are what a row *shows* rather than what a gift is built from, and all three are
 * optional: a deployment serving none draws the list it drew before. nothing here is ever
 * assembled from `coin` or `ticker` — a logo path built out of a code and a flag read off a list
 * of coins this repo calls popular are both a table somebody has to maintain and forgets to, and
 * the whole of what these three carry is the processor's own answer.
 *
 * `logo` is that processor's own path for the coin, absolute and `https:`, which ./config.ts refuses
 * anything else for: the row is drawn into a page this project does not own, so a relative path
 * resolves against the host's origin and asks a stranger's site for an image it does not serve.
 *
 * `popular` and `stablecoin` are the processor's own flags for the coin: what its list says about
 * the coin, reported here whether or not a surface draws them.
 */
export type PayableCoin = {
	readonly coin: string;
	readonly ticker: string;
	readonly name: string;
	readonly network: string;
	readonly memoRequired: boolean;
	readonly logo?: string;
	readonly popular?: boolean;
	readonly stablecoin?: boolean;
};

/**
 * `GET /api/v1/forms/:id/config` — everything the form cannot know and the backend owns.
 *
 * nothing here is secret, by construction: it is embedded in public HTML on the org's site.
 *
 * untrusted JSON, and the type is a description rather than a guarantee. It arrives over the
 * network into code running on a stranger's page, so a field the type calls required may be
 * absent at runtime — `feeRules` missing one rail is the case that actually happens. Every
 * reader in this directory degrades on that rather than throwing, because an exception here
 * stops a donation form from working at all.
 *
 * the legal identity fields are neither optional nor cosmetic. `orgLegalName`, `ein` and
 * `deductibilityStatement` are the one thing the form cannot know and is not allowed to omit
 * from a screen that solicits a tax-deductible gift, which is why they are required strings
 * here rather than `?`.
 */
export type FormConfig = {
	readonly formId: string;
	/**
	 * every processor this deployment takes gifts through, one entry each.
	 *
	 * a set rather than the one provider, because the rails on `paymentMethods` below are not all
	 * one processor's: a deployment holding both offers the inline card fields and the hosted
	 * window side by side, and each adapter needs its own publishable key. a deployment holding one
	 * says exactly what it said before, as the single entry — nothing about a one-processor config
	 * is longer or differently shaped than it was.
	 *
	 * never empty: a config that names no processor is one nothing can be charged through, and
	 * ./config.ts drops it rather than rendering a form that collects and then cannot send.
	 *
	 * ordered by the deployment and read by name, never by position — `STRIPE_RAILS` and
	 * `PAYPAL_RAILS` in ./embed/rails.ts say which rails an adapter draws, and `name` above says
	 * which entry is its own.
	 */
	readonly providers: readonly Provider[];
	readonly currency: string;
	readonly suggestedAmountsMinor: readonly number[];
	readonly minAmountMinor: number;
	readonly maxAmountMinor: number;
	readonly frequencies: readonly Frequency[];
	/**
	 * the rails a donor may pick here.
	 *
	 * `stock` and `ira_qcd` are listed exactly while the organisation has turned each on under
	 * Payments, `stock` only once a ticker list is held as well (`offersStock` in the app's
	 * `src/lib/server/forms/published-config.ts`), each priced by a zero rule in `feeRules`, and
	 * neither takes a gift that repeats. `ira_qcd` is a row in the review step's payment box. `stock`
	 * is not: the payment box draws no row for it, and no screen in this package sends a stock pledge
	 * (`steer` in ./element.ts).
	 */
	readonly paymentMethods: readonly PaymentMethod[];
	readonly feeCoverage: FeeCoverage;
	readonly feeRules: FeeRules;
	readonly locale: string;
	readonly orgLegalName: string;
	/** the sponsor's, where `sponsor` below is present; the organisation's otherwise. */
	readonly ein: string;
	/** the sponsor's, where `sponsor` below is present; the organisation's otherwise. */
	readonly deductibilityStatement: string;
	/**
	 * whether a gift that landed is followed by an emailed receipt.
	 *
	 * present only when the response's `receipts` is boolean true (`readFormConfig` in ./config.ts).
	 * absent, the thank-you in ./views.ts names who has the gift and does not say a receipt is on
	 * its way. the review step names the address only when this is true. when the donor gave an
	 * address and this is not true, that step says no email will be sent.
	 */
	readonly receipts?: boolean;
	readonly turnstileSiteKey?: string;
	/**
	 * where a fresh ALTCHA challenge is read from, on a deployment whose spam check is ALTCHA.
	 *
	 * a path, resolved against the address this config was read from. a deployment serves exactly
	 * one of this and `turnstileSiteKey`, and this is the one a deployment holding no Turnstile pair
	 * serves; `createChallenge` in ./embed/challenge.ts is what reads which.
	 */
	readonly altchaChallengeUrl?: string;
	readonly monthlyAsk?: MonthlyAsk;
	/** the cause this form's gifts are credited to, absent where it has none. */
	readonly program?: Program;
	/**
	 * the coins a `crypto` gift may be sent in, absent where the rail is not offered.
	 *
	 * on this response rather than on an endpoint of its own. which coins an account takes is a
	 * capability, and the served config is already edge-cached as one (CLAUDE.md → *Storage*), so the
	 * list arrives with the boot the form makes anyway. a separate read under `/api/v1` would owe
	 * CORS, rate limiting, Turnstile and server-side bounds (CLAUDE.md → *Bans*) for data this
	 * response already carries.
	 *
	 * a coin's minimum and price cap are not here and never will be: both are numbers that move with
	 * the coin's price, and a cached number is a stale one. the quote refuses them by name instead —
	 * `below_minimum` and `above_maximum` in `API_ERROR_CODES` below.
	 *
	 * ./config.ts reads an empty or unreadable list as none, and a config offering `crypto` with no
	 * coin to pick as one not offering it.
	 */
	readonly coins?: readonly PayableCoin[];
	/**
	 * the fiscal sponsor that is the donee, absent where the organisation receives gifts in its own
	 * name.
	 *
	 * present, it is the contribution's recipient too, `ein` and `deductibilityStatement` above are the
	 * sponsor's, and `orgLegalName` stays the organisation supported. its `ein` is the config's own
	 * `ein`, and ./config.ts refuses a config naming a sponsor it cannot read, or one whose `ein`
	 * differs in its digits, since either states an identity for a donee the config does not name.
	 */
	readonly sponsor?: Sponsor;
	/**
	 * the contribution to `sponsor` a donor is asked for beside the gift, absent where none is asked.
	 *
	 * a deployment offers one only beside a `sponsor`. ./config.ts drops one that arrives without a
	 * sponsor, or whose rates it cannot read, and the form asks for the gift alone.
	 */
	readonly contribution?: Contribution;
};

/**
 * the provider-supplied wording a donor must accept before their bank account is debited.
 *
 * the provider's words, never ours. The text authorizes a debit, which makes it a legal
 * instrument, and writing one on the org's behalf is not something this project does. It
 * arrives with the quote rather than with config because it names the amount being authorized.
 */
export type Mandate = {
	readonly text: string;
};

/**
 * where and how much a donor sends on a `crypto` gift, as the quote hands it over.
 *
 * typed beside `Quote.paymentToken` rather than packed inside it: the element, the donation page and
 * the pending-payment email each read these, and an opaque token would be a parser per reader.
 *
 * `coinAmount` is text, a canonical positive decimal (`^(0|[1-9]\d*)(\.\d*[1-9])?$`), and never a
 * number. a coin carries more precision than a double keeps, and the figure is what the donor types
 * into a wallet — a digit lost to a float is an address paid the wrong amount. it is shown and never
 * computed with.
 *
 * `giftCoinAmount` is the same kind of text for the gift alone — `coinAmount` less the fee the donor
 * covered — and is absent where the quote does not state it, in which case the screen states the
 * total alone. one field rather than two: the fee is the difference between the two figures, and a
 * third figure on the wire is a third thing that can disagree with the other two.
 *
 * `memo` is null where the payment carries none, and a screen never drops one that is present: a
 * deposit to a memo coin's address without it cannot be matched to the gift.
 *
 * `validUntil` is ISO 8601 text, when the address stops being watched for this payment.
 *
 * `qr` is the address alone as a module matrix, encoded on the server so the embed ships no encoder:
 * one string per row, each character `'1'` for a dark module and `'0'` for a light one, square, with
 * no quiet zone — the renderer draws the margin.
 */
export type Deposit = {
	readonly address: string;
	readonly memo: string | null;
	readonly coin: string;
	readonly network: string;
	readonly coinAmount: string;
	readonly giftCoinAmount?: string;
	readonly validUntil: string;
	readonly qr: { readonly rows: readonly string[] };
};

/**
 * `POST /api/v1/forms/:id/donations` — the authoritative fee, total and payment token.
 *
 * the authority half of the reconciliation. whatever ./fee.ts estimated from the rule,
 * these are the numbers the donor is actually charged, and a difference between them is
 * something the correction screen states out loud rather than an overwrite nobody sees.
 *
 * minted per attempt rather than per form arrival, which is why this shape belongs to a submit
 * rather than to load, and why the machine holds no quote until one is pressed.
 *
 * untrusted JSON, like `FormConfig`. `quoteIsUsable` in ./fee.ts is what the machine puts in
 * front of it, because both numbers here are rendered as a claim about what the donor is about
 * to be charged.
 */
export type Quote = {
	/**
	 * the opaque token this attempt is confirmed with.
	 *
	 * meaningful only to the adapter that implements the payment port, which is why it is named
	 * for what it does rather than for what one provider calls it.
	 */
	readonly paymentToken: string;
	readonly feeMinor: number;
	readonly totalMinor: number;
	/** present only on a rail that requires an authorization the donor must accept first. */
	readonly mandate?: Mandate;
	/**
	 * present exactly on a `crypto` quote, and what the donor is shown to pay it.
	 *
	 * on that rail nothing is confirmed after the quote: the donor sends the coin, and
	 * `paymentToken` is the donation id `DonationStatus` below is read by.
	 */
	readonly deposit?: Deposit;
	/**
	 * the absolute address of this gift's own page, `{origin}/gift/{token}`, where the donor finds
	 * what an employer's matching portal asks for.
	 *
	 * present when the deployment has the gift page and the mail behind it, and absent otherwise; the
	 * thank-you asks for the donor's employer only where it is present. its last path segment is the
	 * `:token` `EmployerRequest` below is posted to.
	 */
	readonly giftUrl?: string;
	/**
	 * present exactly on a `stock` or `ira_qcd` quote: the pledge as saved, and everything its
	 * pending screen shows.
	 *
	 * the answer is the save, and the pending screen is drawn from it once it arrives. nothing
	 * is charged: `feeMinor` is 0, `totalMinor` is the pledged amount on `ira_qcd` and 0 on `stock`,
	 * which has no value until the shares arrive, and `paymentToken` is the pledge's id. a resend
	 * of the same pledge with the same `pledgeId` answers the pledge already saved, whatever else it
	 * carries; a `pledgeId` naming anything else is `pledge_id_taken`.
	 */
	readonly pledge?: Pledge;
	/**
	 * the contribution to `FormConfig.sponsor` this charge carries, absent where it carries none.
	 *
	 * part of the charge rather than beside it: `totalMinor` is the whole charge and `feeMinor` the
	 * whole covered fee, the contribution's share of that fee included, so the gift is
	 * `totalMinor - feeMinor - contributionMinor`. with no contribution that is
	 * `totalMinor - feeMinor`, the arithmetic every quote without one already answers to.
	 */
	readonly contributionMinor?: number;
};

/**
 * a saved pledge, as `Quote.pledge` carries it.
 *
 * `id` is the `pledgeId` the request sent, and the capability the told press is posted with
 * (`PledgeToldAnswer` below). `reference` is what the donor quotes to their broker or custodian, uppercase:
 * `CFCP-AAPL-7Q2D`, `CFCP-IRA-4K9M`. `receiptTo` is the donor's address, where the receipt goes once
 * staff mark the gift received, and `''` where the pledge has none on file or the deployment cannot
 * send mail (`FormConfig.receipts` not true).
 *
 * the rest is the organisation's own transfer details, as saved under Payments, and what the donor
 * pledged. `shares` is decimal text, at most six places and never a number
 * (`StockPledgeRequest.shares`).
 * `mailingAddress` is as the organisation saved it, one line per line, separated by `\n`.
 * `ein` is `FormConfig.ein`.
 */
export type Pledge =
	| {
			readonly id: string;
			readonly method: 'stock';
			readonly reference: string;
			readonly receiptTo: string;
			readonly ticker: string;
			readonly shares: string;
			/** the brokerage the shares are delivered to, shown as "Deliver to". */
			readonly deliverTo: string;
			readonly dtcNumber: string;
			readonly accountNumber: string;
			readonly accountName: string;
	  }
	| {
			readonly id: string;
			readonly method: 'ira_qcd';
			readonly reference: string;
			readonly receiptTo: string;
			readonly amountMinor: number;
			readonly custodian: string;
			readonly payeeName: string;
			readonly ein: string;
			readonly mailingAddress: string;
	  };

/** what the machine sends to mint a `Quote`. */
export type QuoteRequest = {
	readonly formId: string;
	readonly amountMinor: number;
	readonly frequency: Frequency;
	readonly method: PaymentMethod;
	readonly coversFee: boolean;
	/**
	 * the processor's id for the authorization the donor already gave in its own window.
	 *
	 * a `daf` gift is quoted after the donor finishes in the fund's window, not before, so the
	 * request carries what that window produced. named for what it does rather than for what one
	 * provider calls it, as `Quote.paymentToken` is, and meaningful only to the adapter behind the
	 * payment port.
	 *
	 * present exactly when `method` is `'daf'` and absent on every other method, and it travels with
	 * `authorizedMinor` below: the endpoint refuses one without the other. optional because a request
	 * that is not a DAF gift carries neither.
	 */
	readonly authorizationId?: string;
	/**
	 * the total the donor authorized in that window, paired with `authorizationId` above.
	 *
	 * it may differ from `amountMinor`, which keeps meaning what the donor chose on the form: the
	 * fund's window lets the donor change the figure, and what the fund grants is what the gift is
	 * recorded from. with `coversFee` the fee is recomputed on this total and the gift is the rest,
	 * and the form's bounds are checked against that gift portion rather than against the total.
	 *
	 * the `Quote` a `daf` request mints is the same shape as any other: its `paymentToken` is the
	 * grant, and nothing is confirmed after it.
	 */
	readonly authorizedMinor?: number;
	/**
	 * the coin the donor chose, as `PayableCoin.coin` on the served config names it.
	 *
	 * present exactly when `method` is `'crypto'` and absent on every other method. the endpoint
	 * checks it against what the account takes at the moment of the quote rather than against the
	 * served list, which may be older, and refuses a coin it no longer takes as `coin_not_accepted`.
	 */
	readonly coin?: string;
	/**
	 * the id of the pledge a `stock` or `ira_qcd` request saves, minted by the form as a UUID when
	 * the save of that request starts, before any answer, and sent again on every resend of the same
	 * request — a resend answers the pledge already saved rather than saving a second, and a changed
	 * request is minted an id of its own. an id that names a gift or another pledge is refused as
	 * `pledge_id_taken`. required on both, absent on every other rail.
	 */
	readonly pledgeId?: string;
	/**
	 * the donor's IRA custodian, on `ira_qcd` and no other rail: required, 1 to `MAX_CUSTODIAN`
	 * characters once trimmed, folded onto one line. `amountMinor` is held to the form's bounds as
	 * on every other rail; `frequency` is `one_time`.
	 */
	readonly custodian?: string;
	readonly email: string;
	readonly firstName: string;
	readonly lastName: string;
	/**
	 * the donor's own answer about being written to, or `null` where they were never asked.
	 *
	 * required and three-valued: what `null` adds is the case a boolean could not state. a
	 * headless integrator who does not ask the question has no true answer to send, and `false` is
	 * not it — `false` is a donor who was asked and declined, which the column records as a
	 * different fact from a donor nobody asked (`consented_to_contact` is nullable in
	 * ../server/db/schema.ts).
	 *
	 * still required, so an absent field is refused rather than read as `null`: forgetting the
	 * question and choosing not to ask it are different mistakes, and only one of them is a
	 * mistake.
	 */
	readonly consentedToContact: boolean | null;
	readonly note?: string;
	/**
	 * the donor's consent to show `note` above on the organisation's page, beside their first name
	 * and last initial.
	 *
	 * absent and `false` both mean no. this client sends `true` or nothing, because an unticked box
	 * submits no key (AGENTS.md → Forms), and every gift sent before this field existed reads as a
	 * private note. sent only beside a note.
	 *
	 * snake_case where its neighbours are camelCase: the name is the one the endpoint parses.
	 */
	readonly note_public?: boolean;
	/**
	 * the donor asking for the shown note to stand beside "Anonymous" rather than their name.
	 *
	 * absent and `false` both mean no, and this client sends it only beside `note_public`: a private
	 * note has nobody to hide.
	 */
	readonly note_anonymous?: boolean;
	/**
	 * which of the form's programs the donor chose, absent where they chose none.
	 *
	 * an id and never a name: the name is what a donor reads and the id is what the gift is credited
	 * against, so a name on this field would credit a cause by the words on a screen the org can
	 * reword. it is checked against the form's own list on the way in, exactly as the amount is
	 * checked against the form's bounds — a client is not what decides which causes a form offers.
	 * where `pageProgramId` below arrives, this field is neither checked against that list nor read.
	 *
	 * absent is the gift going where it is needed most, unless `pageProgramId` credits the page's
	 * program. a form pinned to one cause sends nothing on this field either, because the server
	 * writes that pin from the form record (`Program` above).
	 */
	readonly programId?: string;
	/**
	 * the program a program page was drawn for, absent on every other page.
	 *
	 * the page's choice rather than the donor's, so it credits the gift whatever the form's program
	 * setting says, and it outranks `programId` where both arrive. it is honoured only on the
	 * Donation page's form, the form a program page serves. on any other live form, and for an
	 * archived or unknown id, the request is answered as `form_not_found`; a form that does not serve,
	 * such as a draft or a retired one, answers its own code first. those `form_not_found` answers
	 * read alike, but an active id on the Donation page's form passes on to the spam check, so a
	 * caller can learn that an id is active.
	 */
	readonly pageProgramId?: string;
	/**
	 * the gift given for someone else, as four flat fields.
	 *
	 * flat rather than one nested object, and it is the same rule the element's attributes are
	 * under: the endpoint parses these four names and nothing else, and a shape carried inside a
	 * fifth field would be a second encoding for one fact. the nesting that makes the two pairings
	 * unrepresentable is `Tribute` in ./value.ts and `ParsedQuoteRequest` on the server; the wire
	 * between them stays flat, and each end assembles or refuses it.
	 *
	 * all four are optional and travel as a set. **an absent `tributeKind` is the whole of how a
	 * gift says it carries no tribute** — the endpoint reads it that way — so a donor who never
	 * opened the disclosure sends none of the four rather than four empty strings, which is the
	 * distinction `note` above is under for the same reason. the two pairings the endpoint enforces
	 * are that a kind requires an honoree, and that the two notify fields arrive together or not at
	 * all; `completeAmount` in ./value.ts is what keeps this client from sending a body they refuse.
	 */
	readonly tributeKind?: TributeKind;
	readonly tributeHonoree?: string;
	readonly tributeNotifyName?: string;
	readonly tributeNotifyEmail?: string;
	/**
	 * the Turnstile token the page collected.
	 *
	 * optional on the wire and required by the endpoint on every quote, with no branch on anything
	 * the request or the served config carries. CLAUDE.md puts Turnstile on every `/api/v1`
	 * endpoint, which is public, unauthenticated and payment-initiating, and a check that switched
	 * itself off on the deployments that never finished configuring it would be a hole rather than
	 * a default — so the requirement is unconditional and it is the endpoint's, because a
	 * client-side check bounds nobody who is not using the client.
	 *
	 * `turnstileSiteKey` on `FormConfig` above is therefore which check to run and never whether
	 * to run one: a deployment serves it or `altchaChallengeUrl`, and the endpoint verifies the
	 * field its served config names — this one or `altchaPayload` below. an absent token is the
	 * submission's and is refused `challenge_failed`, which a fresh challenge fixes.
	 *
	 * optional because a deployment checking with ALTCHA sends `altchaPayload` instead.
	 */
	readonly turnstileToken?: string;
	/**
	 * the solved ALTCHA challenge, as the base64 payload ALTCHA's own widget submits, on a
	 * deployment whose served config names `altchaChallengeUrl`.
	 *
	 * one challenge clears one submission, so it is spent the way a Turnstile token is. a request
	 * carries this or `turnstileToken`, whichever check the served config names, and never both.
	 */
	readonly altchaPayload?: string;
	/**
	 * the contribution to `FormConfig.sponsor` the donor chose beside the gift, in minor units,
	 * absent or 0 where they chose none.
	 *
	 * `amountMinor` keeps meaning the gift alone. the quote charges the contribution on top, so the
	 * gift is still `Quote.totalMinor - Quote.feeMinor - Quote.contributionMinor`. a deployment
	 * offers a contribution only beside a `sponsor`, and the endpoint refuses a non-zero value until
	 * the deployment can price one, so a value it cannot take is never silently dropped. a stock or
	 * `ira_qcd` pledge carries none, whatever a deployment can price: nothing is charged on one, so
	 * the endpoint refuses a non-zero value on a pledge as its own answer.
	 */
	readonly contributionMinor?: number;
};

/** the most characters `QuoteRequest.custodian` may hold once trimmed. */
export const MAX_CUSTODIAN = 200;

/**
 * what the machine sends to save a stock pledge, to the same `POST /api/v1/forms/:id/donations`.
 *
 * a `QuoteRequest` with no `amountMinor` and no `coversFee`: the donor states shares rather than an
 * amount, the gift's value is set when the shares arrive, and a pledge carries no fee.
 * `amountMinor` sent here is refused, and `contributionMinor` is not a field of it: a contribution is
 * a share of a gift's amount and a pledge states none. `ticker` is one `symbol` from
 * `GET /api/v1/forms/:id/tickers`, refused as `ticker_not_listed` where the list does not hold it.
 * `shares` is decimal text above zero, at most six decimal places and at most 10,000,000: `"50"`,
 * `"12.5"`.
 */
export type StockPledgeRequest = Omit<
	QuoteRequest,
	'amountMinor' | 'coversFee' | 'method' | 'contributionMinor'
> & {
	readonly method: 'stock';
	readonly pledgeId: string;
	readonly ticker: string;
	readonly shares: string;
};

/**
 * `POST /api/v1/forms/:id/donations/:pledgeId/told` — the donor saying they have asked their broker
 * or custodian to send the gift ("I’ve contacted my broker", "I’ve asked my custodian"). no body.
 *
 * `:pledgeId` is `Pledge.id`. the organisation is emailed the first time, and every press after it
 * answers the same `PledgeToldAnswer` and emails nobody. an id that names no pledge on this form is
 * a 404 coded `pledge_not_found`.
 */
export type PledgeToldAnswer = {
	readonly ok: true;
};

/**
 * where a gift paid to an address stands, as the waiting screen reads it.
 *
 * `waiting` is no deposit recorded against the gift yet, `received` is one recorded — the donor's
 * part is done — and `expired` is the address no longer watched with nothing received.
 */
export const DONATION_STATES = ['waiting', 'received', 'expired'] as const;
export type DonationState = (typeof DONATION_STATES)[number];

/**
 * `GET /api/v1/forms/:id/donations/:donationId` — one gift's standing, read off this deployment's
 * own rows.
 *
 * keyed by `Quote.paymentToken` on a `crypto` quote, which is the donation id. the state and nothing
 * else: no amount and no donor detail, because the id is all a caller holds.
 */
export type DonationStatus = {
	readonly state: DonationState;
};

/** the most characters `EmployerRequest.employer` may hold once trimmed. */
export const MAX_EMPLOYER = 200;

/**
 * `POST /api/v1/forms/:id/gifts/:token/employer` — the donor naming the employer that may match a
 * gift, from the thank-you.
 *
 * `:token` is the last path segment of `Quote.giftUrl`. `employer` is free text the donor typed,
 * trimmed, 1 to `MAX_EMPLOYER` characters, and checked for nothing else: no list of employers exists
 * to check it against. a refusal answers with `ApiError` below.
 */
export type EmployerRequest = {
	readonly employer: string;
};

/** what an accepted `EmployerRequest` answers. */
export type EmployerAnswer = {
	readonly ok: true;
};

/**
 * a 4xx from `/api/v1`.
 *
 * `fix` is not decoration. CLAUDE.md: 4xx bodies are read by AI agents, not humans in a
 * console, so every one names the offending value and where to change it. typing it here is
 * what stops the flow from reducing a rejection to a boolean and stranding the integrator with
 * a silent form — and a silently broken donation form is indistinguishable from a nonprofit
 * having a bad month.
 */
export type ApiError = {
	readonly error: string;
	readonly message: string;
	readonly fix?: string;
	/**
	 * `below_minimum` only, where the processor named its floor: the least gift the coin takes, in the
	 * minor units of `QuoteRequest.amountMinor`, any covered fee left out, rounded up. absent otherwise.
	 */
	readonly minAmountMinor?: number;
	/**
	 * `pledge_detail_invalid` and `ticker_not_listed` only: the field the donor fills in that was
	 * refused, as `QuoteRequest` and `StockPledgeRequest` spell it — `ticker`, `shares` or
	 * `custodian`. absent otherwise.
	 */
	readonly field?: string;
};

/**
 * every value `error` above is allowed to hold, and the whole vocabulary of them.
 *
 * it is here rather than beside the code that produces it because it is a wire vocabulary, and
 * a member is what an integrating agent switches on, so a change to one is an edit to this file.
 *
 * seventeen, and the count is held down deliberately. a code answers "which screen", the message
 * answers "which value" — so two codes carrying a byte-identical `fix` were one code all along
 * and are merged rather than kept as synonyms, and a new value worth naming is a new sentence in
 * an existing member's message before it is an eighteenth member.
 *
 * six of the seventeen are decided before anything is charged, from this deployment's own
 * configuration and the form record. the eleven that are not are the eleven the donation form can do
 * something about, and that is what earns each of them a member: `payments_unavailable` is the
 * processor answering badly, `challenge_failed` is a token the challenge service would not
 * honour, the two `daf_` members are a donor-advised fund's own answer to a grant, the three
 * crypto members are the processor refusing the coin or the amount the donor chose, and the four
 * pledge members are a box on a pledge's screen to fill again, a pledge the screen holds that
 * this deployment does not, or a pledge id the form mints afresh and sends again. every other
 * failure of the payment path is either a hole an operator fills, which the six already say, or a
 * bug of ours, which is a 500 and no code at all: a member for one would ask a donation form to
 * render a screen about our defect.
 *
 * `error` stays typed `string` and is not narrowed to this union. narrowing the type of a shipped
 * field is itself the breaking change this file exists to prevent — a pinned client must still
 * parse a body carrying a member minted after it was published. the union is what a server
 * declares itself against, never what the wire guarantees to hold.
 */
export const API_ERROR_CODES = [
	'form_not_found',
	'form_not_published',
	'form_retired',
	'form_unservable',
	'org_profile_incomplete',
	/**
	 * the processor that settles the chosen rail holds no usable keys on this deployment.
	 *
	 * `message` is the donor's and sends them to another payment method, since no retry moves it;
	 * the value an operator sets is named in `fix`, which no donor's card draws — a variable's name
	 * there, never its value.
	 */
	'payments_not_configured',
	/**
	 * the processor could not be reached, or answered with a fault of its own.
	 *
	 * the one member a donor acts on by trying again, which is why it is separate from
	 * `payments_not_configured` — that one says an operator has a variable to set, and no amount of
	 * retrying moves it.
	 */
	'payments_unavailable',
	/**
	 * the anti-abuse challenge did not clear, so nothing was charged.
	 *
	 * a member of its own because it is the one refusal with a specific action behind it that only
	 * the donation form can take: reset the widget and send the token it mints next. a token is
	 * valid once and for five minutes, so the ordinary way here is a donor who filled the form
	 * slowly rather than anything adversarial — which makes this the most common non-success on the
	 * whole surface, and the one where a generic message costs a real gift.
	 *
	 * it does not cover the challenge service being unreachable, or this deployment holding no
	 * challenge credentials. neither of those is fixed by a fresh token: the first is an outage and
	 * the second is a value an operator sets, so both answer 503 with no code at all, the way every
	 * other unfinished-deployment and outage answer on this surface does.
	 */
	'challenge_failed',
	/**
	 * the donor's approval in the fund's own window expired before the grant was created, so no
	 * grant exists.
	 *
	 * a member of its own because the action behind it is the donation form's alone: reopen the
	 * fund's window so the donor approves again. retrying the same submission sends the same
	 * expired approval, which is why it is not `payments_unavailable`.
	 */
	'daf_authorization_expired',
	/**
	 * the fund refused the grant under its own rules — a minimum, a balance, a policy of the fund's —
	 * so no grant exists.
	 *
	 * `message` carries the fund's reason, because only the fund knows it and the donor settles it
	 * with the fund or a different amount. neither a fresh approval nor a retry moves it, which is
	 * what keeps it apart from `daf_authorization_expired` and `payments_unavailable`. a refusal
	 * that arrives with no reason is not the fund's and is not this member: it answers 500 with no
	 * code, as a bug of ours does.
	 */
	'daf_grant_declined',
	/**
	 * the coin on a `crypto` quote is not one the account takes, so no address was minted.
	 *
	 * `message` names the coin as `QuoteRequest.coin` sent it, and `fix` says to pick another from
	 * the served config's `coins` — a coin switched off after that list was cached is the ordinary
	 * way here. a retry of the same coin answers the same.
	 */
	'coin_not_accepted',
	/**
	 * the gift converts to less of the chosen coin than the processor accepts, so no address was
	 * minted.
	 *
	 * `message` names the coin and the minimum in dollars, because the minimum moves with the coin's
	 * price and is on no served response to read ahead of time; `fix` is a larger amount or another
	 * coin. apart from `above_maximum` because the donor moves the amount the other way.
	 */
	'below_minimum',
	/**
	 * the processor refused the gift as more than it takes in the chosen coin, so no address was
	 * minted.
	 *
	 * `message` names the coin and the amount refused; `fix` is a smaller amount or another coin.
	 */
	'above_maximum',
	/**
	 * a stock or IRA (QCD) pledge whose ticker, shares or custodian is missing or malformed, so
	 * nothing was saved. `field` names which. the form marks the custodian box where that is the
	 * field named, and draws no box for a ticker or shares.
	 */
	'pledge_detail_invalid',
	/**
	 * a stock pledge naming a ticker this deployment's list does not hold, so nothing was saved.
	 * `field` is `ticker`; the donor picks one from `GET /api/v1/forms/:id/tickers`.
	 */
	'ticker_not_listed',
	/**
	 * the told press's pledge id (`PledgeToldAnswer` above) names no pledge on this form. the donor's
	 * screen holds a pledge this deployment never saved, and saving it again is the way back.
	 */
	'pledge_not_found',
	/**
	 * a stock or IRA (QCD) request's `pledgeId` already names a gift, or a pledge that is not this
	 * one, so nothing was saved. a 409 with no `field`: no box the donor fills in is wrong. a resend
	 * of the same pledge (the same id, form, `method`, `ticker` and `shares` or `amountMinor` and
	 * `custodian`, and donor `email`) is not this code and answers the pledge already saved. the
	 * way back is the form's: mint a fresh `pledgeId` and send the request again once.
	 */
	'pledge_id_taken'
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
