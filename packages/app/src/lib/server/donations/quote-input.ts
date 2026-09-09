import { z } from 'zod';
import {
	FREQUENCIES,
	TRIBUTE_KINDS,
	type Frequency,
	type FormConfig,
	type PaymentMethod,
	type TributeKind
} from '@better-giving/form/v1';
import { EMAIL, MAX_EMAIL, MAX_NAME } from '../../contacts/input-schema';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import {
	parseContact,
	type ContactFormValues,
	type ParsedContact
} from '../contacts/contact-input';

// what a donor posted, checked against the form record rather than believed.
//
// pure: no database, no clock, no network. every rule here is decidable from the body and the
// config the same request already read, which is the split ./record.ts draws against ./quote.ts and
// the one ../forms/form-input.ts draws against ../forms/queries.ts.
//
// the amounts are the reason it exists. `/api/v1` is public, unauthenticated and
// payment-initiating (CLAUDE.md), so an amount that arrived from a browser is an input to look up
// against the form record and never a figure to charge — a donor who edits the request body to
// `amountMinor: 1` is refused here, by the same bounds the element was served.
//
// how the rules are split, which is the same split ../contacts/contact-input.ts draws and a
// different answer to what a failure looks like. each field's own rule — is it a whole number, is
// it one of these, is it a string under this many characters — is a zod schema declaring its own
// message, so a sentence names the wire field rather than a type. the order those schemas run in
// is plain typescript below them, because the order is itself the rule: one problem at a time (see
// the note above `parseQuoteRequest`), so a check that has not run yet is a check whose message
// nobody is going to be shown.

/** one donor's submission, once every value in it has been checked against the form. */
export type ParsedQuoteRequest = {
	/** minor units, within the form's own bounds. what the donor chose to give. */
	readonly amountMinor: number;
	readonly frequency: Frequency;
	/** one of the rails this deployment offers. */
	readonly method: PaymentMethod;
	/** whether the donor is paying the processing fee on top. */
	readonly coversFee: boolean;
	/** the payer, through the same parser /admin's create form uses. */
	readonly donor: ParsedContact;
	/**
	 * the donor's own answer about being written to, as they gave it — or `null` where the
	 * integrator never asked.
	 *
	 * three states rather than two, because `contact.consented_to_contact` is nullable and holds
	 * three (../db/schema.ts). `false` is a donor who was asked and declined; `null` is a donor
	 * nobody asked, which is not the same fact and must not be recorded as one. the field is still
	 * required on the wire — an absent one is refused — so every value that arrives here is a
	 * statement rather than an omission, and `null` is the statement "we did not ask".
	 */
	readonly consentedToContact: boolean | null;
	/**
	 * what the donor wrote for the organisation, trimmed — or absent where they wrote nothing.
	 *
	 * a message of whitespace is absent rather than empty, because `donation.note` carries no check
	 * of its own and `''` in that column is a message that was never written.
	 */
	readonly note: string | undefined;
	/** the person this gift honors or remembers, or `null` where the donor marked none. */
	readonly tribute: Tribute | null;
	/**
	 * the cause the donor picked off the form's own list, or absent where they picked none.
	 *
	 * only ever a donor's own pick. a form pinned to one cause sends nothing here and the pin is
	 * written from the form record instead (`Program` in packages/form/src/v1.ts), so a value that
	 * survived this parser is always a form that offered a choice and a donor who made one.
	 */
	readonly programId: string | undefined;
	/** whatever was presented as a challenge token, checked by nothing here. */
	readonly turnstileToken: string | undefined;
};

/**
 * a gift marked as given in honor or in memory of a named person.
 *
 * nested where every other field on `ParsedQuoteRequest` is flat, and the nesting is the
 * enforcement: `donation.tribute_kind` and `donation.tribute_honoree` are two nullable columns
 * carrying no constraint between them, and this type is where "a kind names somebody" and "the
 * person to tell is told about somebody" stop being possible to get wrong downstream. the wire
 * stays flat — CLAUDE.md refuses a body naming a value inside another — so the four submitted
 * fields become this shape here and nowhere else.
 */
