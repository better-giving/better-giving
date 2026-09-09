// what the donor has decided, in the two shapes the flow needs: the draft a screen is still
// filling in, and the completed value every later state is allowed to assume.
//
// the pair is the load-bearing idea in this whole directory. the flow's steps are meant to
// read as:
//
//   type State =
//     | { step: 'amount';  fv?: FormValue }
//     | { step: 'details'; fv:  FormValue }   // fv is required here, by construction
//
// a step is a variant that carries its value, so an unreachable step cannot hold stale data.
// that promise is only true if there is exactly one place a draft becomes a value and it
// refuses everything that is not one — otherwise `give` holds an `fv` that the type says is
// complete and that is half-filled in fact, which is worse than an optional one because
// nothing checks it. `completeAmount` is that place, and ./connect.ts is where the projection
// is built on top of it.
//
// the details step has its own completion and its own type because the value carried into it is
// the amount decision; the donor fields are collected once the donor is already there. folding
// both into one `FormValue` would make entering `details` require an email nobody has typed yet,
// and the only way to satisfy that is a placeholder — which is the stale data this design avoids,
// arriving through the front door.
//
// the validation is shallow on purpose and none of it is a security control: `/api/v1`
// re-checks the amount bounds server-side against the form record and never trusts the posted
// amount. what these functions buy is a donor not watching a submit fail for a reason the
// screen already had in hand. anything stricter starts refusing real donors, on someone else's
// website, where nobody will ever tell us.
//
// imports the contract and nothing else — no framework, no DOM, no Stripe.
//
// `../package.json` exports this module as `./value`, types only. the predicates stay ./connect.ts's
// to call: a renderer reaching for `completeAmount` here would be re-answering a question the
// projection has already answered for it, which is the second copy the pair above exists to prevent.

import {
	WALLET_METHODS,
	type FormConfig,
	type Frequency,
	type PaymentMethod,
	type TributeKind,
	type WalletMethod
} from './v1';

/**
 * the amount screen mid-edit: every field optional, because every one of them is.
 *
 * a draft is not a partial form value, and is deliberately its own type rather than
 * `Partial<FormValue>`. the two diverge the moment a field is held differently while being
 * typed than once it is settled — the "Other" box holds text before it holds an amount — and a
 * `Partial<>` alias would make that divergence a breaking change to `FormValue`.
 */
export type AmountDraft = {
	readonly amountMinor?: number | undefined;
	readonly frequency?: Frequency | undefined;
	/**
	 * the note, and whether the donor asked to write one at all.
	 *
	 * absent and empty are two different answers here, and the difference is the whole of what the
	 * screen's disclosure means: absent is a donor who never opened the note, `''` is one who opened
	 * it and has written nothing yet. that is why the intent rides on this field rather than on a
	 * second boolean beside it — two fields for one decision can disagree, and the pair whose
	 * disagreement matters is exactly the one nothing would check.
	 *
	 * so a note is required from the moment it is asked for, and `missingAmountDecisions` below is
	 * where that is said. a renderer never reads its own checkbox to find out: the disclosure is
	 * opened by whether this field is present, which keeps which control is marked the flow's answer
	 * (./views.ts).
	 */
	readonly note?: string | undefined;
	/**
	 * the gift given for someone else, and whether the donor asked to dedicate one at all.
	 *
	 * exactly `note`'s distinction one level down, and for its reason: absent is a donor who never
	 * opened the tribute, and a present shape is one who did and still owes what is inside it. the
	 * intent rides on this field rather than on a boolean beside it, so the disclosure the renderer
	 * opens and the decisions `missingAmountDecisions` holds a press to are one answer.
	 *
	 * every box inside is a string the moment it is present — `OPENED_TRIBUTE` below is what the
	 * disclosure opens with — so nothing here has a second absent state to sort out. `kind` is
	 * seeded rather than left undecided because the control that carries it is a two-member choice
	 * with no unset reading: a select drawn on `honor` while the draft held nothing would be the
	 * screen and the flow saying different things about the same gift.
	 */
	readonly tribute?: TributeDraft | undefined;
	/**
	 * which of the form's causes the donor picked, absent while they have picked none.
	 *
	 * absent and picked are not the two answers `note` above draws its distinction between: there is
	 * nothing here for a donor to open, and the control is drawn from the moment the step is
	 * (./views.ts). so an absent id is the option the select is resting on — the gift going where it
	 * is needed most — and never a question nobody has reached yet, which is why it is not a decision
	 * `missingAmountDecisions` below can refuse a press for.
	 */
	readonly programId?: string | undefined;
};

