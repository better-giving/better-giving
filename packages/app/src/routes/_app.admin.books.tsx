import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Field } from '@better-giving/operator/components/forms/Field';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { Column, Section, Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { getFormProps } from '@conform-to/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Form, useNavigation } from 'react-router';
import { uuidv7 } from 'uuidv7';
import { screenTitle } from '$lib/admin/screen-title';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { formatMinor } from '$lib/donations/money';
import { FORM_CURRENCY, readAmount } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import {
	CORRECTION_FIELD_LABELS,
	CORRECTION_INPUT,
	readAccountingDate
} from '$lib/ledger/input-schema';
import { ENTRY_SOURCE_LABELS } from '$lib/ledger/sources';
import { invalid, parseForm } from '$lib/server/conform';
import { pickableAccounts, postableIdFromSubmitted } from '$lib/server/db/accounts';
import { postCorrection } from '$lib/server/ledger/correct';
import {
	ENTRY_GROUP_LIST_LIMIT,
	type EntryGroupListRow,
	type EntryGroupPage,
	findEntryGroup,
	listEntryGroups
} from '$lib/server/ledger/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.books';

// the books: the journal entries a deployment has posted, and the one way a human posts one.
//
// until this screen there was no way to write a correcting entry at all — every caller of
// `post()` in `$lib/server/ledger/posting.ts` was on the settlement path. that matters because
// CLAUDE.md settles every cross-row invariant in this system with a compensating entry rather than
// a rollback: a refund past what was received, a fee Stripe published too late to post, a lost race
// between two writes. this is where those are answered.
//
// **the form states one amount, an account it comes out of and an account it goes into**, which is
// what makes the entry balanced by construction: the same figure is used on both sides, so there is
// no arithmetic here for anyone to get wrong and no arm on which `post()`'s sums-to-zero rejection
// is reachable. a correction that needs three lines is a decision to widen this screen out loud.
//
// the list is under the form rather than on a screen of its own, and it is every entry rather than
// the corrections: a correction is aimed at what the settlement path already posted, so the entry
// it answers has to be readable beside the boxes that answer it.
//
// **the way out of these books is not here.** the accountant's file is asked for on
// ./_app.admin.donations.export.tsx, under Gifts, because that is where the operator asking for it
// comes from — what it holds is every entry the range covers, the corrections posted here included.
//
// **the press reports at the button, and the screen never navigates away.** the action answers with
// what it did rather than with a redirect, so the boxes keep what was posted and the id it was
// posted under stays on the page: a second press of the same correction reaches
// `entry_group_source_idx` under the same pair and is told it is already in the books. boxes that
// hold anything else are a different correction and take a fresh id (`postingId` below).
//
// this file is deliberately thin. what a box may hold is `$lib/ledger/input-schema.ts`, what a
// correction *is* — the source type, the currency, the sign convention and the one `batch()` — is
// `$lib/server/ledger/correct.ts`, and what the entries are is `$lib/server/ledger/queries.ts`; the
// only job here is turning a request into one and a failure into the other. that split is the one
// every other write route on this dashboard is under (`createContact`, `createForm`), and it is
// what keeps a second poster — a backfill, a repair run from the console — from copying the sign
// convention out of a screen.

/**
 * the correction form, stated once for the action that reads a body against it and the screen that
 * submits to it.
 *
 * the id is a literal and never derived — see `$lib/server/conform.ts`'s header. this screen
 * carries one form and states it anyway, because the rule is what makes the statement readable
 * rather than the count.
 */
const CORRECTION_FORM = defineForm({ id: 'correction', schema: CORRECTION_INPUT });

/** the address this screen answers on, and the one its form posts to. */
const SCREEN = '/admin/books';

/**
 * what a write that failed says, keyed to no box.
 *
 * it does not claim nothing was recorded, because it cannot know: a `batch()` that commits and then
 * loses the connection is indistinguishable from one that never ran, and a sentence promising an
 * empty ledger would send the operator to post the correction a second time. what makes pressing
 * again safe is the id the page is holding — the same pair reaches
 * `entry_group_source_idx`, which is what refuses the second write rather than duplicating it.
 */
const WRITE_FAILED =
	'Posting this correction failed. Press again — this page posts under one id, so a correction cannot be recorded twice.';

/**
 * what a press is told when the id it carried already stands for a different correction.
 *
 * nothing this press asked for was written, and the id that comes back with it is a fresh one, so
 * pressing again posts the boxes as they are.
 */
const ID_HELD =
	'This press matched an earlier correction that moved different figures, so it was not posted. Press again to post it.';

/**
 * what an account id the seeded chart does not answer to is told, and it is one sentence for both
 * ways in.
 *
 * `postableIdFromSubmitted` answers `null` for "no such account" and for "that account is a rollup"
 * alike, and neither is something an operator can act on differently: both mean the choice on the
 * screen is stale, and reloading is the whole of the fix. the only ways here are a tab left open
 * across a release that changed the chart and a hand-built body.
 */
const NO_SUCH_ACCOUNT =
	'That account is not one this deployment can post to. Reload the page and choose again.';

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'Books';

/** the blank a picker opens on, so no account is chosen by the picker falling to the first one. */
const CHOOSE_ACCOUNT = { value: '', label: 'Choose an account' };

/** the heading over the entry list, which is what names the plane under it. */
const ENTRIES_ID = 'books-entries';

/**
 * what each column of the entry list is worth, in the order an operator reads a row.
 *
 * the first is the row's own header and what the plane pins to the leading edge: an entry carries
 * no name and no visible id, so the day it is dated is what identifies it in a list ordered by that
 * same day. `DataTable` decides that from position — the first column is the `th` — so the order
 * here is the arrangement and not only the sequence.
 *
 * a `width` is the column's share of the table and the four sum to the whole of it, stated here
 * because a share is a fact about these four columns and nothing a design system could hold
 * (packages/operator/src/styles/tokens.css's header names a table column's percentage among the few
 * things a screen still writes). the movement takes the largest share because it is the only column
 * holding more than one fact, and the date takes the smallest because it holds one value of a fixed
 * width.
 *
 * `Movement` and `Note` are two columns and not one line: the movement is what the ledger says and
 * the note is what a person wrote about it, and folding them together would make the entry's own
 * figures read as prose somebody typed.
 */
const COLUMNS = [
	{ key: 'dated', label: 'Dated', kind: 'date', width: '13%' },
	{ key: 'why', label: 'Why', width: '17%' },
	{ key: 'movement', label: 'Movement', kind: 'whole', width: '40%' },
	{ key: 'note', label: 'Note', kind: 'whole', width: '30%' }
] as const;

/**
 * what an account is called on this screen: in the picker that chose it, in the dialog that states
 * the press, and on every line it names.
 *
 * one spelling for all three, so an account reads identically in the box that chose it and in the
 * entry it produced. the code leads because it is what an accountant reconciles by.
 */
function accountLabel(account: { readonly code: string; readonly name: string }): string {
	return `${account.code} — ${account.name}`;
}

/** every account a line may name, keyed by id, each with its one label. built from the chart handed in. */
function labelsOf(
	accounts: readonly { readonly id: string; readonly code: string; readonly name: string }[]
): ReadonlyMap<string, string> {
	return new Map(accounts.map((a) => [a.id, accountLabel(a)]));
}

/**
 * the boxes a press submits besides the id, which is what decides whether two presses are one
 * correction. `postingId` in the component reads it.
 */
const CORRECTION_BOXES = ['occurred_on', 'amount', 'out_of', 'into', 'note'] as const;
type CorrectionBoxes = Record<(typeof CORRECTION_BOXES)[number], string>;

/** what the boxes of `form` hold, as the text a submit would carry. */
function boxesOf(form: HTMLFormElement): CorrectionBoxes {
	const values = new FormData(form);
	const text = (name: string) => String(values.get(name) ?? '');
	return {
		occurred_on: text('occurred_on'),
		amount: text('amount'),
		out_of: text('out_of'),
		into: text('into'),
		note: text('note')
	};
}

function sameBoxes(a: CorrectionBoxes, b: CorrectionBoxes): boolean {
	return CORRECTION_BOXES.every((name) => a[name] === b[name]);
}

/**
 * the operator's own calendar day, as the browser's clock and zone read it.
 *
 * the box opens on it because it is the day the operator is living in; what is stored is still the
 * UTC midnight of whatever day the box holds (`readAccountingDate` in `$lib/ledger/input-schema.ts`).
 */
function localDay(at: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * whether the entry the books hold under an id is the correction a press submitted.
 *
 * what the refused duplicate is checked against before it is answered as already posted: the day,
 * the note, and the one figure out of one account and into the other.
 */
function isSubmitted(
	found: EntryGroupListRow,
	submitted: {
		readonly occurredAt: Date;
		readonly amountMinor: number;
		readonly outOf: string;
		readonly into: string;
		readonly note: string;
	}
): boolean {
	const moves = (accountId: string, amountMinor: number) =>
		found.lines.some((l) => l.accountId === accountId && l.amountMinor === amountMinor);
	return (
		found.occurredAt.getTime() === submitted.occurredAt.getTime() &&
		found.memo === submitted.note &&
		found.lines.length === 2 &&
		moves(submitted.into, submitted.amountMinor) &&
		moves(submitted.outOf, -submitted.amountMinor)
	);
}

/**
 * one line of an entry, as a reader sees it: the account, and the figure with the side it is on.
 *
 * the sign is written rather than left to the formatter. `formatMinor` renders a credit as
 * `-$4.75` and a debit as `$4.75`, so a column of them shows a mark on half the lines and nothing
 * on the other half — which reads as an amount being negative rather than as the two sides of one
 * entry. `+` is a debit and `−` is a credit, project-wide (`$lib/server/ledger/posting.ts`).
 */
function line(label: string, amountMinor: number, currency: string): string {
	const side = amountMinor < 0 ? '−' : '+';
	return `${label} ${side}${formatMinor(Math.abs(amountMinor), currency)}`;
}

/**
 * every line of an entry, in posting order, each account named.
 *
 * every account a line can name is in `labels`: `ledger_entry.account_id` carries a composite
 * `(id, is_postable)` foreign key and the map is every postable account. the fallback is therefore
 * unreachable and is the id rather than a word — a name invented for an account that is not there
 * would be the one thing on this screen nobody could check.
 */
function movementOf(group: EntryGroupListRow, labels: ReadonlyMap<string, string>): string[] {
	return group.lines.map((l) =>
		line(labels.get(l.accountId) ?? l.accountId, l.amountMinor, group.currency)
	);
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.get(database);

	// derived from the seeded chart with no read, so the pickers stand whether or not the list
	// below them could be read.
	const labels = labelsOf(pickableAccounts());

	// a list that could not be read is `null` rather than a failed screen: the form above it names
	// no row of it and posts without it, and an operator whose books will not list is the one most
	// likely to need to post a correction. `null` and never `[]`, which the table would draw as
	// books nothing has been posted to.
	let page: EntryGroupPage | null = null;
	try {
		page = await listEntryGroups(db);
	} catch (e) {
		// the diagnostic lives on the loader for the reason /admin/donors's does: this is where an
		// unapplied migration actually surfaces.
		console.error('reading the books failed:', e);
	}

	return {
		accounts: [...labels].map(([value, label]) => ({ value, label })),
		// the id the next correction is posted under, minted here rather than in the action — see
		// `source_id` in `$lib/ledger/input-schema.ts` for what it buys and `postingId` in the
		// component for when the screen holds an earlier one instead.
		sourceId: uuidv7(),
		entries:
			page === null
				? null
				: page.groups.map((g) => ({
						id: g.id,
						// the date only, ISO, formatted here rather than in the page: an
						// `Intl.DateTimeFormat` in a component would run once on the Worker during ssr and
						// again in the browser, in two different locales and time zones.
						datedOn: g.occurredAt.toISOString().slice(0, 10),
						// the value, not the word. `ENTRY_SOURCE_LABELS` in `$lib/ledger/sources.ts` is
						// what the page renders it with, and a sixth source is a type error there.
						source: g.sourceType,
						// formatted here for the reason the date is.
						movement: movementOf(g, labels),
						memo: g.memo
					})),
		// so the page can say the list is capped rather than silently showing a prefix.
		limit: ENTRY_GROUP_LIST_LIMIT,
		// exact, and not computed here: `listEntryGroups` fetches one row past the cap and reports
		// whether it came back, then returns at most the cap.
		hasMore: page?.hasMore ?? false
	};
}

/**
 * post one correcting entry.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` is
 * what reads what it returns, and nothing above this route may.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();

	// every box this form states has to arrive, and the two sharp ones are the pickers: absent, a
	// `<select>`'s value would be whatever the schema stood in, and a correction would move money
	// between two accounts nobody chose. `$lib/server/conform.ts`'s header is where that is argued.
	const submission = parseForm(body, CORRECTION_FORM);
	if (!submission.ok) return invalid(400, submission.reject());

	// the door an account id off the wire goes through, and there is no other — `$lib/server/db/postable.ts`
	// enumerates the ways to the brand. it is what stops a rollup reaching `post()`, which would make
	// every report over that subtree double-count silently and permanently, because the ledger is
	// append-only.
	const outOf = postableIdFromSubmitted(submission.value.out_of);
	const into = postableIdFromSubmitted(submission.value.into);
	if (outOf === null || into === null) {
		// both boxes at once where both are stale, so a reload is one round trip rather than two.
		return invalid(
			400,
			submission.reject({
				fieldErrors: {
					...(outOf === null ? { out_of: [NO_SUCH_ACCOUNT] } : {}),
					...(into === null ? { into: [NO_SUCH_ACCOUNT] } : {})
				}
			})
		);
	}

	// the figure and the day come out of the same two calls the schema's checks already made, read
	// for the value this time instead of for the sentence — the arrangement `parseFormGiving` in
	// `$lib/server/forms/form-input.ts` is under, and the reason neither rule is spelled twice.
	const money = readAmount(submission.value.amount, FORM_CURRENCY);
	const dated = readAccountingDate(submission.value.occurred_on);
	if (money.minor === null || dated.at === null) {
		// unreachable past the schema, whose checks abort on exactly these two reads. it is the
		// narrowing rather than a second rule, and it answers with the sentences those checks
		// produced — so a path added above this line that *can* reach it cannot answer with a form
		// marked refused and nothing written under any box.
		return invalid(
			400,
			submission.reject({
				fieldErrors: {
					...(money.problem === null ? {} : { amount: [money.problem] }),
					...(dated.problem === null ? {} : { occurred_on: [dated.problem] })
				}
			})
		);
	}

	// the handle is taken here rather than at the top of the action: nothing above this line needs
	// a database, so a submission the rules refused is answered without one being reached for.
	const db = context.get(database);
	const sourceId = submission.value.source_id;

	let posted: Awaited<ReturnType<typeof postCorrection>>;
	try {
		posted = await postCorrection(db, {
			sourceId,
			occurredAt: dated.at,
			amountMinor: money.minor,
			outOf,
			into,
			note: submission.value.note
		});
	} catch (e) {
		// nothing here is a user error — every rule has passed and both accounts are the chart's own
		// — so this is the write itself failing. the cause goes to the log; the page gets a fixed
		// string, keyed to no box, because a write that failed is not something an operator can fix
		// by editing an input.
		console.error('posting a correction failed:', e);
		// a fresh id rides back beside it for a press whose boxes have changed by then: a `batch()`
		// that commits and then loses the connection is indistinguishable from one that never ran, so
		// the id this write was sent under may already stand for it. an unchanged press keeps that id
		// and is refusable as a duplicate.
		return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }), { freshId: uuidv7() });
	}

	if (!posted.ok) {
		// logged because it is the only signal anywhere that the guard fired: a run of these is a
		// screen re-submitting, which is a thing to read in a log.
		console.info('a correction was presented twice under one id:', sourceId);
	}

	// what the books now hold under this id, read back by its pair rather than rebuilt from the
	// body: on `already_posted` the entry is the earlier press's, and the press is told what is in
	// the books rather than what it asked for. a read that fails here costs the lines and not the
	// answer — the write has already landed or already been there, and a 500 would say it had not.
	let found: EntryGroupListRow | null = null;
	try {
		found = await findEntryGroup(db, 'adjustment', sourceId);
	} catch (e) {
		console.error('reading back a posted correction failed:', e);
	}

	// the id is the screen's to hold only while the boxes hold what it was sent under, and a press
	// that presents it over a different correction is refused rather than answered as already
	// posted — which would tell the operator a correction is in the books that nothing wrote.
	if (
		!posted.ok &&
		found !== null &&
		!isSubmitted(found, {
			occurredAt: dated.at,
			amountMinor: money.minor,
			outOf,
			into,
			note: submission.value.note
		})
	) {
		return invalid(409, submission.reject({ formErrors: [ID_HELD] }), {
			freshId: uuidv7(),
			releasedId: sourceId
		});
	}

	return {
		outcome: {
			kind: posted.ok ? ('posted' as const) : ('already_posted' as const),
			sourceId,
			movement: found === null ? null : movementOf(found, labelsOf(pickableAccounts()))
		}
	};
}

/** what the confirm dialog states, read off the boxes at the press that opened it. */
type Asked = {
	readonly amount: string;
	readonly outOf: string;
	readonly into: string;
	readonly dated: string;
};

// what this page owes is a refused attempt that comes back with what was typed still in the boxes,
// every message beside the box it is about, a press that states what it will move before it moves
// it, and the entries the correction is aimed at readable underneath.
export default function Books({ loaderData, actionData }: Route.ComponentProps) {
	const { accounts, sourceId, entries, limit, hasMore } = loaderData;

	// the operator's own day, filled in once the page is in the browser. the server renders the box
	// empty rather than with a day of its own: the Worker's clock is UTC and knows nothing of the
	// operator's zone, and a different day on the first client pass would not hydrate.
	const [today, setToday] = useState('');
	useEffect(() => setToday(localDay(new Date())), []);

	const [form, fields] = useAdminForm(CORRECTION_FORM, actionData, {
		// the day the box opens on, which is the day most corrections are dated. a seed and not a
		// rule: a form seeded from a value still reports no error until it is submitted.
		//
		// the posting id is deliberately not seeded here — see `postingId` below for why a form
		// layer is the wrong thing to hold it.
		//
		// the two pickers are seeded blank because the day filling in is a seed change, and the reset
		// it causes writes nothing-chosen into a select the seed does not name — which then submits no
		// value at all rather than its blank.
		defaultValue: { occurred_on: today, out_of: '', into: '' }
	});

	const outcome = actionData && 'outcome' in actionData ? actionData.outcome : null;
	const freshId =
		actionData && 'freshId' in actionData && typeof actionData.freshId === 'string'
			? actionData.freshId
			: null;
	const releasedId =
		actionData && 'releasedId' in actionData && typeof actionData.releasedId === 'string'
			? actionData.releasedId
			: null;

	/** what the last confirmed press submitted, and the id it was sent under. */
	const [sent, setSent] = useState<{ readonly boxes: CorrectionBoxes; readonly id: string } | null>(
		null
	);
	/** what the boxes hold now, read on every edit. */
	const [current, setCurrent] = useState<CorrectionBoxes | null>(null);
	const holding = sent !== null && current !== null && sameBoxes(sent.boxes, current);

	/**
	 * the id the next press posts under.
	 *
	 * the last press's id, while every box holds exactly what that press submitted — so a double
	 * press, a retry after a write whose outcome could not be read, and an edit undone back all
	 * present the pair the books may already hold, and are refused there as a duplicate. any other
	 * press is a different correction and takes the fresh id the page holds: the one a refusal
	 * handed back, or else the one the latest load minted. an edit made while a press is in flight
	 * counts, because it is the values that are compared and not the moment they changed.
	 *
	 * the one exception is an id the action released: it stands for a different correction, so a
	 * press over the same boxes takes the fresh id rather than meeting that refusal again.
	 *
	 * read off component state and the loader rather than the form layer, because this screen never
	 * unmounts its form and conform reads its `defaultValue` once.
	 */
	const postingId = holding && sent.id !== releasedId ? sent.id : (freshId ?? sourceId);

	const navigation = useNavigation();
	// `!== 'idle'` and not `=== 'submitting'`: the revalidating load that follows the answer is
	// `loading`, and a press held only through the first state is live again over boxes that still
	// hold the correction. `formAction` is what keeps the sign-out form's own post from holding it.
	const posting = navigation.state !== 'idle' && navigation.formAction === SCREEN;

	// what a refused attempt says about the attempt as a whole. the sentences about the boxes are
	// under the boxes and are each field's own — with one exception, and it is the hidden box: a
	// refusal keyed to `source_id` has no control to sit under, so it is read as the form's rather
	// than rendered nowhere.
	const refusal = form.errors?.[0] ?? fields.source_id.errors?.[0];

	/** the movement the open dialog is asking about, or `null` while no press is being confirmed. */
	const [asking, setAsking] = useState<Asked | null>(null);
	// set by the dialog's own press on its way to the submit it causes, which is the one submit that
	// is not asked about again.
	const confirmed = useRef(false);

	const nameOf = (id: string) => accounts.find((a) => a.value === id)?.label ?? id;
	const formProps = getFormProps(form);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		formProps.onSubmit(event);
		const answering = confirmed.current;
		confirmed.current = false;
		// refused by the rules in the browser, which have already marked the boxes.
		if (event.defaultPrevented) return;
		if (answering) {
			const boxes = boxesOf(event.currentTarget);
			setSent({ boxes, id: postingId });
			setCurrent(boxes);
			setAsking(null);
			return;
		}

		event.preventDefault();
		const values = new FormData(event.currentTarget);
		const text = (name: string) => String(values.get(name) ?? '');
		const { minor } = readAmount(text(fields.amount.name), FORM_CURRENCY);
		if (minor === null) return;
		setAsking({
			amount: formatMinor(minor, FORM_CURRENCY),
			outOf: nameOf(text(fields.out_of.name)),
			into: nameOf(text(fields.into.name)),
			dated: text(fields.occurred_on.name)
		});
	}

	const options = [CHOOSE_ACCOUNT, ...accounts];
	const count = entries?.length ?? 0;

	return (
		// the narrow measure, not the wide one: what this screen is for is the form, and the table
		// under it has four columns and its own scroll box, so it reads at this width where a form
		// stretched to a table's measure does not.
		<Column>
			{/* no `action` attribute, so this posts to the current url. conform's `getFormProps` puts
			    the form's own id on the element, which is what its focus move looks the form up by
			    — see the header of `$lib/admin/use-admin-form.ts`. `preventScrollReset` because the
			    answer lands on this same screen, at the button that was pressed. */}
			<Section>
				<h2>Corrections</h2>
				<Form
					method="post"
					preventScrollReset
					{...formProps}
					onSubmit={onSubmit}
					onInput={(event) => setCurrent(boxesOf(event.currentTarget))}
					onChange={(event) => setCurrent(boxesOf(event.currentTarget))}
				>
					<Stack>
						{/* the id this correction is posted under, which the database is asked to refuse a
						    second time. what it holds is `postingId` above, which is where the rule is.

						    written as react's `value` rather than `defaultValue` so that the element
						    follows it: an uncontrolled input keeps whatever it mounted with, and this box
						    is on a screen that never remounts its form. */}
						<input type="hidden" name={fields.source_id.name} value={postingId} />

						{/* the day and the figure pair up once there is room: both hold one short
						    value, and the accounting date is what the amount is dated. */}
						<div className="adm-pair adm-pair--side">
							<Field
								label={CORRECTION_FIELD_LABELS.occurred_on}
								type="date"
								{...boxProps(fields.occurred_on)}
							/>
							<Field
								label={CORRECTION_FIELD_LABELS.amount}
								inputMode="decimal"
								{...boxProps(fields.amount)}
							/>
						</div>

						{/* the two sides, side by side, because they are one decision read together —
						    the entry is what comes out of the first and goes into the second. */}
						<div className="adm-pair adm-pair--side">
							<SelectWithNote
								label={CORRECTION_FIELD_LABELS.out_of}
								options={options}
								{...boxProps(fields.out_of)}
							/>
							<SelectWithNote
								label={CORRECTION_FIELD_LABELS.into}
								options={options}
								{...boxProps(fields.into)}
							/>
						</div>

						{/* required, and the only box on this form that is not a number or a choice: a
						    correcting entry is the one kind no record explains, so what is written here
						    is the whole of what the books say about why it exists. */}
						<Field
							label={CORRECTION_FIELD_LABELS.note}
							as="textarea"
							rows={3}
							{...boxProps(fields.note)}
						/>

						{/* the outcome of an attempt keyed to no box, and it sits here rather than at the
						    top of the page: the reader is looking at the button they just pressed — a
						    failure keyed to no box moves focus nowhere, because conform's move goes to the
						    first box that failed and there is none. */}
						{refusal ? (
							// a write whose outcome could not be read is not called not posted: it may have
							// landed and lost its answer, which is what `WRITE_FAILED` itself says.
							<Banner
								tone="blocker"
								word={refusal === WRITE_FAILED ? 'Not confirmed' : 'Not posted'}
							>
								{refusal}
							</Banner>
						) : null}

						<div className="adm-actions">
							{/* held while its own post is in flight with `aria-disabled` rather than
							    `disabled`: the dialog hands focus back to this button as it closes, and a
							    disabled button cannot take it, which would leave the reader on the body at
							    the moment the answer arrives beside it. */}
							<Button
								variant="primary"
								type="submit"
								aria-busy={posting}
								aria-disabled={posting || undefined}
								onClick={(event) => {
									if (posting) event.preventDefault();
								}}
							>
								Post correction
							</Button>
							{/* the answer, beside the press that caused it, in a region mounted empty so the
							    words arriving are announced. it stands only while the boxes hold what that
							    press sent: an answer over boxes holding something else is telling the
							    operator their edit is in the books. */}
							<span role="status">
								{outcome && holding && sent.id === outcome.sourceId && !posting ? (
									outcome.kind === 'posted' ? (
										<StatusWord register="momentary">
											Posted.{outcome.movement === null ? null : ` ${outcome.movement.join(' · ')}`}
										</StatusWord>
									) : (
										// neither done nor refused: the books already hold this correction, from
										// the press before this one, and nothing this press did changed them.
										<StatusWord register="momentary" neutral>
											Already in the books, from the earlier press.
											{outcome.movement === null ? null : ` ${outcome.movement.join(' · ')}`}
										</StatusWord>
									)
								) : null}
							</span>
						</div>
					</Stack>

					{/* the press, asked about in the top layer before it posts: a correction cannot be
					    undone, because the books are append-only, and this is the one place that is said.
					    inside the form, so the confirm is the form's own submit — `Dialog` states why the
					    form goes around the card rather than inside its actions row. */}
					{asking ? (
						<Modal
							title="Post this correction?"
							cancel="Cancel"
							cancelProps={{ type: 'button', onClick: () => setAsking(null) }}
							exit="Yes, post this correction"
							exitProps={{
								type: 'submit',
								onClick: () => {
									confirmed.current = true;
								}
							}}
							onDismiss={() => setAsking(null)}
						>
							<Stack tight>
								<p className="adm-prose">
									{asking.amount} out of {asking.outOf}, into {asking.into}.
								</p>
								<p className="adm-prose">Dated {asking.dated}.</p>
								<p className="adm-prose">
									The books are append-only, so this cannot be undone. A mistake is answered by
									posting another correction.
								</p>
							</Stack>
						</Modal>
					) : null}
				</Form>
			</Section>

			{/* the list's own heading, beside the form's: the frame draws this page's one `h1`,
			    visually hidden (./_app.tsx), so both halves of the screen stand under it at this rank.
			    without it the table falls under the heading about the form above it, and a reader
			    moving by heading reaches the form half and never the list.

			    it stands in the column directly, like the table under it and for the same reason —
			    a wrapper holding the two would be the plain element between the column and the plane
			    the comment below refuses. the stack's gap is under it either way, and the section
			    above adds its own padding on top of that, so the heading already sits closer to what
			    it names than to what it follows. and it is outside the two arms below because the
			    list is named whether or not it could be read. */}
			<h2 id={ENTRIES_ID}>Entries</h2>

			{entries === null ? (
				// attention and not blocker: the form above still posts, and what is missing is the
				// list — a list that could not be read is never drawn as one with nothing in it.
				<Banner tone="attention" word="Entries could not be read" />
			) : (
				// the table sits in the column directly, and nothing wraps it: a plain element between
				// the column and the plane is one the column can never make narrower than the whole
				// table (./_app.admin.donations._index.tsx argues it at length).
				<DataTable
					// the heading above is the name, so the table takes it rather than saying the word
					// again: with no rows the caption is the only name a plane has, and here it would be
					// the heading's own noun read a second time.
					namedBy={ENTRIES_ID}
					// with rows, the sentence that says what the table holds. with none there is no count
					// worth stating and none is drawn.
					caption={
						count > 0 ? `${count} ${count === 1 ? 'entry' : 'entries'}, newest first.` : undefined
					}
					capNote={hasMore ? `Only the most recent ${limit} are shown.` : undefined}
					columns={COLUMNS}
					rows={entries.map((e) => ({
						// the entry's own id, which keys the row and is never rendered — no column is
						// keyed `id`. keying by position instead hands two rows that swap places each
						// other's cells.
						id: e.id,
						cells: {
							dated: <time dateTime={e.datedOn}>{e.datedOn}</time>,
							why: ENTRY_SOURCE_LABELS[e.source],
							// the lines joined rather than stacked: the cell is prose-width and every line
							// is one account and one figure, so a run of them reads across and wraps where
							// the column ends.
							movement: e.movement.join(' · '),
							// a cell with nothing in it is dashed and set in the muted ink by the table
							// itself, which is why this reaches for no fallback.
							note: e.memo
						}
					}))}
					empty="Nothing has been posted to the books yet."
				/>
			)}
		</Column>
	);
}