export type Tribute = {
	readonly kind: TributeKind;
	/** trimmed and non-blank. one of these without a `kind` is refused, and so is the reverse. */
	readonly honoree: string;
	/**
	 * the person to tell, or `null` where the donor asked for nobody to be told.
	 *
	 * both halves or neither: an address with no name has nobody to greet, and a name with no
	 * address reaches no one. the two columns behind it are nullable and independent, so this is
	 * the only place the pair is held together.
	 */
	readonly notify: { readonly name: string; readonly email: string } | null;
};

/**
 * a body that was not accepted, and the sentence naming what to change.
 *
 * named because the tribute rules are parsed by a helper that returns one of these on its own — the
 * refusal it produces is the endpoint's refusal, and there is nothing to translate at the seam.
 */
export type Refusal = { readonly ok: false; readonly message: string; readonly fix: string };

/** a submission that may be quoted, or the first thing wrong with it. */
export type QuoteInputResult = { readonly ok: true; readonly value: ParsedQuoteRequest } | Refusal;

/**
 * the longest note this accepts.
 *
 * the donor's other stored values are bounded by `parseContact`, which has its own limits and its
 * own reasons. this one is bounded here because `donation.note` is not bounded there: unbounded, it
 * is a field a stranger can make arbitrarily large on an unauthenticated path, and the bound has to
 * hold before the write rather than at it, since a length check on that column would be a
 * constraint added to a table that already exists (../db/schema.ts).
 */
const MAX_NOTE = 2_000;

/**
 * the body itself: a JSON object, and not an array.
 *
 * `looseObject` rather than a schema naming the fields, because every field below is read against a
 * schema of its own and in an order this one could not express. what it buys over
 * `typeof body === 'object'` is the array case, which that test answers `true` for.
 */
const BODY = z.looseObject({});

/**
 * a whole number of minor units.
 *
 * `z.int()` bounds the safe-integer range as well as integrality — the same rule
 * `Number.isSafeInteger` states, and the one a money figure needs: a number past 2^53 has already
 * been rounded by the time anything here could refuse it.
 */
const MINOR_UNITS = z.int({
	error: (issue) =>
		`\`amountMinor\` is ${describe(issue.input)}, which is not a whole number of minor units.`
});

const MINOR_UNITS_FIX =
	'Send the gift in minor units as an integer — $100.00 is `10000`, never `100` and never `100.00`.';

/**
 * the smallest and largest gift this form takes, as bounds on a number already known to be whole.
 *
 * built per call rather than declared once, because both numbers are columns on the form record and
 * a schema over them is only meaningful against the config this request read. the amount is echoed
 * into the message where a string never is: it is the donor's own figure, it is bounded by
 * `MINOR_UNITS` above, and an integrator comparing it against the range needs to see it.
 */
function withinFormBounds(config: FormConfig) {
	const outside = (input: unknown) =>
		`\`amountMinor\` is ${String(input)}, outside this form's range of ${config.minAmountMinor} to ` +
		`${config.maxAmountMinor} minor units.`;
	return z
		.number()
		.min(config.minAmountMinor, { error: (issue) => outside(issue.input) })
		.max(config.maxAmountMinor, { error: (issue) => outside(issue.input) });
}

const RANGE_FIX =
	'Send an amount within the range this form serves, or change the smallest and largest gift ' +
	'under Forms in /admin.';

/**
 * how often a gift may repeat, which is the contract's vocabulary and not the form's.
 *
 * read off `FREQUENCIES` in packages/form/src/v1.ts rather than off the config this request was
 * handed, and the two do not have to agree: `readPublishedConfig` in ../forms/published-config.ts
 * fills `frequencies` from `offeredCadences` in ../forms/offered-cadences.ts, which narrows the
 * vocabulary to the cadences this deployment's processor account can collect, so a served config
 * offers a subset of what this accepts.
 *
 * the wider list is the rule CLAUDE.md states for the recurring capability, and the rail below
 * holds it for the same reason. the served config is cached and reaches pages this deployment
 * cannot recall, so a cadence we have stopped offering still arrives — and a submission that
 * arrives is charged rather than refused. narrowed to the served list, an account whose recurring
 * standing lapsed this morning would turn away every donor holding a page from yesterday.
 */
