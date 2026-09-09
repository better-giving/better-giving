// `GET /api/v1/forms/:id/config` as something the flow may be started on, or nothing at all.
//
// the response is untrusted JSON reaching code that runs on a stranger's page, and ./v1.ts is
// explicit that `FormConfig` is a description rather than a guarantee: a field the type calls
// required may simply be absent at runtime. so this is the one place the description is made
// true, and everything downstream — the machine, the projection, the element — is entitled to
// the type it was handed.
//
// two kinds of degradation, and which one applies is a judgement about money:
//
//   - a field the form cannot solicit a gift without makes the whole config `null`, and the
//     element says so instead of rendering. the legal identity is the clearest case — `FormConfig`
//     in ./v1.ts keeps `orgLegalName`, `ein` and `deductibilityStatement` required strings rather
//     than optional ones for exactly this reason, and says so where the type is declared: a
//     donation form that omits the deductibility statement is one that should not be on screen.
//     the amount bounds are the same kind of thing from the other end: without them no amount is
//     ever complete, so the form would render and refuse every gift silently.
//   - a field with a safe reading falls back to it. an unreadable `feeCoverage` becomes the one
//     mode ./v1.ts carries, which leaves the fee the donor's own decision; an unreadable locale
//     becomes a formatting default. the direction is always the one that cannot take a decision
//     away from the donor.
//
// nothing here throws. an exception in this path is a donation form that never renders, which is
// indistinguishable to the org from a nonprofit having a bad month.
//
// no framework, no DOM, no network: this reads a value someone else fetched.

import {
	FREQUENCIES,
	PAYMENT_METHODS,
	type FeeCoverage,
	type FeeRule,
	type FeeRules,
	type FormConfig,
	type Frequency,
	type PaymentMethod,
	type Provider
} from './v1';

type Unknown = Record<string, unknown>;

function record(value: unknown): Unknown | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Unknown)
		: null;
}

/** a string with something in it. an empty one is an absent field wearing a type. */
function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function wholeAtLeast(value: unknown, floor: number): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= floor ? value : null;
}

function list(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

/**
 * the members of a closed vocabulary this response actually names, in the contract's own order.
 *
 * ordered by the contract rather than by the response, so two deployments that enabled the same
 * frequencies render them the same way round whatever order they happen to serialise in.
 */
function vocabulary<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] {
	const named = new Set(
		list(value).filter((member): member is string => typeof member === 'string')
	);
	return allowed.filter((member) => named.has(member));
}

/**
 * the publishable key and the SDK it belongs to.
 *
 * neither field is a secret, by construction: both are embedded in public HTML on the org's own
 * site, which is what a publishable key is designed for.
 */
function provider(value: unknown): Provider | null {
	const source = record(value);
	if (source === null) return null;
	const name = text(source.name);
	const publishableKey = text(source.publishableKey);
	return name === null || publishableKey === null ? null : { name, publishableKey };
}

/**
 * one rail's price, dropped rather than defaulted: a made-up fee rate is a made-up charge.
 *
 * the cap is optional and stays optional. absent it is carried through absent, because a bound
 * defaulted to zero would price every uncapped rail at its flat charge alone; present it is a
 * whole non-negative amount or the whole rule goes, because a rule kept with a malformed cap
 * stripped quotes the uncapped rate, which is the over-collection the field exists to prevent.
 */
function feeRule(value: unknown): FeeRule | null {
	const source = record(value);
	if (source === null) return null;
	const { percent, fixedMinor, capMinor } = source;
	if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return null;
	const fixed = wholeAtLeast(fixedMinor, 0);
	if (fixed === null) return null;
	if (capMinor === undefined) return { percent, fixedMinor: fixed };
	const cap = wholeAtLeast(capMinor, 0);
	return cap === null ? null : { percent, fixedMinor: fixed, capMinor: cap };
}

/**
 * the fee rules, holding only the rails whose price was readable.
 *
 * the cast restates what ./v1.ts already documents about this field: the type says every rail has
 * a rule and the response is not obliged to carry one. `estimateFee` in ./fee.ts takes
 * `undefined` as a first-class input for that reason, so a missing rail is a fee line that does
 * not render rather than a `TypeError` inside a state transition.
 */
function feeRules(value: unknown): FeeRules {
	const source = record(value) ?? {};
	const rules: Partial<Record<PaymentMethod, FeeRule>> = {};
	for (const method of PAYMENT_METHODS) {
		const rule = feeRule(source[method]);
		if (rule !== null) rules[method] = rule;
	}
	return rules as FeeRules;
}