/**
 * the tribute block mid-edit: four boxes, each holding whatever is in it.
 *
 * the notify pair is optional *as a pair* and blank is a real answer — a donor who asked for
 * nobody to be told. that is why they are `''` here rather than absent: there is nothing for a
 * donor to open, so there is no second state for a presence to carry.
 */
export type TributeDraft = {
	readonly kind: TributeKind;
	readonly honoree: string;
	readonly notifyName: string;
	readonly notifyEmail: string;
};

/**
 * what the disclosure opens with, and the one place the seeded kind is written.
 *
 * `honor` rather than a placeholder option nobody picked: the control is a two-member choice and
 * the words on it are what a donor reads before they type the name beside it, so a third reading
 * would be an empty select above a required name — a decision the card asks for twice.
 */
export const OPENED_TRIBUTE: TributeDraft = {
	kind: 'honor',
	honoree: '',
	notifyName: '',
	notifyEmail: ''
};

/**
 * a gift given for someone else, settled.
 *
 * `notify` is one object or `null`, and that shape is the whole reason this is nested where the
 * wire it rides on is flat: there is no value of this type carrying a name and no address, so the
 * pairing the endpoint enforces stops being a rule anybody downstream has to remember. the same
 * nesting `ParsedQuoteRequest.tribute` has on the server, at the other end of four flat fields.
 */
export type Tribute = {
	readonly kind: TributeKind;
	readonly honoree: string;
	readonly notify: { readonly name: string; readonly email: string } | null;
};

/**
 * the settled amount decision — required from the details step onward, which is what makes an
 * unreachable step unable to hold stale data.
 *
 * `note` is omitted when blank rather than emptied: it rides to a payment-initiating endpoint,
 * and an empty string is a value something stores while an absent key is not. a note lands on
 * the donation row with a hard length cap, and **never** in `ledger_entry` — the ledger is
 * append-only, so donor-authored free text written there could never be redacted.
 */
export type FormValue = {
	readonly amountMinor: number;
	readonly frequency: Frequency;
	readonly note?: string;
	/**
	 * the cause the gift is credited to, and `null` where the donor chose none.
	 *
	 * required and nullable where `note` above is optional, because it is not the same kind of field:
	 * a donor who chose nothing has answered the question the select asks — where it is needed most —
	 * and an optional key would put that answer and a form that never asked down one path for every
	 * reader to sort out again. what the wire does with it is the other half of the same distinction:
	 * `null` sends no `programId` at all (`quoteRequest` in ./checkout.machine.ts), because the
	 * endpoint reads an absent field as exactly that answer.
	 */
	readonly programId: string | null;
	/**
	 * omitted when the donor never opened it, for a reason stronger than the note's.
	 *
	 * an absent `tributeKind` is how the endpoint is told a gift carries no tribute at all
	 * (`parseTribute` in the app's `donations/quote-input.ts`), so an empty shape sent here is not a
	 * blank value it stores — it is a kind on every gift, standing in as the enum's first member.
	 */
	readonly tribute?: Tribute;
};

/** the give screen mid-edit. */
export type PayerDraft = {
	readonly method?: PaymentMethod | undefined;
	readonly email?: string | undefined;
	readonly firstName?: string | undefined;
	readonly lastName?: string | undefined;
	readonly coversFee?: boolean | undefined;
	readonly consentedToContact?: boolean | undefined;
};

/**
 * a donor a quote can be minted for.
 *
 * `consentedToContact` is required and defaults to false. pre-ticked consent is not consent
 * under GDPR/UK GDPR, which require an affirmative act, and the liability for getting that
 * wrong lands on the deploying org rather than on us. a `boolean | undefined` here is the
 * shape that lets a `?? true` appear downstream; a required `false` is not.
 */