const OFFERED_FREQUENCY = z.enum(FREQUENCIES, {
	error: (issue) =>
		`\`frequency\` is ${describe(issue.input)}, which is not a cadence a gift may repeat at.`
});

/**
 * the rails a gift may arrive on, which is a fact about this deployment and not about the form.
 *
 * read off `OFFERED_PAYMENT_METHODS` in ../../forms/offered-rails.ts rather than off the config this
 * request was handed, and the two do not have to agree: `readPublishedConfig` in
 * ../forms/published-config.ts narrows that constant to the rails this deployment's processor
 * account is approved for, so a served config offers a subset of what this accepts.
 *
 * the wider list is deliberate and is the rule CLAUDE.md states for the recurring capability, held
 * here for the same reason. the served config is cached and reaches pages this deployment cannot
 * recall, so a rail we have stopped offering still arrives — and a submission that arrives is
 * charged rather than refused. narrowed to the served list, an account whose bank-debit standing
 * lapsed this morning would turn away every donor holding a page from yesterday.
 */
const OFFERED_METHOD = z.enum(OFFERED_PAYMENT_METHODS, {
	error: (issue) =>
		`\`method\` is ${describe(issue.input)}, which is not a rail this deployment offers.`
});

/** whether the donor is paying the processing fee. a real boolean, never a string spelling one. */
const COVERS_FEE = z.boolean({
	error: (issue) => `\`coversFee\` is ${describe(issue.input)}, which is not a boolean.`
});

/**
 * the donor's consent answer, or `null` for an integrator who never asked.
 *
 * nullable and still required: `.nullable()` admits `null` and refuses `undefined`, which is the
 * distinction this field is for. an absent one is a form that forgot the question rather than one
 * that chose not to ask it, and the two are told apart here or nowhere — the column takes `null`
 * from both.
 */
const CONSENTED_TO_CONTACT = z
	.boolean({
		error: (issue) =>
			`\`consentedToContact\` is ${describe(issue.input)}, which is not \`true\`, \`false\` or \`null\`.`
	})
	.nullable();

/** the donor's message, where they wrote one. absence and blankness are settled below. */
const NOTE = z
	.string({ error: (issue) => `\`note\` is ${describe(issue.input)}, which is not a string.` })
	.optional();

const NOTE_LENGTH = z.string().max(MAX_NOTE, {
	error: (issue) =>
		`\`note\` is ${String(issue.input).length} characters, over the ${MAX_NOTE}-character maximum.`
});

/**
 * which of the two a tribute is.
 *
 * this schema and the three checks under `parseTribute` are what holds a stored
 * `donation.tribute_kind` to the vocabulary on the path a donor submits. the column carries no
 * CHECK and cannot be given one without rebuilding a table that has children — the same argument
 * `note` is under, stated at both columns in ../db/schema.ts. the other path is a collection under
 * a commitment, which arrives from the rail and is narrowed by `tributeOf` in ./collect.ts.
 */
const TRIBUTE_KIND = z.enum(TRIBUTE_KINDS, {
	error: (issue) =>
		`\`tributeKind\` is ${describe(issue.input)}, which is not a kind of tribute a gift may carry.`
});

const TRIBUTE_KIND_FIX = `Send one of ${quoted(TRIBUTE_KINDS)} together with \`tributeHonoree\`, or leave every tribute field out.`;

/**
 * one submitted tribute string, bounded and trimmed, where `''` is a box the donor left alone.
 *
 * the cap is measured on what arrived rather than on the trimmed value, for the reason the note's
 * is: it exists to stop a stranger making the field arbitrarily large on an unauthenticated path,
 * and whitespace costs the same bytes. the trim is `.trim()` and so unicode-aware, which a check on
 * the column could not be — and the column has none anyway.
 */