/**
 * the program as the field a config carries, `{}` where the form has none, and `null` where the
 * response states one this file cannot read.
 *
 * three answers rather than two, because an absent program and an unreadable one are opposite
 * judgements here. this is the one field on the response that says where the money goes, so there
 * is no safe reading of a mangled one: a pin whose name did not arrive draws a screen naming no
 * cause, and a list with one unreadable entry offers a donor fewer causes than the org set, with
 * nothing on the card to say one is missing. both are a gift credited somewhere the org did not
 * say, so the whole config goes and the element states which field it could not read.
 *
 * an entry is refused rather than dropped for that same reason, which is where this parts company
 * with `feeRules` above: a rail dropped is a fee line that does not render, and a cause dropped is
 * a cause nobody can give to.
 *
 * an empty `options` is the exception and is not a malformed list — it is a form that offers no
 * choice, which is what an absent program already means, so it reads as one.
 */
function program(value: unknown): Pick<FormConfig, 'program'> | null {
	if (value === undefined) return {};
	const source = record(value);
	if (source === null) return null;

	if (source.mode === 'pinned') {
		const name = text(source.name);
		return name === null ? null : { program: { mode: 'pinned', name } };
	}
	if (source.mode !== 'choice' || !Array.isArray(source.options)) return null;

	const options: { id: string; name: string }[] = [];
	for (const entry of source.options) {
		const option = record(entry);
		const id = option === null ? null : text(option.id);
		const name = option === null ? null : text(option.name);
		if (id === null || name === null) return null;
		options.push({ id, name });
	}
	return options.length === 0 ? {} : { program: { mode: 'choice', options } };
}

/**
 * the mode every served config is read as, whatever it names.
 *
 * `FEE_COVERAGE_MODES` in ./v1.ts carries one member, so there is nothing to read off the
 * response and no unsafe reading left to guard against: a word this snippet does not know still
 * leaves the fee the donor's to decline. a second mode is what makes this a parse again.
 */
const DONOR_DECIDES_FEE: FeeCoverage = 'optional';

/** the locale a config that did not name a usable one is formatted in. */
const FALLBACK_LOCALE = 'en-US';

/**
 * the response as a config the flow may be started on, or `null` when it is not one.
 *
 * `null` is a rendered message rather than a silent nothing: the element states which field the
 * response is missing, because CLAUDE.md's rule about 4xx bodies applies to whatever an
 * integrating agent can read, and an agent cannot see a console.
 */
export function readFormConfig(value: unknown): FormConfig | null {
	const source = record(value);
	if (source === null) return null;

	const formId = text(source.formId);
	const currency = text(source.currency);
	const orgLegalName = text(source.orgLegalName);
	const ein = text(source.ein);
	const deductibilityStatement = text(source.deductibilityStatement);
	const paymentProvider = provider(source.provider);
	const minAmountMinor = wholeAtLeast(source.minAmountMinor, 1);
	const maxAmountMinor = wholeAtLeast(source.maxAmountMinor, 1);

	if (formId === null || currency === null || paymentProvider === null) return null;
	// the identity a gift is solicited under. the form does not render without it.
	if (orgLegalName === null || ein === null || deductibilityStatement === null) return null;
	// without both bounds no amount is ever complete, so the form would render and then refuse
	// every gift with nothing on screen to say why.
	if (minAmountMinor === null || maxAmountMinor === null) return null;
	if (minAmountMinor > maxAmountMinor) return null;

	const frequencies: readonly Frequency[] = vocabulary(source.frequencies, FREQUENCIES);
	const paymentMethods: readonly PaymentMethod[] = vocabulary(
		source.paymentMethods,
		PAYMENT_METHODS
	);
	if (frequencies.length === 0 || paymentMethods.length === 0) return null;

	const suggestedAmountsMinor = list(source.suggestedAmountsMinor)
		.map((amount) => wholeAtLeast(amount, minAmountMinor))
		.filter((amount): amount is number => amount !== null && amount <= maxAmountMinor);

	const turnstileSiteKey = text(source.turnstileSiteKey);
	// the one field whose unreadable state refuses the whole config rather than falling back, for
	// the reason written on `program` above.
	const cause = program(source.program);
	if (cause === null) return null;

	return {
		formId,
		provider: paymentProvider,
		currency,
		suggestedAmountsMinor,
		minAmountMinor,
		maxAmountMinor,
		frequencies,
		paymentMethods,
		feeCoverage: DONOR_DECIDES_FEE,
		feeRules: feeRules(source.feeRules),
		locale: text(source.locale) ?? FALLBACK_LOCALE,
		orgLegalName,
		ein,
		deductibilityStatement,
		...cause,
		...(turnstileSiteKey === null ? {} : { turnstileSiteKey })
	};
}
