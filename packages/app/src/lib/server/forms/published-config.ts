import type {
	ApiError,
	ApiErrorCode,
	FormConfig,
	Frequency,
	PaymentMethod,
	Program
} from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import { readConfigEnv, type ConfigEnv } from '../config/env';
import type { Db } from '../db/client';
import type { OrgProfile } from '../db/schema';
import { servedDeductibilityStatement } from '../org/deductibility';
import { readOrgProfile } from '../org/queries';
import { present } from '../org/receipt-fields';
import { paypalFeeRules, servedFeeRules } from '../payments/fees';
import { servedProcessors } from '../payments/factory';
import { PROCESSOR_LABELS, PROCESSOR_NAMES, processorOf } from '../payments/provider';
import { readActivePrograms, readProgram } from '../programs/queries';
import { redactPublicId } from '../../redact';
import type { FormRecord } from './form-input';
import { readForm } from './queries';

// one `form` row plus this deployment's own details, as the config `GET /api/v1/forms/:id/config`
// answers with — or a refusal saying which value stopped it.
//
// it is the server half of `readFormConfig` in packages/form/src/config.ts and refuses everything that
// one refuses, which is the whole reason it exists as a separate step rather than as a
// projection inside the endpoint. that reader runs on somebody else's website and turns an
// unusable config into `null`, which the element renders as a message and nothing else records.
// so a config this side is willing to serve and that side will not accept is a donation form
// that silently does not appear, on a page nobody here can see. refusing here instead puts the
// same judgement in front of a 4xx body that names the value and the screen that changes it.
//
// `publishedConfig` reads no database and asks no processor. the two rows and the cadences arrive
// already read, so every refusal it can return is decidable in the node pool with no D1 and no
// network in sight — the same split ./form-input.ts draws against ./queries.ts, and for the same
// reason. `readPublishedConfig` below is the other half of that split and is the only thing here
// that issues a query or leaves the deployment.

/**
 * why a form has no config to serve.
 *
 * a closed vocabulary because `/api/v1` writes a different body per member: CLAUDE.md's rule is
 * that a 4xx names the offending value and where to fix it, and a caller that could only see
 * "refused" would have to guess between a draft form, an unset EIN and a Stripe key in
 * the wrong slot — three problems with three different screens behind them.
 *
 * the member is also the `error` field on the wire (`ApiError` in packages/form/src/v1.ts), so the
 * string an integrating agent switches on is the same string the endpoint switches on. one
 * vocabulary rather than a code and a translation of it — which is why the list is declared
 * against `ApiErrorCode` from that file rather than standing on its own: the wire vocabulary is a
 * permanent contract, so a member is minted there and spent here, never the other way round.
 *
 * a member per *screen*, not per check. each of the six carries exactly one `fix`, and two checks
 * whose fix is the same sentence are the same member — so the branches below outnumber the
 * vocabulary on purpose, with the message saying which value and the code saying where to go.
 */
export const PUBLISHED_CONFIG_REFUSALS = [
	'form_not_found',
	'form_not_published',
	'form_retired',
	'form_unservable',
	'org_profile_incomplete',
	'payments_not_configured'
] as const satisfies readonly ApiErrorCode[];
export type PublishedConfigRefusal = (typeof PUBLISHED_CONFIG_REFUSALS)[number];

/**
 * a config that may be served, or the reason it may not.
 *
 * a result rather than `FormConfig | null`, because the endpoint has to tell the reasons apart
 * to answer with anything an integrator can act on. the body is assembled here rather than at
 * the endpoint so that the sentence naming a value sits beside the check that read it.
 *
 * the row is carried out on both branches, and that is what keeps the endpoint down to one read.
 * `allowed_origins` names which sites may read every answer this produces, the 4xx ones included —
 * a browser cannot read a refusal body without `Access-Control-Allow-Origin`, so a refusal handed
 * back without the row is a refusal the page that asked for it never sees. and a second query for
 * the same row on a public, unauthenticated endpoint is exactly the shape this module's own reader
 * avoids.
 *
 * `form: null` on one refusal only: `form_not_found`, where there is no row and therefore no sites
 * to name. what the endpoint echoes to on top of them is not this module's to say — this
 * deployment's own origin is taken off the request by `corsHeaders` in ../api/cors.ts.
 */