function tributeText(
	value: unknown,
	field: string,
	max: number
): { readonly ok: true; readonly value: string } | Refusal {
	const shape = z
		.string({
			error: (issue) => `\`${field}\` is ${describe(issue.input)}, which is not a string.`
		})
		.optional()
		.safeParse(value);
	if (!shape.success) {
		return refusal(
			first(shape.error),
			`Send \`${field}\` as a string, or leave the field out entirely.`
		);
	}
	const bounded = z
		.string()
		.max(max, {
			error: (issue) =>
				`\`${field}\` is ${String(issue.input).length} characters, over the ${max}-character maximum.`
		})
		.safeParse(shape.data ?? '');
	if (!bounded.success) return refusal(first(bounded.error), `Send at most ${max} characters.`);

	return { ok: true, value: bounded.data.trim() };
}

/**
 * the four submitted tribute fields as one value, or the first thing wrong with them.
 *
 * every rule here is one the database does not hold. the four columns are nullable, independent and
 * unconstrained, so a kind naming nobody, a person to tell about nobody, and a `tribute_kind`
 * spelled some third way are all rows `donation` accepts — see the columns in ../db/schema.ts for
 * why none of it can be a CHECK.
 *
 * the three text fields are checked before the kind is looked at, so a body that got a field's type
 * or length wrong is told which field rather than told to send a `tributeKind` it already sent.
 */
function parseTribute(
	posted: Record<string, unknown>
): { ok: true; value: Tribute | null } | Refusal {
	const honoree = tributeText(posted.tributeHonoree, 'tributeHonoree', MAX_NAME);
	if (!honoree.ok) return honoree;
	const notifyName = tributeText(posted.tributeNotifyName, 'tributeNotifyName', MAX_NAME);
	if (!notifyName.ok) return notifyName;
	const notifyEmail = tributeText(posted.tributeNotifyEmail, 'tributeNotifyEmail', MAX_EMAIL);
	if (!notifyEmail.ok) return notifyEmail;

	if (posted.tributeKind === undefined) {
		// a name with no kind is a gift no screen can put a sentence to, and a person to tell about
		// nobody is a stranger we would be mailing for no stated reason. neither is refused by
		// anything downstream, so both are refused here.
		const orphan = [honoree, notifyName, notifyEmail].some((field) => field.value !== '');
		if (orphan) {
			return refusal(
				'A tribute field was sent without `tributeKind`.',
				`${TRIBUTE_KIND_FIX} A gift given in honor or in memory of someone states which of the two it is.`
			);
		}
		return { ok: true, value: null };
	}

	const kind = TRIBUTE_KIND.safeParse(posted.tributeKind);
	if (!kind.success) return refusal(first(kind.error), TRIBUTE_KIND_FIX);

	if (honoree.value === '') {
		return refusal(
			'`tributeHonoree` is empty, and a tribute is given in honor or in memory of a named person.',
			'Send the name of the person this gift honors or remembers.'
		);
	}

	if (notifyName.value === '' && notifyEmail.value === '') {
		return { ok: true, value: { kind: kind.data, honoree: honoree.value, notify: null } };
	}
	if (notifyName.value === '' || notifyEmail.value === '') {
		return refusal(
			`\`${notifyName.value === '' ? 'tributeNotifyName' : 'tributeNotifyEmail'}\` is empty, and the person to tell needs both a name and an address.`,
			'Send `tributeNotifyName` and `tributeNotifyEmail` together, or leave both out when the ' +
				'donor asked for nobody to be told.'
		);
	}
	if (!EMAIL.test(notifyEmail.value)) {
		// the notification goes to somebody who never gave us their address, on the domain every
		// receipt also leaves from — so a value that is plainly not an address is refused here rather
		// than becoming a bounce scored against that domain.
		return refusal(
			'`tributeNotifyEmail` does not look like an email address.',
			'Send the address the notification is written to, or leave it and `tributeNotifyName` out.'
		);
	}

	return {
		ok: true,
		value: {
			kind: kind.data,
			honoree: honoree.value,
			notify: { name: notifyName.value, email: notifyEmail.value }
		}
	};
}

/** the cause a donor picked, where the form asked. whether it is one of the form's is settled below. */
const PROGRAM_ID = z
	.string({
		error: (issue) => `\`programId\` is ${describe(issue.input)}, which is not a string.`
	})
	.optional();

const PROGRAM_ID_FIX =
	'Send one of the `id` values in `program.options` from `GET` on this form’s config route, or ' +
	'leave the field out where the donor chose no cause.';

