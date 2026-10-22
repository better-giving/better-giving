import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { envLine, RECREATE_APP } from '@better-giving/operator/deploy-split';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Column, Section, Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import {
	type ChangeEvent,
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';
import {
	Form,
	redirectDocument,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useNavigation
} from 'react-router';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { calendarDay } from '$lib/admin/calendar-day';
import { screenTitle } from '$lib/admin/screen-title';
import { buttonState } from '$lib/admin/save-button-state';
import { formPress } from '$lib/admin/unreached';
import { boxProps, resultFor, useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { formatMinor } from '$lib/donations/money';
import { FORM_CURRENCY, readAmount } from '$lib/forms/amounts';
import { defineForm, type FormRejection, WHICH_FORM } from '$lib/forms/definition';
import {
	CORRECTION_FIELD_LABELS,
	CORRECTION_INPUT,
	readAccountingDate
} from '$lib/ledger/input-schema';
import { ENTRY_SOURCE_LABELS } from '$lib/ledger/sources';
import { retryFailedEntries } from '$lib/server/accounting/backlog';
import { connectFlowOrigin, mintConnectLink } from '$lib/server/accounting/connect-link';
import {
	type ChosenAccount,
	disconnectQuickbooks,
	readQuickbooksConnection,
	saveQuickbooksAccounts
} from '$lib/server/accounting/connection';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { moveQuickbooksStartAt, previewQuickbooksStartAt } from '$lib/server/accounting/outbox';
import { ACCOUNT_ROLES, type AccountRole } from '$lib/server/accounting/provider';
import { fitsRole } from '$lib/server/accounting/quickbooks-accounts';
import {
	dayOf,
	type QuickbooksScreen,
	readQuickbooksScreen,
	type StartDateAsk,
	startDateAsk
} from '$lib/server/accounting/quickbooks-screen';
import { readAuthEnv, STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm } from '$lib/server/conform';
import { pickableAccounts, postableIdFromSubmitted } from '$lib/server/db/accounts';
import { notFound } from '$lib/server/db/load-failure';
import { postCorrection } from '$lib/server/books/correct';
import {
	ENTRY_GROUP_LIST_LIMIT,
	type EntryGroupListRow,
	type EntryGroupPage,
	findEntryGroup,
	listEntryGroups
} from '$lib/server/ledger/queries';
import { auth, database, platform, staff } from '../context';
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
// `$lib/server/books/correct.ts`, and what the entries are is `$lib/server/ledger/queries.ts`; the
// only job here is turning a request into one and a failure into the other. that split is the one
// every other write route on this dashboard is under (`createContact`, `createForm`), and it is
// what keeps a second poster — a backfill, a repair script — from copying the sign
// convention out of a screen.
//
// **below the books, the deployer's way to QuickBooks** — keys, connect, accounts and sync, as four
// steps. a member's Books is the ledger alone: the loader reads none of it for them and every
// QuickBooks press answers them not-found, while a correction posts for both. the keys are
// `.env`'s and no box here takes one; what this half reads is
// `$lib/server/accounting/quickbooks-screen.ts`, and the round trip to Intuit leaves from a press
// here and comes back through ./quickbooks.connect.tsx and ./quickbooks.callback.tsx.

/** each form's id, as the literal a body names itself with. */
const CORRECTION_ID = 'correction';
const CONNECT_ID = 'quickbooks-connect';
const DISCONNECT_ID = 'quickbooks-disconnect';
const RETRY_ID = 'quickbooks-retry';
const ACCOUNTS_ID = 'quickbooks-accounts';
const START_PREVIEW_ID = 'quickbooks-start-date-preview';
const START_ID = 'quickbooks-start-date';
const SCREEN_FORMS = [
	CORRECTION_ID,
	CONNECT_ID,
	DISCONNECT_ID,
	RETRY_ID,
	ACCOUNTS_ID,
	START_PREVIEW_ID,
	START_ID
] as const;

/**
 * the correction form, stated once for the action that reads a body against it and the screen that
 * submits to it. the id is a literal and never derived — see `$lib/server/conform.ts`'s header.
 */
const CORRECTION_FORM = defineForm({ id: CORRECTION_ID, schema: CORRECTION_INPUT });

/** the presses over QuickBooks, which state nothing a body could choose: the company is the row's. */
const CONNECT_FORM = defineForm({ id: CONNECT_ID, schema: z.object({}) });
const DISCONNECT_FORM = defineForm({ id: DISCONNECT_ID, schema: z.object({}) });
const RETRY_FORM = defineForm({ id: RETRY_ID, schema: z.object({}) });

/**
 * every role's account, by id: income and fees one each, and each holding one or none. every role
 * is in the body — a holding the screen draws no picker for rides as a hidden box holding what is
 * stored — so a save is the operator's whole answer and never clears a role by leaving it out.
 */
const pick = z.string({ error: 'required' });
const holding = z.string().optional();
const ACCOUNTS_FORM = defineForm({
	id: ACCOUNTS_ID,
	schema: z.object({
		income: pick,
		fee: pick,
		stripeBalance: holding,
		paypalBalance: holding,
		chariotBalance: holding,
		nowpaymentsBalance: holding,
		undepositedFunds: holding
	})
});

/** the earliest day a gift is sent from, read as that day's first instant in UTC. */
const startOn = z.string({ error: 'required' }).superRefine((text, ctx) => {
	const { problem } = readAccountingDate(text);
	if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
});
const START_PREVIEW_FORM = defineForm({
	id: START_PREVIEW_ID,
	schema: z.object({ start_on: startOn })
});
const START_FORM = defineForm({ id: START_ID, schema: z.object({ start_on: startOn }) });

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

/** what a member's session is told about a QuickBooks press, which is the deployer's alone. */
const NOT_HERE =
	`No QuickBooks press at ${SCREEN} for a member’s session. Where the books sync to is the ` +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

/** what a press that needs a company is told where none is connected. */
const NOT_CONNECTED = 'No QuickBooks company is connected. Connect one, then try again.';

/** what a pick the company's chart no longer holds is told. */
const NOT_IN_CHART = 'isn’t in the company’s chart of accounts any more. Choose again.';

/**
 * what a pick whose type does not fit its role is told, completing the picker's label. the pickers
 * offer only what fits, so the one way here is a chart that changed at Intuit after the page drew it.
 */
const misfitSays = (role: AccountRole): string =>
	role === 'income' || role === 'fee'
		? 'pick another account from this list'
		: 'pick an Other Current Asset account, never a bank account';

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
	return calendarDay(at, Intl.DateTimeFormat().resolvedOptions().timeZone);
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

export async function loader({ context, request }: Route.LoaderArgs) {
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
						// `Intl.DateTimeFormat` in a component would run once on the server during ssr and
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
		hasMore: page?.hasMore ?? false,
		// the deployer's alone: a member's Books is the ledger, and the company it syncs to is not
		// theirs to see or change.
		quickbooks: context.get(staff).id === STAFF_USER_ID ? await quickbooks() : null
	};

	// a half that could not be read is said rather than failing the page, for the list's reason:
	// the corrections above it post without it.
	async function quickbooks(): Promise<QuickbooksScreen | 'unreadable'> {
		try {
			const { env, deferred } = context.get(platform);
			return await readQuickbooksScreen(env, db, deferred, request.url, new Date());
		} catch (e) {
			console.error('reading where the books stand at QuickBooks failed:', e);
			return 'unreadable';
		}
	}
}

/**
 * a correction, which every member may post, or one of the deployer's QuickBooks presses.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` is
 * what reads what it returns, and nothing above this route may.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const pressed = submittedForm(body, SCREEN_FORMS);
	if (pressed === CORRECTION_ID) return correct(body);

	// a member is answered as if the presses were not here, which for them they are not.
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	switch (pressed) {
		case CONNECT_ID:
			return startConnect(body);
		case DISCONNECT_ID:
			return disconnect(body);
		case RETRY_ID:
			return retry(body);
		case ACCOUNTS_ID:
			return saveAccounts(body);
		case START_PREVIEW_ID:
			return previewStart(body);
		case START_ID:
			return moveStart(body);
	}

	// the arms are declared inside the action because react router strips the `action` export from
	// the browser bundle and nothing else: a module-scope helper reaching `$lib/server/**` would ship
	// it (../routes.spec.ts holds that over the module graph).

	/**
	 * the trip to Intuit's consent screen, which leaves this page for good: a document redirect to
	 * the signed start address ./quickbooks.connect.tsx checks, which mints the `state` and sends the
	 * browser on. the address is minted behind this deployer's session, which is the guard that
	 * keeps a stranger from connecting their own books ($lib/server/accounting/connect-link.ts).
	 */
	async function startConnect(body: FormData) {
		const submission = parseForm(body, CONNECT_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		// the key the gate already resolved for this request, off the auth instance it built with it:
		// a second read here would be a second resolve the gate exists to make once
		// (../routes.spec.ts). an instance from the gate always holds one: $lib/server/auth/index.ts
		// refuses to build one over an empty key.
		const secret = context.get(auth).options.secret;
		if (secret === undefined) throw new Error('the gate built an auth instance with no secret');
		return redirectDocument(
			await mintConnectLink({
				secret,
				origin: connectFlowOrigin(readAuthEnv(context.get(platform).env), new URL(request.url)),
				now: new Date()
			})
		);
	}

	/**
	 * the credential revoked at Intuit and the connection forgotten here, whatever the revoke
	 * answered: a row kept over a failed revoke is a connection nothing can use. a revoke Intuit did
	 * not confirm is said, because a grant left live there is only ended from Intuit's side.
	 */
	async function disconnect(body: FormData) {
		const submission = parseForm(body, DISCONNECT_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const db = context.get(database);
		const revoked = await createAccountingProvider(context.get(platform).env, db).revokeTokens();
		await disconnectQuickbooks(db);
		return {
			disconnected: revoked.ok
				? { revoked: true as const }
				: { revoked: false as const, detail: revoked.detail }
		};
	}

	/** every gift given up on, queued again — for a company that is there to take them. */
	async function retry(body: FormData) {
		const submission = parseForm(body, RETRY_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const db = context.get(database);
		if ((await readQuickbooksConnection(db)) === null) {
			return invalid(409, submission.reject({ formErrors: [NOT_CONNECTED] }));
		}
		return { retried: await retryFailedEntries(db) };
	}

	/** what moving the start date would queue and drop, written nowhere, and what to ask first. */
	async function previewStart(body: FormData) {
		const submission = parseForm(body, START_PREVIEW_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const db = context.get(database);
		const connection = await readQuickbooksConnection(db);
		if (connection === null) {
			return invalid(409, submission.reject({ formErrors: [NOT_CONNECTED] }));
		}
		// the schema's own read, taken again for the instant rather than the sentence.
		const to = readAccountingDate(submission.value.start_on).at;
		if (to === null) return invalid(400, submission.reject());
		const move = await previewQuickbooksStartAt(db, to, new Date());
		return {
			preview: {
				startOn: submission.value.start_on,
				ask: startDateAsk(
					move,
					dayOf(connection.startAt),
					submission.value.start_on,
					connection.companyName ?? connection.realmId
				)
			}
		};
	}

	async function moveStart(body: FormData) {
		const submission = parseForm(body, START_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const db = context.get(database);
		if ((await readQuickbooksConnection(db)) === null) {
			return invalid(409, submission.reject({ formErrors: [NOT_CONNECTED] }));
		}
		const to = readAccountingDate(submission.value.start_on).at;
		if (to === null) return invalid(400, submission.reject());
		await moveQuickbooksStartAt(db, to, new Date());
		return { moved: submission.value.start_on };
	}

	/**
	 * every role's account, each id checked against the company's own chart and the role it is
	 * picked for before anything is stored, and stored under the chart's name for it rather than one
	 * a body could send.
	 */
	async function saveAccounts(body: FormData) {
		const submission = parseForm(body, ACCOUNTS_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const db = context.get(database);
		if ((await readQuickbooksConnection(db)) === null) {
			return invalid(409, submission.reject({ formErrors: [NOT_CONNECTED] }));
		}
		const chart = await createAccountingProvider(context.get(platform).env, db).listAccounts();
		if (!chart.ok) return invalid(500, submission.reject({ formErrors: [chart.detail] }));

		const refused: Record<string, string[]> = {};
		const chosen: Partial<Record<AccountRole, ChosenAccount | null>> = {};
		for (const role of ACCOUNT_ROLES) {
			const id = submission.value[role];
			if (id === undefined) {
				chosen[role] = null;
				continue;
			}
			const account = chart.value.find((entry) => entry.id === id);
			if (account === undefined) refused[role] = [NOT_IN_CHART];
			else if (!fitsRole(account, role)) refused[role] = [misfitSays(role)];
			else chosen[role] = { id: account.id, name: account.name };
		}
		const { income, fee } = chosen;
		if (Object.keys(refused).length > 0 || income == null || fee == null) {
			return invalid(400, submission.reject({ fieldErrors: refused }));
		}
		await saveQuickbooksAccounts(db, {
			income,
			fee,
			stripeBalance: chosen.stripeBalance ?? null,
			paypalBalance: chosen.paypalBalance ?? null,
			chariotBalance: chosen.chariotBalance ?? null,
			nowpaymentsBalance: chosen.nowpaymentsBalance ?? null,
			undepositedFunds: chosen.undepositedFunds ?? null
		});
		return { saved: true as const };
	}

	/** post one correcting entry. */
	async function correct(body: FormData) {
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
}

/**
 * a press whose request never reached the server, answered in the browser as the refusal of the
 * form that was pressed rather than with the error boundary ($lib/admin/unreached.ts).
 */
export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

/**
 * the loader is read again after every press but the start-date preview, which writes nothing: a
 * read after it would be a metered call to Intuit for the chart, and a wait on it, for the same
 * page. every other press wrote something the loader reads — a correction its entry and the next
 * posting id, a QuickBooks press the connection or the backlog — and a refused one is already left
 * unread by the router's own default.
 */
export function shouldRevalidate({
	formData,
	defaultShouldRevalidate
}: ShouldRevalidateFunctionArgs) {
	return formData?.get(WHICH_FORM) === START_PREVIEW_ID ? false : defaultShouldRevalidate;
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
	// empty rather than with a day of its own: the server's clock knows nothing of the operator's
	// zone, and a different day on the first client pass would not hydrate.
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
						<input {...whichForm(CORRECTION_FORM.id)} />

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

			{loaderData.quickbooks === 'unreadable' ? (
				<Section>
					<h2 id={QUICKBOOKS_ID}>QuickBooks</h2>
					<Banner tone="attention" word="Where the books stand at QuickBooks could not be read" />
				</Section>
			) : loaderData.quickbooks === null ? null : (
				<Quickbooks screen={loaderData.quickbooks} />
			)}
		</Column>
	);
}

type LoaderData = Route.ComponentProps['loaderData'];
type QuickbooksRead = Exclude<LoaderData['quickbooks'], null | 'unreadable'>;
type Company = NonNullable<QuickbooksRead['company']>;
type Role = keyof Company['picks'];
type Holding = QuickbooksRead['holdings'][number];

/** a press's answer where the server refused it, or where it never reached the server. */
type Refused = { readonly form?: FormRejection };
type DisconnectAnswer = Refused & {
	readonly disconnected?:
		| { readonly revoked: true }
		| { readonly revoked: false; readonly detail: string };
};
type RetryAnswer = Refused & { readonly retried?: number };
type AccountsAnswer = Refused & { readonly saved?: true };
type PreviewAnswer = Refused & {
	readonly preview?: { readonly startOn: string; readonly ask: StartDateAsk | null };
};
type MoveAnswer = Refused & { readonly moved?: string };

/** what a press's form-wide refusal says, or nothing. */
const formRefusal = (form: { readonly id: string }, answer: Refused | undefined) =>
	resultFor(form, answer)?.error?.['']?.[0];

/** the address the QuickBooks half is reached at from the round trip's pages. */
const QUICKBOOKS_ID = 'quickbooks';

/** where an operator creates the Intuit app whose keys go in `.env`. */
const INTUIT_DEVELOPER = 'https://developer.intuit.com/';

/** what each picker is called. */
const PICK_LABEL: Record<Role, string> = {
	income: 'Income',
	fee: 'Processing fees',
	stripeBalance: 'Stripe balance',
	paypalBalance: 'PayPal balance',
	chariotBalance: 'Chariot balance',
	nowpaymentsBalance: 'NOWPayments balance',
	undepositedFunds: 'Gifts recorded by hand'
};

/**
 * the line over each holding's picker: what the bookkeeper does when the money moves on. this
 * deployment hears no payout, so the money leaving a holding is recorded off the bank feed.
 */
const HOLDING_HINT: Record<Holding, string> = {
	stripeBalance: payoutHint('Stripe'),
	paypalBalance: payoutHint('PayPal'),
	chariotBalance: payoutHint('Chariot'),
	nowpaymentsBalance: payoutHint('NOWPayments'),
	undepositedFunds: 'Record each deposit from your bank feed as a transfer out of this account.'
};

function payoutHint(processor: string): string {
	return `Record each ${processor} payout from your bank feed as a transfer out of this account.`;
}

const PICK_ROLES = [
	'income',
	'fee',
	'stripeBalance',
	'paypalBalance',
	'chariotBalance',
	'nowpaymentsBalance',
	'undepositedFunds'
] as const satisfies readonly Role[];

/** the four parts of connecting the books, in the order the code takes them. */
type StepName = 'setup' | 'connect' | 'accounts' | 'sync';

type Standing = {
	readonly done: boolean;
	readonly trouble: boolean;
	readonly locked: boolean;
	readonly open: boolean;
};

/**
 * where each step stands. Connect is locked until the keys are on the server, Accounts until a
 * company is connected, and Sync is drawn only once income and fees are picked and a moved
 * connection's accounts saved, since nothing is sent before. the first unfinished step is open, a
 * finished one shut, and trouble opens its step — Sync's is a gift that did not sync.
 */
function stepsStand(screen: QuickbooksRead): Readonly<Record<StepName, Standing>> & {
	readonly synced: boolean;
} {
	const { company, chart } = screen;
	const lapsed = chart?.state === 'unreadable' && chart.recourse === 'reconnect';
	const setup = screen.unsetKeys.length === 0;
	const connect = company !== null;
	const accounts =
		company !== null &&
		!company.awaitingAccounts &&
		company.picks.income !== null &&
		company.picks.fee !== null;
	// sync is never the step to take next: once drawn it is done, or in trouble over a gift.
	const done = { setup, connect, accounts, sync: setup && connect && accounts };
	const trouble = {
		setup: false,
		connect: lapsed,
		accounts: chart?.state === 'unreadable' && !lapsed,
		sync: screen.backlog !== null
	};
	const locked = { setup: false, connect: !done.setup, accounts: !done.connect, sync: false };
	const current = (['setup', 'connect', 'accounts'] as const).find((name) => !done[name]);
	const step = (name: StepName): Standing => ({
		done: done[name],
		trouble: trouble[name],
		locked: locked[name],
		open: !locked[name] && (name === current || trouble[name])
	});
	return {
		setup: step('setup'),
		connect: step('connect'),
		accounts: step('accounts'),
		sync: step('sync'),
		synced: done.sync
	};
}

/** what a chart that could not be read says, by what the operator does about it. */
function chartSays(recourse: 'reconnect' | 'wait' | null): string {
	if (recourse === 'reconnect') return 'QuickBooks turned this connection down.';
	if (recourse === 'wait')
		return 'QuickBooks can’t be reached right now. This deployment keeps trying.';
	return 'This deployment couldn’t read your chart of accounts.';
}

/** one step: its word, its line, its mark, and what it opens onto. */
function Step({
	name,
	label,
	note,
	standing,
	children
}: {
	readonly name: StepName;
	readonly label: string;
	readonly note?: string | undefined;
	readonly standing: Standing;
	readonly children: ReactNode;
}) {
	return (
		<StatusLine
			id={`quickbooks-${name}`}
			label={label}
			note={note}
			word={standing.trouble ? 'Needs attention' : standing.done ? 'Done' : 'To do'}
			wordOnMark
			labelAs="h3"
			tone={standing.trouble ? 'blocker' : standing.done ? 'done' : 'note'}
			// a step not yet done is the unfilled outline, which the note tone would draw as `info`.
			mark={standing.trouble || standing.done ? undefined : 'circle-dashed'}
			locked={standing.locked}
			open={standing.open}
			openFor={standing.open ? ['current'] : []}
			beneath={children}
		/>
	);
}

/** the deployer's half of Books: the books' way to QuickBooks, as four steps. */
function Quickbooks({ screen }: { readonly screen: QuickbooksRead }) {
	const { company, chart } = screen;
	const steps = stepsStand(screen);
	return (
		<Section>
			<div className="adm-record__head">
				<h2 id={QUICKBOOKS_ID}>QuickBooks</h2>
				{company === null ? (
					<StatusWord secondary>Not connected</StatusWord>
				) : (
					<StatusWord tone="done">Connected to {company.name}</StatusWord>
				)}
			</div>
			<StatusLedger sections>
				<Step
					name="setup"
					label="Setup"
					note={
						steps.setup.done
							? 'Your Intuit app’s keys are on the server.'
							: 'Needs an Intuit app’s keys on the server'
					}
					standing={steps.setup}
				>
					<Stack>
						{steps.setup.done ? null : <ServerSteps unset={screen.unsetKeys} />}
						<RedirectAddress address={screen.callback} />
					</Stack>
				</Step>
				<Step
					name="connect"
					label="Connect"
					note={company === null ? 'Connect to your app' : `Connected to ${company.name}`}
					standing={steps.connect}
				>
					{company === null ? (
						<NotConnected />
					) : (
						<Connected
							company={company}
							lapsed={chart?.state === 'unreadable' && chart.recourse === 'reconnect'}
						/>
					)}
				</Step>
				<Step
					name="accounts"
					label="Accounts"
					note={
						company === null
							? undefined
							: 'What a gift is recorded as, and where money waits before it reaches your bank'
					}
					standing={steps.accounts}
				>
					{company === null || chart === null ? (
						// locked until a company is connected, so never opened; a fold with nothing
						// beneath it draws no caret and no lock.
						<Stack />
					) : (
						<Accounts company={company} chart={chart} holdings={screen.holdings} />
					)}
				</Step>
				{steps.synced && company !== null ? (
					<Step
						name="sync"
						label="Sync"
						note="Sync gifts from a date you pick"
						standing={steps.sync}
					>
						<Stack>
							<Backlog backlog={screen.backlog} />
							<StartDate company={company} />
						</Stack>
					</Step>
				) : null}
			</StatusLedger>
		</Section>
	);
}

/**
 * the setup a deployment short of Intuit's keys needs, in two parts for two readers: the staff
 * sentence, and under it the steps for whoever runs the server, since no box here sets a key. the
 * `.env` lines are the unset keys' alone, so a deployment short of one is told that one.
 */
function ServerSteps({ unset }: { readonly unset: QuickbooksRead['unsetKeys'] }) {
	return (
		<>
			<p className="adm-prose">
				To send gifts to QuickBooks, this site needs an Intuit app. Ask whoever set up this site to
				add it. The steps below are for them.
			</p>
			<div className="adm-named">
				<h4>For whoever runs the server</h4>
				<p className="adm-prose">
					Create an app at <a href={INTUIT_DEVELOPER}>Intuit Developer</a> and add the address below
					to its redirect URIs. Add {unset.length === 1 ? 'this line' : 'these lines'} to{' '}
					<InlineCode>.env</InlineCode> (DEPLOY.md, QuickBooks), then recreate the app:
				</p>
				<CodeSlab label=".env" content={unset.map(envLine).join('\n')} copyable />
				<CodeSlab oneline content={RECREATE_APP} copyable copyLabel="Copy the command" />
			</div>
		</>
	);
}

/** the address to register at Intuit, copied out from here. */
function RedirectAddress({ address }: { readonly address: string }) {
	const caption = `${useId()}-redirect`;
	return (
		<div className="adm-stated adm-break">
			<span className="adm-field__label" id={caption}>
				Add this to your Intuit app’s redirect URIs
			</span>
			<CodeSlab oneline copyable content={address} copyLabel="Copy address" labelledBy={caption} />
		</div>
	);
}

/**
 * the press that leaves for Intuit's consent screen. the answer is a whole-document redirect, so a
 * press that landed is never drawn here: Intuit's page replaces this one, and the page the trip
 * ends on leads back.
 */
function ConnectPress({ label }: { readonly label: string }) {
	const fetcher = useFetcher<Refused>({ key: CONNECT_FORM.id });
	const busy = fetcher.state !== 'idle';
	const refused = busy ? undefined : formRefusal(CONNECT_FORM, fetcher.data);
	return (
		<fetcher.Form method="post" className="adm-stack">
			<input {...whichForm(CONNECT_FORM.id)} />
			<div className="adm-actions">
				<HeldButton busy={busy} variant="primary">
					{label}
				</HeldButton>
			</div>
			<p className="adm-hint">You’ll sign in at Intuit and choose the company there.</p>
			{refused === undefined ? null : <FieldMessage>{refused}</FieldMessage>}
		</fetcher.Form>
	);
}

/**
 * the way in, under what the last disconnect could not confirm: a revoke Intuit did not take leaves
 * the app among the company's connected apps, which is somewhere this screen cannot show.
 */
function NotConnected() {
	const { data } = useFetcher<DisconnectAnswer>({ key: DISCONNECT_FORM.id });
	const unrevoked = data?.disconnected?.revoked === false ? data.disconnected : null;
	return (
		<Stack tight>
			{unrevoked === null ? null : (
				<>
					<FieldMessage>Intuit didn’t confirm the disconnect.</FieldMessage>
					<p className="adm-prose">{unrevoked.detail}</p>
					<p className="adm-prose">
						This deployment no longer holds the connection, but Intuit may still list the app as
						connected. In QuickBooks Online, open Apps, then My Apps, and disconnect it there.
					</p>
				</>
			)}
			<ConnectPress label="Choose a company" />
		</Stack>
	);
}

/** the company gifts sync to, the way back in where its credential lapsed, and the way out. */
function Connected({ company, lapsed }: { readonly company: Company; readonly lapsed: boolean }) {
	const fetcher = useFetcher<DisconnectAnswer>({ key: DISCONNECT_FORM.id });
	const busy = fetcher.state !== 'idle';
	const refused = busy ? undefined : formRefusal(DISCONNECT_FORM, fetcher.data);
	const [asking, setAsking] = useState(false);
	// set by the confirm's own press on its way to the submit it causes, the one not asked again.
	const confirmed = useRef(false);
	return (
		<Stack>
			<p className="adm-prose">Gifts sync to {company.name}.</p>
			{lapsed ? (
				<Stack tight>
					<FieldMessage>{chartSays('reconnect')}</FieldMessage>
					<ConnectPress label="Sign in again" />
				</Stack>
			) : null}
			<fetcher.Form
				method="post"
				onSubmit={(event) => {
					if (confirmed.current) {
						confirmed.current = false;
						setAsking(false);
						return;
					}
					event.preventDefault();
					setAsking(true);
				}}
			>
				<input {...whichForm(DISCONNECT_FORM.id)} />
				<div className="adm-actions">
					<HeldButton busy={busy}>Disconnect</HeldButton>
				</div>
				{refused === undefined ? null : <FieldMessage>{refused}</FieldMessage>}
				{asking ? (
					<Modal
						title={`Disconnect ${company.name}?`}
						onDismiss={() => setAsking(false)}
						danger="Disconnect"
						dangerProps={{
							type: 'submit' as const,
							onClick: () => {
								confirmed.current = true;
							}
						}}
						cancel="Go back"
						cancelProps={{ type: 'button' as const, onClick: () => setAsking(false) }}
					>
						<Stack tight>
							<p className="adm-prose">{stopped(`Gifts stop syncing to ${company.name}`)}</p>
							<p className="adm-prose">
								This deployment forgets the company, its accounts and the day gifts sync from.
							</p>
						</Stack>
					</Modal>
				) : null}
			</fetcher.Form>
		</Stack>
	);
}

/** a sentence ending on a name that already ends in a stop takes no second one. */
const stopped = (text: string): string => (text.endsWith('.') ? text : `${text}.`);

/** where a gift is posted, picked out of the company's own chart. */
function Accounts({
	company,
	chart,
	holdings
}: {
	readonly company: Company;
	readonly chart: NonNullable<QuickbooksRead['chart']>;
	readonly holdings: readonly Holding[];
}) {
	const moved = company.awaitingAccounts ? (
		<FieldMessage tone="needed">
			This connection moved to {company.name}, and nothing is sent to QuickBooks until its accounts
			are saved.
		</FieldMessage>
	) : null;

	if (chart.state === 'unreadable') {
		// what is wrong is said at the step it blocks: a lapsed credential at Connect, anything else
		// here. the picks stand as stored, and no box takes an id typed by hand.
		return (
			<Stack>
				{moved}
				{(['income', 'fee', ...holdings] as const).map((role) => (
					<StatedValue
						key={role}
						label={PICK_LABEL[role]}
						value={
							company.picks[role]?.name ??
							(role === 'income' || role === 'fee' ? 'Not picked' : 'None')
						}
					/>
				))}
				{chart.recourse === 'reconnect' ? null : (
					<FieldMessage>{chartSays(chart.recourse)}</FieldMessage>
				)}
			</Stack>
		);
	}

	return (
		<Stack>
			{moved}
			{/* keyed on what is stored, so the read after a save remounts the pickers on it. */}
			<AccountsForm
				key={PICK_ROLES.map((role) => company.picks[role]?.id ?? '').join('|')}
				company={company}
				chart={chart.accounts}
				holdings={holdings}
			/>
		</Stack>
	);
}

function AccountsForm({
	company,
	chart,
	holdings
}: {
	readonly company: Company;
	readonly chart: readonly {
		readonly id: string;
		readonly label: string;
		readonly roles: readonly Role[];
	}[];
	readonly holdings: readonly Holding[];
}) {
	const fetcher = useFetcher<AccountsAnswer>();
	const busy = fetcher.state !== 'idle';
	const answer = busy ? undefined : fetcher.data;
	const stored = Object.fromEntries(
		PICK_ROLES.map((role) => [role, company.picks[role]?.id ?? ''])
	) as Record<Role, string>;
	const [picks, setPicks] = useState(stored);
	const changed =
		company.awaitingAccounts || PICK_ROLES.some((role) => picks[role] !== stored[role]);
	const save = useSaveState({ landed: answer?.saved === true, changed, pending: busy });
	const refused = formRefusal(ACCOUNTS_FORM, answer);
	const boxError = (role: Role) => resultFor(ACCOUNTS_FORM, answer)?.error?.[role]?.[0];
	const id = useId();

	/**
	 * one picker over the chart, offering only the accounts that fit it. a stored pick the chart no
	 * longer offers stays shown, retired, until another is chosen, so the screen never silently
	 * moves where gifts are posted. income and fees open on a blank while nothing is chosen; a
	 * holding offers None always, since it holds that processor's gifts and nothing else.
	 */
	const picker = (role: Role, hint?: string) => {
		const options = chart
			.filter((account) => account.roles.includes(role))
			.map((account) => ({ value: account.id, label: account.label }));
		const showing = picks[role];
		const holding = role !== 'income' && role !== 'fee';
		const empty = holding
			? [{ value: '', label: 'None' }]
			: stored[role] === '' || showing === ''
				? [{ value: '', label: 'Choose an account' }]
				: [];
		const offered = showing === '' || options.some((option) => option.value === showing);
		return (
			<SelectWithNote
				key={role}
				id={`${id}-${role}`}
				name={role}
				label={PICK_LABEL[role]}
				hint={hint}
				options={[...empty, ...options]}
				retired={
					offered
						? undefined
						: {
								value: showing,
								label:
									chart.find((account) => account.id === showing)?.label ??
									company.picks[role]?.name ??
									showing
							}
				}
				value={showing}
				onValueChange={(value) => setPicks({ ...picks, [role]: value })}
				error={boxError(role)}
			/>
		);
	};

	return (
		<fetcher.Form method="post" className="adm-stack">
			<input {...whichForm(ACCOUNTS_FORM.id)} />
			{/* every role rides every save, so a holding with no picker carries what is stored. */}
			{PICK_ROLES.filter(
				(role) => role !== 'income' && role !== 'fee' && !holdings.includes(role)
			).map((role) => (
				<input key={role} type="hidden" name={role} value={stored[role]} />
			))}
			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">What a gift is recorded as</legend>
				<div className="adm-pair adm-pair--side">
					{picker('income')}
					{picker('fee')}
				</div>
			</fieldset>
			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">
					Where money waits before it reaches your bank
				</legend>
				{holdings.map((role) => picker(role, HOLDING_HINT[role]))}
			</fieldset>
			{refused === undefined ? null : <FieldMessage>{refused}</FieldMessage>}
			<div className="adm-actions">
				<SaveButton type="submit" state={buttonState(save)} label="Save accounts" elsewhere="" />
			</div>
		</fetcher.Form>
	);
}

/**
 * the gifts that were given up on, the refunds waiting behind them, and the press that queues the
 * gifts again — which reports what it queued beside itself.
 */
function Backlog({ backlog }: { readonly backlog: QuickbooksRead['backlog'] }) {
	const fetcher = useFetcher<RetryAnswer>({ key: RETRY_FORM.id });
	const busy = fetcher.state !== 'idle';
	const answer = busy ? undefined : fetcher.data;
	const refused = formRefusal(RETRY_FORM, answer);
	const retried = answer?.retried;
	if (backlog === null && retried === undefined && refused === undefined) return null;
	return (
		<fetcher.Form method="post" className="adm-stack">
			<input {...whichForm(RETRY_FORM.id)} />
			{backlog === null ? null : (
				<FieldMessage tone="needed">
					{backlog.failed === 1 ? '1 gift didn’t sync' : `${backlog.failed} gifts didn’t sync`}.
					{backlog.behind === null ? null : ` QuickBooks is ${backlog.behind} behind.`}
				</FieldMessage>
			)}
			{backlog?.held == null ? null : (
				<FieldMessage tone="needed">{heldSays(backlog.held)}</FieldMessage>
			)}
			<div className="adm-actions">
				{backlog === null ? null : <HeldButton busy={busy}>Try these again</HeldButton>}
				{/* mounted in every state, so the sentence arriving in it is announced. */}
				<span className="adm-hint" role="status">
					{retried === undefined
						? null
						: retried === 0
							? 'Nothing was left to send.'
							: `${retried} queued to sync again.`}
				</span>
			</div>
			{refused === undefined ? null : <FieldMessage>{refused}</FieldMessage>}
		</fetcher.Form>
	);
}

/**
 * the refunds waiting behind a gift given up on. a held refund is tried only once its gift is sent,
 * so a gift recorded in QuickBooks by hand rather than tried again sends none of its refunds.
 */
function heldSays({
	refunds,
	gifts
}: {
	readonly refunds: number;
	readonly gifts: number;
}): string {
	const waiting = refunds === 1 ? '1 refund is waiting' : `${refunds} refunds are waiting`;
	const on = gifts === 1 ? 'a gift' : 'gifts';
	const which = gifts === 1 ? 'that gift' : 'one of those gifts';
	const its = refunds === 1 ? 'its refund' : 'its refunds';
	return `${waiting} on ${on} that didn’t sync. If you record ${which} in QuickBooks by hand, record ${its} there by hand too.`;
}

/**
 * the earliest date a gift may carry to reach the books.
 *
 * **the save asks the deployment what the move touches before it makes it.** a move earlier queues
 * every gift owed from the new day on and a move later skips the unsent ones before it, so the
 * press previews first, and moves straight away where the preview found nothing to agree to and
 * behind a confirm naming what it sends or skips where it did.
 */
function StartDate({ company }: { readonly company: Company }) {
	const preview = useFetcher<PreviewAnswer>({ key: START_PREVIEW_FORM.id });
	const move = useFetcher<MoveAnswer>({ key: START_FORM.id });
	const busy = preview.state !== 'idle' || move.state !== 'idle';
	const [day, setDay] = useState(company.startOn);
	// the preview this form is waiting on, by the day it asked about, until it is answered.
	const [asked, setAsked] = useState<string | null>(null);
	const answered =
		asked !== null && preview.state === 'idle' && preview.data?.preview?.startOn === asked
			? preview.data.preview
			: null;
	const ask = answered?.ask ?? null;

	const submitMove = useCallback(
		(to: string) => {
			setAsked(null);
			move.submit({ [WHICH_FORM]: START_FORM.id, start_on: to }, { method: 'post' });
		},
		[move.submit]
	);
	useEffect(() => {
		if (answered !== null && answered.ask === null) submitMove(answered.startOn);
	}, [answered, submitMove]);

	const landed = move.state === 'idle' && move.data?.moved === company.startOn;
	const save = useSaveState({
		landed,
		changed: day !== '' && day !== company.startOn,
		pending: busy
	});
	const refused =
		formRefusal(START_PREVIEW_FORM, preview.data) ?? formRefusal(START_FORM, move.data);
	const boxError =
		resultFor(START_PREVIEW_FORM, preview.data)?.error?.start_on?.[0] ??
		resultFor(START_FORM, move.data)?.error?.start_on?.[0];
	const id = useId();

	return (
		<preview.Form method="post" className="adm-stack adm-break" onSubmit={() => setAsked(day)}>
			<input {...whichForm(START_PREVIEW_FORM.id)} />
			<Field
				id={`${id}-start`}
				name="start_on"
				type="date"
				label="Sync gifts from"
				value={day}
				onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
					setDay(event.currentTarget.value)
				}
				error={boxError}
			/>
			<div className="adm-actions">
				<SaveButton type="submit" state={buttonState(save)} elsewhere="" />
			</div>
			{refused === undefined ? null : <FieldMessage>{refused}</FieldMessage>}
			{ask === null || answered === null ? null : (
				<Modal
					title={ask.title}
					onDismiss={() => setAsked(null)}
					{...(ask.rank === 'exit'
						? {
								exit: ask.press,
								exitProps: { type: 'button' as const, onClick: () => submitMove(answered.startOn) }
							}
						: {
								danger: ask.press,
								dangerProps: {
									type: 'button' as const,
									onClick: () => submitMove(answered.startOn)
								}
							})}
					cancel="Go back"
					cancelProps={{ type: 'button' as const, onClick: () => setAsked(null) }}
				>
					<Stack tight>
						{ask.lines.map((line) => (
							<p key={line} className="adm-prose">
								{line}
							</p>
						))}
					</Stack>
				</Modal>
			)}
		</preview.Form>
	);
}

/**
 * a press held with `aria-disabled` and turned away in its own handler while its request is out,
 * never closed by `disabled`, which would drop the focus standing on it.
 */
function HeldButton({
	busy,
	variant,
	children
}: {
	readonly busy: boolean;
	readonly variant?: 'primary';
	readonly children: ReactNode;
}) {
	return (
		<Button
			type="submit"
			{...(variant === undefined ? {} : { variant })}
			aria-busy={busy || undefined}
			aria-disabled={busy || undefined}
			onClick={(event) => {
				if (busy) event.preventDefault();
			}}
		>
			{children}
		</Button>
	);
}