export type PublishedConfigResult =
	| { readonly ok: true; readonly config: FormConfig; readonly form: FormRecord }
	| {
			readonly ok: false;
			readonly reason: PublishedConfigRefusal;
			readonly error: ApiError;
			readonly form: FormRecord | null;
	  };

/** everything the answer is decided from, already read. */
export interface PublishedConfigSources {
	/** the id as the request spelled it, so a not-found message can quote it back. */
	readonly id: string;
	readonly form: FormRecord | null;
	readonly profile: OrgProfile | null;
	readonly env: ConfigEnv;
	/**
	 * how often a gift may repeat on this deployment, already read.
	 *
	 * a value rather than a read, so every refusal below stays decidable with no D1 and no
	 * processor in sight — the same split the two rows are carried in under. what produces it is
	 * `offeredCadences` in ./offered-cadences.ts, which is total over the port's standings and
	 * never answers with an empty list.
	 */
	readonly cadences: readonly Frequency[];
	/**
	 * which rails a donor may be shown here, already read.
	 *
	 * a value for the reason `cadences` above is one, and unlike that one it may be empty: what
	 * produces it is `offeredRails` in ./offered-rails.ts, which narrows the deployment's own list to
	 * the rails the processor account is approved for and has no floor to fall back to.
	 *
	 * an empty list is carried through to the config rather than refused here. `renderableConfig`
	 * below is the one place that refuses it and only the config route composes it — the donation
	 * path shares this ladder and must go on charging a gift already in flight.
	 */
	readonly rails: readonly PaymentMethod[];
	/**
	 * the cause this form's gifts are credited to, already read — `null` where it names none.
	 *
	 * a value for `cadences`' reason, and the read behind it is `readFormProgram` below: `pinned`
	 * is one row by id and `choice` is the active list, so which query runs is decided from the
	 * form's own mode and never from anything on the wire.
	 *
	 * a `choice` may arrive with an empty `options`, and that is not the same as `null` here — the
	 * form asks the question and the deployment has retired every answer to it. what a config does
	 * about that is `servedProgram` below, which is the one judgement this half makes over it.
	 */
	readonly program: Program | null;
}

/**
 * the config for one form, read from this deployment.
 *
 * the thin half: the reads and the judgement below, kept apart so that every refusal is testable
 * with no D1 and the endpoint has one call to make. the form is read first and alone, because
 * `publishedConfig` refuses on it before it looks at anything else — and a second query issued for
 * an id that does not exist is a query a public, unauthenticated endpoint runs for anyone who
 * asks. the profile and the repeating-gifts standing go together after it: neither is an input to
 * the other, and the standing is the slowest thing here.
 *
 * `readForm` and not `readForms`: it returns an archived row, which is what lets a retired form
 * be told from an id that never existed — see the refusal pair below.
 *
 * `readCadences` and `readRails` are how to find out rather than the answers, and they are called
 * only once a row has been found. how often a gift may repeat and which rails may be shown are both
 * facts about this deployment's processor account, so finding out means leaving the deployment — and
 * an id nothing matches must not cost an outbound call on a public, unauthenticated path any more
 * than it costs a second query. they are functions rather than a provider because building one is
 * the caller's, which is what keeps this module free of the payment factory and every refusal here
 * reachable in a test with no network in sight: `$lib/server/forms/cadence-cache.ts` and
 * `$lib/server/forms/rail-cache.ts` are what every caller passes, and their headers state what is
 * cached and what a stale entry costs.
 *
 * two arguments rather than one read of the account, because they are two reads with two answers and
 * one of them can be kept while the other is refetched. required rather than defaulted, so a caller
 * that has not been given a rail source is a compile error here — a fallback to the repository's own
 * list is exactly the unconditional answer this parameter exists to remove.
 *
 * neither may throw: `offeredCadences` in ./offered-cadences.ts and `offeredRails` in
 * ./offered-rails.ts turn every failing arm of the payment port into a list, so a processor nobody
 * can reach changes what a form offers rather than taking this route down.
 *
 * `source` is the platform env whole, narrowed here by `readConfigEnv` — the same entry point
 * `createEmailProvider` and `createPaymentProviders` take, so a blank value and a binding sitting
 * in a string's slot mean "unset" here exactly as they do there. taking the raw env is what
 * lets the endpoint pass `platform.env` at the one call site that needs a deploy-time value
 * rather than being handed a copy narrowed for a screen: a loader's return value is serialized to
 * the browser, so a screen-shaped cut of the env is one `return { env }` away from publishing the
 * Stripe secret.
 *
 * the pure half keeps its `ConfigEnv` and its already-read cadences (see
 * `PublishedConfigSources`), because a judgement stated against values is what makes every
 * refusal decidable with no D1 in sight.
 */