const PROGRAM_PINNED_FIX =
	'Leave `programId` out. A form pinned to one cause credits the gift from its own record, so ' +
	'there is nothing here for a donor to choose — `GET` on this form’s config route carries the ' +
	'pin under `program.mode`.';

/**
 * the other half, and it is a different instruction rather than the same one worded twice.
 *
 * an absent `program` is two states the wire does not tell apart: a form that never asked about a
 * cause, and a form that offered a choice until the last cause on it was archived — an empty
 * `options` is served as no `program` at all (`packages/form/src/v1.ts`). the second is what puts a
 * body here: the page was drawn while the choice still stood, so the caller is holding a config
 * this deployment no longer serves and re-reading it is the whole of the fix. a sentence claiming a
 * pin would send them looking for one the form does not have.
 */
const PROGRAM_NONE_FIX =
	'Leave `programId` out. This form offers no cause: it asks about none, or every cause it ' +
	'offered has been archived since the page was drawn. `GET` on this form’s config route carries ' +
	'no `program` at all, and re-reading it is what brings the page back in step.';

/**
 * the submitted cause, checked against the list this form was actually served with.
 *
 * the same rule the amount is under and for the same reason: `/api/v1` is public and
 * payment-initiating (CLAUDE.md), so which causes a form offers is the server's answer and an id
 * from a browser is an input to look up against it. unchecked, a donor could credit their gift to
 * any cause on the deployment — including one no form offers and one the organisation retired.
 *
 * and unlike the cadence and the rail above, the served list is the *narrower* one and is the one
 * that governs. those two are vocabularies this deployment publishes a subset of, so a stale page
 * is charged rather than refused; this is a set of the org's own causes, where a cached page
 * offering a retired one is a gift credited somewhere an operator has already said it may not go.
 * a refusal is the right answer there: the donor is asked again with the list as it stands.
 *
 * an absent field is accepted everywhere, because absence is what "no cause" means on every one of
 * the three shapes — `NO_PROGRAM_LABEL` in packages/form/src/v1.ts is the words for it, and nothing
 * is ever parsed back out of them.
 */
function parseProgramId(
	value: string | undefined,
	config: FormConfig
): { readonly ok: true; readonly value: string | undefined } | Refusal {
	if (value === undefined) return { ok: true, value: undefined };

	const program = config.program;
	if (program === undefined) {
		return refusal('`programId` was sent to a form that offers no cause.', PROGRAM_NONE_FIX);
	}
	if (program.mode !== 'choice') {
		return refusal('`programId` was sent to a form pinned to one cause.', PROGRAM_PINNED_FIX);
	}
	if (!program.options.some((option) => option.id === value)) {
		return refusal(
			`\`programId\` is ${describe(value)}, which is not a cause this form offers.`,
			PROGRAM_ID_FIX
		);
	}
	return { ok: true, value };
}

/**
 * the challenge token, carried and never touched.
 *
 * no trim: a token altered on the way through is a token Cloudflare will not recognise, and
 * whether it is one at all is the challenge module's answer rather than this one's.
 */
const TURNSTILE_TOKEN = z
	.string({
		error: (issue) => `\`turnstileToken\` is ${describe(issue.input)}, which is not a string.`
	})
	.optional();

/**
 * a submitted body as a quotable request, or a sentence naming what to change.
 *
 * one problem at a time rather than all of them, which is the opposite call from `parseContact` and
 * `parseFormInput` and for a reason those two do not have: the reader here is an integrating agent
 * or the element's own flow, not a person looking at six inputs with six messages under them. a
 * body reaching this endpoint was assembled by code, so the first thing wrong with it is the thing
 * to fix, and reporting five more costs a sentence nobody is going to act on.
 *
 * every message names the field as the wire spells it — `amountMinor`, not `total_minor` — because
 * that is what whoever is reading has in front of them. CLAUDE.md: a 4xx names the offending value
 * and where to fix it.
 */