export type Payer = {
	readonly method: PaymentMethod;
	readonly email: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly coversFee: boolean;
	readonly consentedToContact: boolean;
};

/**
 * the decisions the amount step can refuse a press for, in the order a donor meets them.
 *
 * `note` is the conditional one: the step asks for it only where the donor asked for it first, and
 * a draft that never opened one is never short of it.
 */
export type AmountDecision =
	| 'amount'
	| 'note'
	| 'tribute-honoree'
	| 'tribute-notify-name'
	| 'tribute-notify-email';

/**
 * the caps the endpoint holds these three boxes to, copied because they cannot be imported.
 *
 * `MAX_NAME` and `MAX_EMAIL` in the app's `src/lib/contacts/input-schema.ts` are the originals and
 * are what `parseTribute` measures against; this package imports from nothing in that app, so the
 * numbers are stated here and the comment is the pointer. they are the same limits every other
 * stored name and address in this project carries — 320 is RFC 5321's maximum for an address and
 * the name cap is round-number headroom over any real one.
 *
 * spent as `maxlength` on the controls (../views.ts) rather than as a decision below, and that is
 * the division this file already draws: what a donor can reach by typing is the platform's to stop,
 * and what no control can express is what `missingAmountDecisions` answers. a value that defeats
 * the attribute is refused by the endpoint, which names the field and the limit.
 */
export const MAX_TRIBUTE_NAME = 200;
export const MAX_TRIBUTE_EMAIL = 320;

/**
 * which of the amount step's decisions this draft is still missing, in the order they are asked.
 *
 * a set rather than the first one, because a donor who has decided neither is missing both and
 * naming one at a time makes the same press look refused twice. the order is the order the
 * controls appear in, so the first entry is also the control a refused press should land on.
 *
 * this rule is hand-rolled and stays that way: "a preset is selected or a figure inside the
 * bounds was typed" is a decision over two controls at once, which no per-control constraint
 * the platform offers can express. the details step's fields do carry constraints of their own —
 * `required`, `type="email"`, `NAME_PATTERN` below — but which of them a press was refused for
 * is `missingPayerFields`'s answer there too, for the reason written on it.
 *
 * the cadence is not among them and cannot be. a fresh draft opens with one already chosen
 * (`settledDraft` in ./checkout.machine.ts), the control offers no way to un-choose, and the only
 * event that writes one carries a cadence the deployment offers — so there is no draft this
 * function is ever handed that is short of a frequency, and a decision nothing can be missing is
 * not one a press can be refused for. `completeAmount` below still narrows the field, which is a
 * type doing its job rather than a rule anybody reports.
 */
export function missingAmountDecisions(
	draft: AmountDraft,
	config: FormConfig
): readonly AmountDecision[] {
	const { amountMinor, note } = draft;
	const missing: AmountDecision[] = [];

	if (
		amountMinor === undefined ||
		!Number.isInteger(amountMinor) ||
		amountMinor < config.minAmountMinor ||
		amountMinor > config.maxAmountMinor
	) {
		missing.push('amount');
	}
	// trimmed, because that is what `completeAmount` carries: a note of spaces reaches the endpoint
	// as nothing at all, so accepting it here would be a press refused nowhere and a note nobody
	// sent. an absent note is a donor who asked for none and is short of nothing.
	if (note !== undefined && note.trim().length === 0) missing.push('note');
	missing.push(...missingTributeDecisions(draft.tribute));
	return missing;
}

/**
 * which of the tribute's boxes a press would still be refused for, in the order they are laid out.
 *
 * its own function because the pairing below is the whole of what this block adds, and it is the
 * rule the endpoint states in two directions: a kind requires an honoree, and the person to tell
 * needs a name and an address together or neither of them. an unopened tribute is short of nothing.
 *
 * both notify boxes blank is a donor who asked for nobody to be told, and it is the case this
 * exists to let through — the pairing refuses the half-filled state and never the empty one.
 */