export async function readPublishedConfig(
	db: Db,
	id: string,
	source: unknown,
	readCadences: () => Promise<readonly Frequency[]>,
	readRails: () => Promise<readonly PaymentMethod[]>
): Promise<PublishedConfigResult> {
	const env = readConfigEnv(source);
	const form = await readForm(db, id);
	if (form === null) {
		// no row, so nothing is read and nothing is asked of the processor: this answers
		// `form_not_found` before it reaches the config the empty lists would have gone into.
		return publishedConfig({
			id,
			form: null,
			profile: null,
			env,
			cadences: [],
			rails: [],
			program: null
		});
	}

	const [profile, cadences, rails, program] = await Promise.all([
		readOrgProfile(db),
		readCadences(),
		readRails(),
		readFormProgram(db, form)
	]);
	return publishedConfig({ id, form, profile, env, cadences, rails, program });
}

/**
 * the cause a form serves, in the shape the wire carries it — one query, or none.
 *
 * the mode decides which, and the two are different questions rather than two filters on one list.
 * `pinned` is `readProgram`, which does not hide an archived row: a form pinned to a cause the
 * organisation has since retired goes on serving that cause's name, because the form goes on
 * taking gifts and a donor reading a blank where the cause was is the worse answer. retiring a
 * cause is what stops it being *offered*, and the pin is not an offer.
 *
 * `choice` is `readActivePrograms`, which does hide them, for the same reason read the other way:
 * every option in that list is one a donor may still pick.
 *
 * a pin naming a row that is not there answers `null`, and `form_program_pinned_check` in
 * ../db/schema.ts is why that is a fault rather than an ordinary state — the column pair cannot
 * hold `pinned` with no id, and nothing deletes from `program` (../programs/queries.ts). the
 * config serves no cause rather than refusing: the form is live and the gift is what matters.
 */
async function readFormProgram(db: Db, form: FormRecord): Promise<Program | null> {
	if (form.programMode === 'pinned') {
		if (form.programId === null) return null;
		const pinned = await readProgram(db, form.programId);
		return pinned === null ? null : { mode: 'pinned', name: pinned.name };
	}
	if (form.programMode === 'choice') {
		return { mode: 'choice', options: await readActivePrograms(db) };
	}
	return null;
}

/**
 * the config for one form, or the first thing standing in its way.
 *
 * the refusals are ordered from the request outwards: the id, then the form's own status, then
 * its own fields, then the organisation's details, then the deployment's payment keys. that
 * order means the first answer an integrator gets is about the thing they named, and the later
 * ones are about a deployment they may not be able to see at all.
 */