export function parseQuoteRequest(body: unknown, config: FormConfig): QuoteInputResult {
	const shape = BODY.safeParse(body);
	if (!shape.success) {
		return refusal(
			'The request body is not a JSON object.',
			'POST a JSON object with `amountMinor`, `frequency`, `method`, `coversFee`, `email`, ' +
				'`firstName`, `lastName` and `consentedToContact`, under `content-type: application/json`.'
		);
	}
	const posted: Record<string, unknown> = shape.data;

	const whole = MINOR_UNITS.safeParse(posted.amountMinor);
	if (!whole.success) return refusal(first(whole.error), MINOR_UNITS_FIX);
	const within = withinFormBounds(config).safeParse(whole.data);
	if (!within.success) return refusal(first(within.error), RANGE_FIX);
	const amount = within.data;

	const frequency = OFFERED_FREQUENCY.safeParse(posted.frequency);
	if (!frequency.success) {
		return refusal(
			first(frequency.error),
			`Send one of ${quoted(FREQUENCIES)}. \`GET\` on this form's config route reports which of ` +
				'them this deployment is currently offering, and a cadence it has stopped offering is ' +
				'still charged rather than refused.'
		);
	}

	const method = OFFERED_METHOD.safeParse(posted.method);
	if (!method.success) {
		return refusal(
			first(method.error),
			`Send one of ${quoted(OFFERED_PAYMENT_METHODS)}, which is what \`GET\` on this form's config route reports.`
		);
	}

	const coversFee = COVERS_FEE.safeParse(posted.coversFee);
	if (!coversFee.success) {
		return refusal(
			first(coversFee.error),
			'Send `true` when the donor is paying the processing fee on top of their gift, `false` when ' +
				'the organisation absorbs it.'
		);
	}

	const consentedToContact = CONSENTED_TO_CONTACT.safeParse(posted.consentedToContact);
	if (!consentedToContact.success) {
		return refusal(
			first(consentedToContact.error),
			'Send the donor’s own answer: `true` where they asked to be written to, `false` where they ' +
				'were asked and declined, and `null` where you never asked. Pre-ticked consent is not ' +
				'consent under GDPR, and `false` is a donor who said no rather than one nobody asked.'
		);
	}

	const note = NOTE.safeParse(posted.note);
	if (!note.success) {
		return refusal(
			first(note.error),
			'Send the donor’s message as a string, or leave the field out entirely.'
		);
	}
	// the cap is measured on what arrived rather than on the trimmed message: it exists to stop a
	// stranger making the field arbitrarily large, and whitespace costs the same bytes. an absent
	// note is a note of no characters, which is why this runs over every case rather than only the
	// one that sent a string.
	const bounded = NOTE_LENGTH.safeParse(note.data ?? '');
	if (!bounded.success) {
		return refusal(first(bounded.error), `Send at most ${MAX_NOTE} characters.`);
	}
	// a message of nothing but whitespace is no message. `.trim()` is unicode-aware where a sqlite
	// check could not be, which is the reason this holds here rather than on the column.
	const message = note.data?.trim() ?? '';

	const tribute = parseTribute(posted);
	if (!tribute.ok) return tribute;

	const submittedProgram = PROGRAM_ID.safeParse(posted.programId);
	if (!submittedProgram.success) return refusal(first(submittedProgram.error), PROGRAM_ID_FIX);
	const program = parseProgramId(submittedProgram.data, config);
	if (!program.ok) return program;

	const turnstileToken = TURNSTILE_TOKEN.safeParse(posted.turnstileToken);
	if (!turnstileToken.success) {
		return refusal(
			first(turnstileToken.error),
			'Send the token the Turnstile widget produced, unmodified.'
		);
	}

	// the donor goes through the same parser /admin's create form uses, so `display_name` is derived
	// by the one function that derives it and the branded `ParsedContact` a write needs cannot be
	// assembled any other way. `kind` is not on the wire and is not a donor's decision: a donation
	// form asks for a first name, a last name and an address, which is an individual.
	const donorValues: ContactFormValues = { kind: 'individual' };
	// assigned only where a string arrived, because `exactOptionalPropertyTypes` makes an explicit
	// `undefined` a different thing from an absent key — and the parser's own "missing" branch is
	// the one that should answer for a field nobody sent.
	if (typeof posted.firstName === 'string') donorValues.first_name = posted.firstName;
	if (typeof posted.lastName === 'string') donorValues.last_name = posted.lastName;
	if (typeof posted.email === 'string') donorValues.primary_email = posted.email;
	const parsedDonor = parseContact(donorValues);
	if (!parsedDonor.ok) {
		// the parser's keys are column names and its messages are written for a fundraiser reading a
		// form in /admin. what an agent needs is the wire field, so the key is mapped back to the
		// name it was posted under and the parser's own sentence is carried as the reason.
		const [field = 'first_name', reason = ''] = firstReported(parsedDonor.errors);
		return refusal(
			`\`${WIRE_FIELD[field] ?? field}\` was not accepted: ${reason}`,
			'Send the donor’s own first name, last name and email address. Either name alone is enough; ' +
				'the address is what a receipt goes to.'
		);
	}
	if (parsedDonor.value.primaryEmail === null) {
		// `parseContact` treats an address as optional, because a staff member entering a cheque may
		// not have one. a gift taken through a form is not that case: the address is the only way the
		// receipt reaches the donor, and it is what the returning-donor lookup matches on.
		return refusal(
			'`email` is empty, and a gift taken through a donation form needs one.',
			'Send the donor’s email address. It is what the receipt is sent to and what a repeat gift ' +
				'is matched against.'
		);
	}

	return {
		ok: true,
		value: {
			amountMinor: amount,
			frequency: frequency.data,
			method: method.data,
			coversFee: coversFee.data,
			donor: parsedDonor.value,
			consentedToContact: consentedToContact.data,
			note: message === '' ? undefined : message,
			tribute: tribute.value,
			programId: program.value,
			turnstileToken: turnstileToken.data
		}
	};
}