function missingTributeDecisions(tribute: TributeDraft | undefined): readonly AmountDecision[] {
	if (tribute === undefined) return [];
	const missing: AmountDecision[] = [];

	// trimmed for the note's reason: a name of spaces reaches the endpoint as nothing at all, so
	// accepting it is a press refused nowhere and a tribute that names nobody.
	if (tribute.honoree.trim().length === 0) missing.push('tribute-honoree');

	const name = tribute.notifyName.trim();
	const email = tribute.notifyEmail.trim();
	if (name === '' && email === '') return missing;
	if (name === '') missing.push('tribute-notify-name');
	// the address is held to the same shallow rule the payer's own is, and for the extra reason
	// stated at the wire: it belongs to somebody who never gave it to us, so a bounce on it is
	// scored against the domain every receipt also leaves from.
	if (!looksLikeAnAddress(email)) missing.push('tribute-notify-email');
	return missing;
}

/**
 * the draft as a value, or `null` when the donor is not finished.
 *
 * `null` rather than an error list, because this is a guard rather than a validator. what is
 * still missing is a separate question with a separate answer above, so the guard and the
 * sentence a screen renders cannot come apart: a press this refuses always has something for
 * `missingAmountDecisions` to name.
 *
 * the `frequency === undefined` half of the narrowing below is the one exception and is not a
 * refusal anybody reports: the cadence is settled before a donor reaches this step and is not a
 * decision the set above carries, so this is the type being satisfied rather than a press being
 * turned away. it is unreachable in the same sense and for the same reason.
 */
export function completeAmount(draft: AmountDraft, config: FormConfig): FormValue | null {
	if (missingAmountDecisions(draft, config).length > 0) return null;
	const { amountMinor, frequency } = draft;
	if (amountMinor === undefined || frequency === undefined) return null;

	const note = (draft.note ?? '').trim();
	const tribute = settledTribute(draft.tribute);
	return {
		amountMinor,
		frequency,
		programId: draft.programId ?? null,
		...(note.length > 0 ? { note } : {}),
		...(tribute === null ? {} : { tribute })
	};
}

/**
 * the tribute draft as the value that rides to the endpoint, or `null` when there is none.
 *
 * reached only past `missingAmountDecisions`, so every box it reads has already been held to its
 * rule — which is what lets it assemble rather than re-decide. the pairing is answered by the shape
 * it returns: both notify boxes blank is `notify: null`, and there is no third case left.
 */
function settledTribute(draft: TributeDraft | undefined): Tribute | null {
	if (draft === undefined) return null;
	const honoree = draft.honoree.trim();
	const name = draft.notifyName.trim();
	const email = draft.notifyEmail.trim();
	return {
		kind: draft.kind,
		honoree,
		notify: name === '' || email === '' ? null : { name, email }
	};
}

/**
 * what the donor is taken to have answered before they answer.
 *
 * the fee line is opt-out: it is covered when the receipt first renders and the donor's own
 * answer replaces this the moment they give one.
 */
export const DEFAULT_COVERS_FEE = true;

/**
 * whether this draft covers the fee.
 *
 * the one place the default lives, and the reason it is a function over a one-line `??`. the
 * figure on the fee row, the state of the control that changes it, the estimate and the payer a
 * quote is minted from are four readings of one decision — a bare `draft.coversFee ?? true` at
 * any of them is a second copy of the default, and two copies are one edit away from a donor
 * charged a fee the control beside it says they declined.
 */
export function payerCoversFee(draft: PayerDraft): boolean {
	return draft.coversFee ?? DEFAULT_COVERS_FEE;
}

/** whether a rail's own sheet is the consent moment, which is what excludes it from the fields below. */
export function isWalletMethod(method: PaymentMethod): method is WalletMethod {
	const wallets: readonly PaymentMethod[] = WALLET_METHODS;
	return wallets.includes(method);
}

/**
 * whether the rail the payment surface reported is one the Donate control may charge.
 *
 * the half of `completePayer` that no typed field can answer and no renderer can see: the
 * provider's fields are in a frame on its own origin, so "the donor has not finished the card"
 * reaches this form only as an absent or unusable method. a screen that could not tell that
 * apart from a missing email is a screen that names the wrong thing on a refused press, which
 * is why it is a question of its own rather than a clause inside the constructor below.
 *
 * the config's own list is the whole test, wallets included. a wallet reaches here because the
 * donor picked it as an option in the provider's box and the sheet it opens is opened by the
 * confirmation rather than by this press — so the rail is chargeable in exactly the sense every
 * other member of that list is, and `chosenRail` in ./embed/stripe.ts is what guarantees nothing
 * outside the list can be reported in the first place.
 */