export function publishedConfig(sources: PublishedConfigSources): PublishedConfigResult {
	const { id, form } = sources;

	if (form === null) {
		return refusal(
			null,
			'form_not_found',
			`No form with id \`${redactPublicId(id)}\` exists on this deployment.`,
			'Check the `form` attribute on the donation element against the snippet shown under ' +
				'Forms in /admin. A form is never deleted here, so an id that once worked still resolves.'
		);
	}

	// only a live form serves. the two other statuses are refused separately because the way out
	// of each is a different screen: a draft is published from the form's own edit page, and a
	// retired form cannot be published at all — the three `updateForm*` group writes and
	// `archiveForm` in ./queries.ts all refuse a row with `archived_at` set and nothing here
	// clears it, so the way forward is
	// a new form and a new snippet.
	//
	// `status` decides both, though `archived_at` is the column that records the retirement:
	// `archiveForm` writes the pair in one statement precisely so they cannot come apart, and
	// `FormRecord` carries the status rather than the timestamp.
	if (form.status === 'draft') {
		return refusal(
			form,
			'form_not_published',
			`Form \`${redactPublicId(form.id)}\` has status \`draft\`, so it serves no donation form yet.`,
			'Open Forms in /admin, choose this form, set its status to Live and save. Until then the ' +
				'snippet is there so the site can be set up ahead of publishing.'
		);
	}

	if (form.status === 'archived') {
		return refusal(
			form,
			'form_retired',
			`Form \`${redactPublicId(form.id)}\` has status \`archived\` and was retired.`,
			'A retired form cannot be published again. Create a new form under Forms in /admin and ' +
				'replace the snippet on the site with the new one.'
		);
	}

	// the columns behind these are the form's own, so the fix is one screen for all of them — and
	// one screen is one code. every branch from here to the profile check answers
	// `form_unservable`, and the message is what names the box on that screen to go and change.
	// splitting them by which box would be two codes carrying this identical sentence, which is
	// one code spelled twice.
	const formFix =
		`Open Forms in /admin, choose \`${redactPublicId(form.id)}\` and save it again — the edit ` +
		'screen refuses every value named here before it stores one.';

	// both bounds, and the smaller one first. `parseFormInput` refuses a blank on either, so no
	// save through /admin produces this; a row written another way can, and `readFormConfig` in
	// packages/form/src/config.ts refuses the same shape at the far end. served, it would be a form that
	// renders and then refuses every amount a donor types.
	const { minMinor, maxMinor } = form;
	if (minMinor === null || maxMinor === null) {
		const unset = [
			...(minMinor === null ? ['min_minor'] : []),
			...(maxMinor === null ? ['max_minor'] : [])
		];
		return refusal(
			form,
			'form_unservable',
			`Form \`${redactPublicId(form.id)}\` has no amount bounds: ${unset.join(' and ')} ` +
				`${unset.length === 1 ? 'is' : 'are'} not set, so no amount a donor types is ever ` +
				'complete.',
			formFix
		);
	}

	// a bound of zero, which the table stores and the donation form will not read. the column
	// checks in ../db/schema.ts are `is null or >= 0`, so 0 is a value that arrives here — while
	// `readFormConfig` in packages/form/src/config.ts reads both bounds through `wholeAtLeast(value, 1)`
	// and drops the whole config when either is below it. served, that is the blank donation form
	// this module exists to prevent, and it is blank on a page nobody here can see.
	//
	// the floor is 1, not `MIN_AMOUNT_MINOR` in ./form-input.ts. that constant is 50, which is
	// what the edit screen holds an operator to; this function's contract is narrower — refuse
	// exactly what the client refuses — and refusing at 50 would turn away a config the donation
	// form would have rendered.
	//
	// checked before the pair is compared, so that a single unusable bound is named as itself
	// rather than as one end of an inverted range: a `max_minor` of 0 under a `min_minor` of 500
	// is one box to go and fix, and "the smallest is above the largest" points at both.
	const belowOne = [
		...(minMinor < 1 ? [`min_minor is ${minMinor}`] : []),
		...(maxMinor < 1 ? [`max_minor is ${maxMinor}`] : [])
	];
	if (belowOne.length > 0) {
		return refusal(
			form,
			'form_unservable',
			`Form \`${redactPublicId(form.id)}\` has an amount bound below one cent: ` +
				`${belowOne.join(' and ')}. The donation form drops a config whose smallest or largest ` +
				'gift is below 1, so it would render nothing at all.',
			formFix
		);
	}

	if (minMinor > maxMinor) {
		return refusal(
			form,
			'form_unservable',
			`Form \`${redactPublicId(form.id)}\` has a smallest gift of ${minMinor} above its ` +
				`largest of ${maxMinor}, so it would refuse every amount.`,
			formFix
		);
	}

	// nothing here tests what a donor may choose against the row, and there is nothing on the row to
	// test: both answers are the deployment's rather than the form's — `offeredRails` in
	// ./offered-rails.ts and `offeredCadences` in ./offered-cadences.ts — so no form can be made that
	// offers neither.
	//
	// neither list is guarded here against being empty, and they are unguarded for different reasons.
	// the cadences need no guard: `offeredCadences` is total over the payment port's standings and
	// answers with one-time alone on every arm that is not ready, an invariant held where the value
	// is minted by the case in ./offered-cadences.spec.ts. the rails have no such floor — an account
	// approved for none of them offers none — and the guard for that is `renderableConfig` below,
	// which the config route composes and this ladder does not. its header says why: this function is
	// shared with the donation path, and an empty rail list must narrow what a later form offers
	// without refusing a gift already in flight.

	// the identity a gift is solicited under, and the one thing the form cannot know and is not
	// allowed to omit from a screen soliciting a tax-deductible gift. `readFormConfig` in
	// packages/form/src/config.ts drops the whole config over either of them, so a config served short
	// of them is a donation form that does not appear on a site nobody here can see.
	//
	// two fields, and a different two from `RECEIPT_FIELDS` in ../org/receipt-fields.ts, because
	// the two answer different questions: that list is what a receipt prints after the gift, this
	// is what the screen asking for the gift has to state while asking. the address is on one and
	// not the other. the deductibility statement is on neither — it is served whatever the column
	// holds (../org/deductibility.ts), so nothing is refused over it.
	//
	// `tax_id` is legitimately absent on a fresh deployment — the column is nullable and nothing
	// seeds the row — which makes this the likeliest of the six refusals rather than an exotic one.
	//
	// `present` is ../org/receipt-fields.ts's, shared rather than spelled again here: a blank row
	// that is unset to a receipt and filled in to this gate is two answers to one question. it is
	// not `!== null`, and the reason is that what arrives here is an `OrgProfile` value rather
	// than a row — nothing in that type records that the column's `not_blank` check ran, and a
	// blank string passes a null test while putting an empty legal name on the screen that asks
	// for money. the same reason the inverted-bounds branch above does not lean on
	// `form_min_max_minor_check`.
	const { profile } = sources;
	const legalName = profile?.legalName ?? null;
	const taxId = profile?.taxId ?? null;
	// the organisation's own wording where it holds one and the standard sentence otherwise, so a
	// served config always carries the claim the form states while asking (../org/deductibility.ts).
	const deductibilityStatement = servedDeductibilityStatement(
		profile?.deductibilityStatement ?? null
	);
	if (!present(legalName) || !present(taxId)) {
		// named as columns rather than as the row's properties, because whoever reads this has to
		// go and fill the box in, and `tax_id` is greppable in a way `taxId` is not once it has
		// been through a JSON body.
		const absent = [
			...(present(legalName) ? [] : ['legal_name']),
			...(present(taxId) ? [] : ['tax_id'])
		];
		return refusal(
			form,
			'org_profile_incomplete',
			`This deployment has not saved the identity a gift is solicited under: ` +
				`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} not set. A form that ` +
				'asks for a tax-deductible gift may not omit them.',
			'Open the console (`better-giving start`). The registered name and the EIN are under ' +
				'Organisation.'
		);
	}

	// the payment keys, last because they are the furthest from the request: an integrator
	// reading this answer may have no access to the deployment that has to change.
	//
	// a processor's server half is checked here alongside its browser half though only the browser
	// half is served. the next request the form makes after this is the one that charges, so a
	// config handed to a deployment that cannot charge is a form that renders and fails at the
	// last step, which is the worse of the two failures. `servedProcessors` in
	// ../payments/factory.ts is where both halves are read, so which processors this deployment can
	// serve a form on is decided beside which ones it can charge on rather than twice.
	const processors = servedProcessors(sources.env);
	if (processors.providers.length === 0) {
		return refusal(
			form,
			'payments_not_configured',
			`This deployment cannot take a donation: ${processors.shortfall}.`,
			// the sentence a deployment part-way through one processor's pair is handed names that
			// processor's own dashboard, which is what makes it a fix rather than an errand
			// (`ServedProcessors.fix` in ../payments/factory.ts).
			processors.fix
		);
	}

	const turnstileSiteKey = (sources.env.TURNSTILE_SITE_KEY ?? '').trim();
	const program = servedProgram(sources.program);

	return {
		ok: true,
		form,
		config: {
			formId: form.id,
			// every processor this deployment can both charge on and start an SDK for, in the port's
			// own order. `providers` is a set (`FormConfig` in packages/form/src/v1.ts) and each
			// adapter on the donor's page takes its own entry by name, so a deployment holding a
			// second processor names it beside the first rather than replacing it.
			providers: processors.providers,
			currency: form.currency,
			suggestedAmountsMinor: form.suggestedAmounts,
			minAmountMinor: minMinor,
			maxAmountMinor: maxMinor,
			// the deployment's own answer and never this row's. `frequencies` stays on the wire — it is
			// a permanent contract (`FormConfig` in packages/form/src/v1.ts) — and the value comes from
			// whether this deployment's processor account can collect a repeating gift, read by
			// `offeredCadences` in ./offered-cadences.ts.
			//
			// narrower than what a gift is accepted on, and `paymentMethods` below is narrower under
			// the same rule: `parseQuoteRequest` in ../donations/quote-input.ts reads `FREQUENCIES` in
			// packages/form/src/v1.ts and `OFFERED_PAYMENT_METHODS` in ../../forms/offered-rails.ts
			// whole, so a cadence or a rail this list has stopped offering is still charged rather than
			// refused. the served config is cached and reaches pages this deployment cannot recall
			// (CLAUDE.md), so refusing either would be a donor on a page we published being turned away
			// at the last step.
			frequencies: sources.cadences,
			// the deployment's own answer and never this row's, the same as `frequencies` above and
			// under the same rule: which of the rails this repository has a form for the processor
			// account is approved for, read by `offeredRails` in ./offered-rails.ts.
			paymentMethods: sources.rails,
			feeCoverage: SERVED_FEE_COVERAGE,
			// every rail the vocabulary holds, composed from each processor's own table
			// (`servedFeeRules` in ../payments/fees.ts). which of the two PayPal tables is the one thing
			// about that processor's pricing this deployment cannot read off the account, so it comes off
			// a deploy-time answer (`paypalFeeRules` beside it).
			feeRules: servedFeeRules(paypalFeeRules(sources.env)),
			locale: SERVED_LOCALE,
			orgLegalName: legalName,
			ein: taxId,
			deductibilityStatement,
			// omitted rather than sent empty where this deployment has no widget. the field is
			// optional on the contract and `readFormConfig` drops a blank one anyway, so a key
			// holding `''` would be a field that reads as configured and is not.
			...(turnstileSiteKey === '' ? {} : { turnstileSiteKey }),
			// omitted rather than sent empty, the same call the sitekey above takes: the field is
			// optional on the contract and `readFormConfig` drops what `servedProgram` drops.
			...(program === null ? {} : { program })
			// `monthlyAsk` stays declared on the contract in packages/form/src/v1.ts because `v1` is
			// add-never-rename (CLAUDE.md), and nothing on either side touches it: no code here
			// sets it and no code in packages/form/src/ reads it.
		}
	};
}

