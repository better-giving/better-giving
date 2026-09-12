// the `/api/v1` shapes the flow machine is allowed to know, and nothing else.
//
// this file is the flow's only view of the backend, and that is a boundary rather than a
// convenience. the form is served from the deployment it talks to, so the two can never be a
// version apart — but the same modules are meant to be extractable as a package a third party
// installs, and such a consumer pins a version while the deployment moves on. what bounds that
// drift is `v1` being permanent and this file naming nothing outside it. the moment a type
// here widens to something deployment-internal, the bound is gone and nobody notices until a
// donation page breaks on a site we cannot reach.
//
// so every type here is add-never-rename, which is CLAUDE.md's permanent-contract rule applied
// to the wire: the snippet is pasted into sites we cannot reach, and a breaking change ships
// as `v2` alongside rather than as an edit. a field may be added; a field may not be renamed,
// retyped or removed. the `as const` arrays are covered too — a member may join
// `PAYMENT_METHODS`, no member may leave it.
//
// `FormConfig.provider` was corrected to `providers` under that rule rather than in spite of it,
// and it is recorded here for `PART_NAMES`' reason in ./parts.ts: the next reader has to be able to
// tell a stated exception from an oversight. a second processor made the singular field
// unrepresentable, and CLAUDE.md's *Permanent contracts* opens by saying nothing is deployed for
// real and no site carries the snippet — so a contract here is permanent by decision rather than by
// exposure, and the fix is weighed on its merits. **the correction stops being available the day
// that paragraph is deleted**, and the next one needs the same argument made again.
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
 * obvious later and is a `v2`.
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
 * a closed vocabulary on the wire, under this file's add-never-rename rule, and the only thing
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
 * how the donor is asked to cover the processing fee.
 *
 * one mode: the receipt's fee line renders as a decision the donor makes, on a control that states
 * which way it is set, and it is the donor's to turn off from a default of covered. a fee added to a
 * gift without the donor agreeing to it is a charge they did not consent to, and that is not
 * something this project offers an org a setting for — so the field carries a vocabulary of one
 * rather than a boolean, and a second reading would be a member added here under this file's
 * add-never-rename rule.
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
 * the processor whose own window collects them. `STRIPE_RAILS` and `PAYPAL_RAILS` in
 * ./embed/rails.ts are that split written down, and `providers` on `FormConfig` below is the field
 * that lets one config name both.
 */
export const PAYMENT_METHODS = [
	'card',
	'ach',
	'apple_pay',
	'google_pay',
	'paypal',
	'venmo'
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
	venmo: 'Venmo'
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
 * so the contract can carry a provider without a field named after one — and a field named
 * after one could only ever be corrected by shipping a `v2`.
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
	readonly paymentMethods: readonly PaymentMethod[];
	readonly feeCoverage: FeeCoverage;
	readonly feeRules: FeeRules;
	readonly locale: string;
	readonly orgLegalName: string;
	readonly ein: string;
	readonly deductibilityStatement: string;
	readonly turnstileSiteKey?: string;
	readonly monthlyAsk?: MonthlyAsk;
	/** the cause this form's gifts are credited to, absent where it has none. */
	readonly program?: Program;
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
};

/** what the machine sends to mint a `Quote`. */
export type QuoteRequest = {
	readonly formId: string;
	readonly amountMinor: number;
	readonly frequency: Frequency;
	readonly method: PaymentMethod;
	readonly coversFee: boolean;
	readonly email: string;
	readonly firstName: string;
	readonly lastName: string;
	/**
	 * the donor's own answer about being written to, or `null` where they were never asked.
	 *
	 * required and three-valued, which is the add half of this file's add-never-rename rule: the
	 * field keeps its name and every `boolean` a published snippet already sends still means what
	 * it meant. what `null` adds is the case a boolean could not state. a headless integrator who
	 * does not ask the question has no true answer to send, and `false` is not it — `false` is a
	 * donor who was asked and declined, which the column records as a different fact from a donor
	 * nobody asked (`consented_to_contact` is nullable in ../server/db/schema.ts).
	 *
	 * still required, so an absent field is refused rather than read as `null`: forgetting the
	 * question and choosing not to ask it are different mistakes, and only one of them is a
	 * mistake.
	 */
	readonly consentedToContact: boolean | null;
	readonly note?: string;
	/**
	 * which of the form's programs the donor chose, absent where they chose none.
	 *
	 * an id and never a name: the name is what a donor reads and the id is what the gift is credited
	 * against, so a name on this field would credit a cause by the words on a screen the org can
	 * reword. it is checked against the form's own list on the way in, exactly as the amount is
	 * checked against the form's bounds — a client is not what decides which causes a form offers.
	 *
	 * absent is the gift going where it is needed most, and it is the only reading of an absence here:
	 * a form pinned to one cause sends nothing on this field either, because the server writes that
	 * pin from the form record (`Program` above). so a request carrying this field is always a donor
	 * who was offered a choice and made one.
	 */
	readonly programId?: string;
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
	 * `turnstileSiteKey` on `FormConfig` above is therefore which widget to render and never
	 * whether to render one. what it does decide is who a missing token belongs to: served, an
	 * absent token is the submission's and is refused `challenge_failed`, which a fresh challenge
	 * fixes; unset, the page could render no widget at all, so it is the deployment's and answers
	 * `challenge_unavailable` with an operator's sentence in the log
	 * (`verifyTurnstile` in ../server/api/turnstile.ts).
	 *
	 * the field is on the contract from the first version because adding it later would be a
	 * request shape a published snippet does not send. it stays optional here for the same reason
	 * every other addition to this file is: narrowing a shipped field is the breaking change this
	 * file exists to prevent.
	 */
	readonly turnstileToken?: string;
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
};

/**
 * every value `error` above is allowed to hold, and the whole vocabulary of them.
 *
 * it is here rather than beside the code that produces it because it is a wire vocabulary, and
 * this file is where the add-never-rename rule is stated: a member is what an integrating agent
 * switches on, so renaming one breaks an integration that already handles it, and the only way to
 * add or merge a member is to edit the file whose header says that.
 *
 * eight, and the count is held down deliberately. a code answers "which screen", the message
 * answers "which value" — so two codes carrying a byte-identical `fix` were one code all along
 * and are merged rather than kept as synonyms, and a new value worth naming is a new sentence in
 * an existing member's message before it is a ninth member.
 *
 * six of the eight are decided before anything is charged, from this deployment's own
 * configuration and the form record. the two that are not are the two the donation form can do
 * something about, and that is what earns each of them a member: `payments_unavailable` is the
 * processor answering badly, and `challenge_failed` is a token the challenge service would not
 * honour. every other failure of the payment path is either a hole an operator fills, which the
 * six already say, or a bug of ours, which is a 500 and no code at all: a member for one would ask
 * a donation form to render a screen about our defect.
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
	'challenge_failed'
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