export function methodIsChargeable(draft: PayerDraft, config: FormConfig): boolean {
	const { method } = draft;
	return method !== undefined && config.paymentMethods.includes(method);
}

/** the three fields the details step asks for, in the order they sit on the card. */
export type PayerField = 'email' | 'firstName' | 'lastName';

/**
 * the rule a name field carries as an `<input pattern>`, so the control refuses what this file
 * refuses.
 *
 * `required` alone passes on a single space, and every name here is trimmed before its length is
 * read — so without this a space is a press the flow refuses with every field reading clean,
 * which is the silence the details step's messages exist to end. the two are held to agreeing in
 * ./styles/validity.browser.spec.ts, against a real engine.
 *
 * the flow's own rule stays below and is not replaced by this one: `completePayer` gates a
 * payment-initiating path, and an attribute is one keystroke in a console away from being gone.
 */
export const NAME_PATTERN = '.*\\S.*';

/**
 * which of the details step's fields this draft is still missing, in the order they are asked.
 *
 * the same relationship `missingAmountDecisions` has to `completeAmount`: the guard and the
 * sentence a screen renders come from one rule, so a refused press always has a field to name.
 * a renderer that asked the control instead would be reading a second rule — the engine's — and
 * the two disagree on an address like `donor@example_fund.org`, which this file accepts and an
 * `<input type="email">` does not.
 *
 * an accented domain is not one of the disagreements, however it reads: an engine punycodes what
 * was typed before it judges it, so `donor@exämple.de` reaches `value` already ASCII and passes.
 * ./styles/validity.browser.spec.ts is where a divergence is chosen against a real engine rather
 * than against a rule someone remembered.
 */
export function missingPayerFields(draft: PayerDraft): readonly PayerField[] {
	const missing: PayerField[] = [];

	if (!looksLikeAnAddress((draft.email ?? '').trim())) missing.push('email');
	if ((draft.firstName ?? '').trim().length === 0) missing.push('firstName');
	if ((draft.lastName ?? '').trim().length === 0) missing.push('lastName');
	return missing;
}

/**
 * the donor draft as a payer, or `null` while a field the receipt needs is missing.
 *
 * a wallet rail is refused here, through `methodIsChargeable` above. Apple Pay and Google Pay
 * take their authorization in a sheet of their own, and this form opens none — a payer this
 * function accepted on a wallet rail would mint an intent on a rail nothing here can spend.
 */
export function completePayer(draft: PayerDraft, config: FormConfig): Payer | null {
	const { method } = draft;
	if (method === undefined || !methodIsChargeable(draft, config)) return null;
	if (missingPayerFields(draft).length > 0) return null;

	const email = (draft.email ?? '').trim();
	const firstName = (draft.firstName ?? '').trim();
	const lastName = (draft.lastName ?? '').trim();

	return {
		method,
		email,
		firstName,
		lastName,
		coversFee: payerCoversFee(draft),
		consentedToContact: draft.consentedToContact ?? false
	};
}

/**
 * whether a string could be an email address at all.
 *
 * deliberately shallow, and the shallowness is the decision. deliverability is not decidable
 * from a string — the receipt bouncing is the only real test — so what this catches is the
 * typo the donor can still fix while looking at the field they typed it in. every stricter
 * pattern anyone reaches for here refuses some real address, and it does so on someone else's
 * website where the donor simply leaves.
 *
 * it is looser than an `<input type="email">`, and that direction is deliberate. this rule is
 * what refuses the press and `missingPayerFields` above is what a renderer marks from, so a
 * value the browser calls valid must never be one this refuses — a press refused with every
 * field reading clean is a donor with nothing to fix. the engine's answer is read for one thing
 * only, which sentence to show (./views.ts), and it never decides which field is marked. the
 * containment is measured in ./styles/validity.browser.spec.ts against a real engine, because a
 * lightweight DOM ships an email rule of its own.
 */
function looksLikeAnAddress(value: string): boolean {
	if (/\s/.test(value)) return false;
	const at = value.indexOf('@');
	return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1;
}