/**
 * the cause a config states, or nothing.
 *
 * one judgement, and it is about a `choice` alone: an empty `options` is served as no program at
 * all, because `readFormConfig` in packages/form/src/config.ts reads it that way and says why —
 * a select drawn over nothing is a question with no answers, and the gift goes where it is needed
 * most either way. served, it would be a control the donation form draws from this config and
 * then drops, on a site nobody here can see.
 *
 * a `pinned` shape is never empty: the name is a column with a `not_blank` check behind it.
 */
function servedProgram(program: Program | null): Program | null {
	if (program === null) return null;
	return program.mode === 'choice' && program.options.length === 0 ? null : program;
}

/**
 * the fee-coverage mode every form serves, and no column decides it.
 *
 * `optional` is the only mode `FEE_COVERAGE_MODES` in packages/form/src/v1.ts admits, and the fee line is
 * a donor toggle because of it: `payerCoversFee` in packages/form/src/value.ts returns the donor's own
 * answer, falling back to `DEFAULT_COVERS_FEE` beside it, which is `true` — so the line renders
 * ticked with a way to untick it. that is a donor's decision with an on-by-default rather than an
 * org's setting, which is why nothing in /admin offers a box for it. the field stays on the wire
 * because `v1` is add-never-rename (CLAUDE.md), and there is nothing else it could say.
 */