/**
 * the wire's name for a field `parseContact` reports under a column name.
 *
 * the two vocabularies are deliberately different — the contact parser's keys are the `contact`
 * table's columns, and `QuoteRequest` in packages/form/src/v1.ts is camelCase and permanent — so the map is
 * the seam between them rather than a translation anyone should do at a call site.
 *
 * its key order is also the order `firstReported` picks in — see there.
 */
const WIRE_FIELD: Record<string, string> = {
	first_name: 'firstName',
	last_name: 'lastName',
	primary_email: 'email',
	display_name: 'firstName'
};

/**
 * the one field out of a rejected contact this refusal speaks about, and its sentence.
 *
 * `parseContact` reports every offending field at once and this endpoint reports one, so one of
 * them has to be chosen. the order is `WIRE_FIELD`'s own — the order the fields appear on the wire
 * — rather than the order the parser happened to fill its map in, which is issue order and would
 * make the answer depend on which check inside another module ran first. anything the parser
 * reports that has no wire name falls through to whatever it listed first, so a field added there
 * is still spoken about rather than silently swallowed.
 */
function firstReported(
	errors: Readonly<Record<string, string | undefined>>
): [string, string] | [] {
	for (const field of Object.keys(WIRE_FIELD)) {
		const reason = errors[field];
		if (reason !== undefined) return [field, reason];
	}
	for (const [field, reason] of Object.entries(errors)) {
		if (reason !== undefined) return [field, reason];
	}
	return [];
}

/** the sentence a rejected parse leads with — each schema above declares its own, per check. */
function first(error: z.ZodError): string {
	return error.issues[0]?.message ?? '';
}

/**
 * a rejected value as a message may name it: its type, or the value itself when it is a number or
 * a boolean.
 *
 * a string is never echoed. every one of these fields is a stranger's, on an unauthenticated path,
 * and the length check that would bound it is the one that just failed — so the sentence says what
 * kind of thing arrived and the caller, who sent it, already knows what was in it.
 */
function describe(value: unknown): string {
	if (value === undefined) return 'missing';
	if (value === null) return 'null';
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return 'an array';
	return `a ${typeof value}`;
}

/** a vocabulary as a message names it: every member, quoted, joined with `or`. */
function quoted(values: readonly string[]): string {
	return values.map((value) => `\`${value}\``).join(' or ');
}

function refusal(message: string, fix: string): Refusal {
	return { ok: false, message, fix };
}