const SERVED_FEE_COVERAGE = 'optional' as const;

/**
 * the locale the config states, sent rather than left to the client's fallback.
 *
 * `FormConfig` types `locale` as a required string, so a response that omitted it would be one
 * its own contract describes wrongly — the fallback in `readFormConfig` is there for a garbled
 * response, not as this endpoint's storage. it is a constant because no column holds one and
 * every form is denominated in USD (`FORM_CURRENCY` in `$lib/forms/amounts.ts`); a form denominated
 * elsewhere is what turns this into data.
 */
const SERVED_LOCALE = 'en-US';

/**
 * the same answer, or a refusal where what it holds is a config no donation form would render.
 *
 * one rule, and it is the config *route's* rather than the ladder's: `readFormConfig` in
 * packages/form/src/config.ts drops a config offering no rail, so a body served with an empty
 * `paymentMethods` is a donation form that silently does not appear on a site nobody here can see.
 * refusing instead puts a named value and a screen in front of an integrator.
 *
 * **it is deliberately not part of `publishedConfig` above, and that is the whole point of it being
 * a separate function.** `readPublishedConfig` is the ladder `mintQuote` in ../donations/quote.ts
 * shares, and a rail list that has gone empty must narrow what a *later* form is offered while
 * changing nothing about a donation already in flight — the served config is cached and reaches
 * pages this deployment cannot recall (CLAUDE.md), so a donor mid-checkout on a page from five
 * minutes ago is charged rather than turned away. folded into the ladder, this refusal fires on
 * their POST instead, and its `fix` sends a donor to /admin. the live way in is a capability the
 * processor flips to `pending` while it re-verifies an account: the read succeeds and answers no, so
 * `offeredRails` in ./offered-rails.ts does not widen it. `mintQuote() — a rail the account has
 * stopped offering` in ../donations/quote.workers.spec.ts is what fails if this is ever folded back.
 *
 * a function over the result rather than a flag on the reader, because a flag is one boolean away
 * from being passed the other way by a caller who did not read this paragraph — and because the
 * judgement stays a value, testable in the node pool, rather than moving into a `RequestHandler`
 * where it could only be read through a `Response`.
 *
 * unreachable from a processor nobody could read: that arm answers with the deployment's list whole,
 * so an empty list here is an account that answered and said no to every rail. the fix is on the
 * processor's own dashboard, and the console is where a standing per rail is already drawn, so
 * the sentence sends an operator there rather than naming a variable that is set correctly.
 */
export function renderableConfig(result: PublishedConfigResult): PublishedConfigResult {
	if (!result.ok || result.config.paymentMethods.length > 0) return result;

	// the processors that answered and the rails those processors settle, rather than the whole
	// vocabulary: a deployment holding PayPal alone has no Stripe account whose standings could be
	// read and no card rail anything here could mint, so naming either sends an operator looking for
	// a screen that does not exist. taken out of the port's own list rather than off the served one,
	// because `Provider.name` in packages/form/src/v1.ts is a string on purpose — a name off the
	// wire is not one this repository has a label or a rail table for.
	const named = new Set(result.config.providers.map((provider) => provider.name));
	const answering = PROCESSOR_NAMES.filter((name) => named.has(name));
	const labels = answering.map((name) => PROCESSOR_LABELS[name]).join(' and ');
	const rails = OFFERED_PAYMENT_METHODS.filter((rail) => answering.includes(processorOf(rail)));
	const one = answering.length === 1;

	return refusal(
		result.form,
		'payments_not_configured',
		`This deployment cannot serve a donation form: ${labels} ${one ? 'is' : 'are'} approved for ` +
			`none of the rails ${one ? 'it settles' : 'they settle'} (${rails.join(', ')}).`,
		'Open the console (`better-giving start`), read the standing shown against each rail, and clear ' +
			'it where the processor’s own dashboard says to. A rail switched off there is one switch; ' +
			'a capability never requested has to be asked for.'
	);
}

/**
 * one refusal, with the reason doubling as the wire's `error` code.
 *
 * the row comes first because every refusal has to carry it: the endpoint answers a 4xx with CORS
 * headers naming the sites this row's `allowed_origins` holds, and a body a browser cannot read is
 * a refusal that reaches nobody.
 */
function refusal(
	form: FormRecord | null,
	reason: PublishedConfigRefusal,
	message: string,
	fix: string
): PublishedConfigResult {
	return { ok: false, form, reason, error: { error: reason, message, fix } };
}
