import { TRIBUTE_KIND_LABELS, type TributeKind } from '@better-giving/form/v1';
import { Button } from '@better-giving/operator/components/controls/Button';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type ChangeEvent, type ReactNode, useId } from 'react';
import { Form, href, Link, useSubmit } from 'react-router';
import { GiftNote, PublicMessagesLink } from '$lib/admin/messages/gift-note';
import { byDayShown, type Received } from '$lib/admin/received-order';
import { DONATION_STATUS_TONES, MATCH_STATUS_TONES } from '$lib/admin/status-tones';
import { LocalTime, useViewerZone } from '$lib/admin/viewer-time.react';
import type { NoteStanding } from '$lib/donate/messages';
import { DONATION_STATUS_LABELS, type DonationStatus } from '$lib/donations/statuses';
import {
	MATCH_FILTER_LABELS,
	MATCH_STATUS_LABELS,
	type MatchFilter,
	type MatchStatus
} from '$lib/matching/status';

// the gifts list at /admin/donations: the table, the press row over it and the Match filter in that
// row. ../../../routes/_app.admin.donations._index.tsx reads the gifts and mounts this; every value
// arrives already projected there — the amount formatted, the rail as its word — and what is
// composed here is the arrangement and the few phrases a component may look up.

/** the element the table's caption is named by, and the only id this screen mints. */
const CAPTION_ID = 'gifts-caption';

/**
 * what each column is worth, in the order an operator reads a row.
 *
 * the first is the row's own header and what the plane pins to the leading edge, and it is the
 * donor: who gave is what a staff member holding an email or a match claim finds a gift by, and the
 * name is the way into the gift's own screen. Match stands second, so the column a match is worked
 * from is still on the glass beside the pinned name at 375px. `DataTable` decides the pin from
 * position — the first column is the `th` — so the order here is the arrangement and not only the
 * sequence.
 *
 * a `kind` is the reading a cell takes, drawn by packages/operator/src/styles/adm.css: a date is
 * one value and never wraps, money is end-aligned tabular figures, and a whole message wraps and
 * keeps a floor under its column. the ones with no kind are prose.
 *
 * a `width` is the column's share of the table, and the ten sum to the whole of it. it is stated
 * here rather than taken from a token because a share is a fact about these ten columns and
 * nothing a design system could hold — packages/operator/src/styles/tokens.css's header names a
 * table column's percentage among the few things a screen still writes. the date, the figure and the
 * rail take the smallest shares of the columns holding a value, because what each holds is one short
 * one. the message keeps the smallest share of all: it wraps by design and `whole` keeps a floor
 * under its column, so a small share widens the plane and scrolls it rather than losing anything.
 *
 * `Paid with` stands between the state and the source: the figure and its state are the money, how
 * it arrived qualifies both, and Source is where the gift came from. the header is the fundraiser's
 * phrase and never `method`, which is the column's name in the schema.
 *
 * the cause sits after Source and before the dedication, which is the order an operator reads a
 * gift in: where it came from, what it was given to, and who it was given for. `Dedication` and not
 * the schema's `tribute`: it is the fundraiser's own word, and the word the donor is asked in —
 * packages/form/src/views.ts writes `Dedicate this gift` on the tick that opens it. it is a column
 * of its own and not a line inside the message: a message is free text a donor wrote, and a
 * dedication is a structured fact the organisation reports on.
 */
const COLUMNS = [
	{ key: 'donor', label: 'Donor', width: '15%' },
	{ key: 'match', label: 'Match', width: '13%' },
	{ key: 'received', label: 'Received', kind: 'date', width: '10%' },
	{ key: 'amount', label: 'Amount', kind: 'money', width: '10%' },
	{ key: 'status', label: 'Status', width: '10%' },
	{ key: 'paidWith', label: 'Paid with', width: '8%' },
	{ key: 'source', label: 'Source', width: '10%' },
	{ key: 'program', label: 'Program', width: '10%' },
	{ key: 'dedication', label: 'Dedication', width: '10%' },
	{ key: 'message', label: 'Message', kind: 'whole', width: '4%' }
] as const;

/**
 * a gift's employer match as the list reads it: its one word and the employer the donor named.
 * `null` on a gift recorded before matching, which has no match at all.
 */
export type GiftMatchCell = {
	readonly status: MatchStatus | null;
	readonly employer: string | null;
} | null;

/** one gift as the route hands it over. */
export type GiftRow = Received & {
	/** the gift's own id: what keys the row and what the donor's name links to. */
	readonly id: string;
	readonly donorName: string;
	/** formatted in the loader, which holds the currency that decides where the point goes. */
	readonly amount: string;
	readonly source: string | null;
	readonly note: string | null;
	readonly noteStanding: NoteStanding;
	readonly status: DonationStatus;
	/** the rail's word, or `null` on a gift with nothing attempted. */
	readonly paidWith: string | null;
	/** what arrived on a crypto gift, as `0.05 ETH`; absent on every other. */
	readonly coinReceived?: string;
	readonly repeating: boolean;
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string } | null;
	readonly program: string | null;
	readonly trackingId: string | null;
	readonly match: GiftMatchCell;
};

export type GiftsTableProps = {
	readonly donations: readonly GiftRow[];
	/** the cap the read stops at. */
	readonly limit: number;
	/** whether more gifts stand past the cap than the list shows. */
	readonly hasMore: boolean;
	/** the Match filter the list was read under, from the `match` query parameter; `null` is Any. */
	readonly match: MatchFilter | null;
};

export function GiftsTable({ donations, limit, hasMore, match }: GiftsTableProps) {
	const count = donations.length;
	// the zone each row's day is shown in, which is the zone the rows are ordered by.
	const zone = useViewerZone();

	return (
		<DataTable
			captionId={CAPTION_ID}
			// the page's presses, drawn at the trailing edge of the caption's line. the filter leads,
			// because it acts on the rows under it; then the way out of the list, quieter; then adding a
			// gift, which is what an operator is most often here to do. wrapped in a row of their own:
			// `.adm-tablelead` spreads its own children apart.
			press={
				<div className="adm-actions">
					<MatchFilterSelect value={match} />
					<Button as={Link} to={href('/admin/donations/export')} variant="quiet">
						Export
					</Button>
					<PublicMessagesLink />
					<Button as={Link} to={href('/admin/donations/new')}>
						Add donation
					</Button>
				</div>
			}
			// with rows, the sentence that says what the table holds and is what names it. with none
			// the word is the screen's own noun, which `DataTable` gives the plane as its name.
			caption={count > 0 ? `${count} ${count === 1 ? 'gift' : 'gifts'}, newest first.` : 'Gifts'}
			capNote={hasMore ? `Only the most recent ${limit} are shown.` : undefined}
			columns={COLUMNS}
			// newest first by the day each row shows, which the stored order alone is not west of UTC
			// ($lib/admin/received-order.ts).
			rows={byDayShown(donations, zone).map((d) => ({
				id: d.id,
				cells: {
					// a string rather than `href()`: the detail route is the gift's own screen, and the
					// list is drawn before that route module exists to type one.
					donor: <Link to={`/admin/donations/${d.id}`}>{d.donorName}</Link>,
					match: matchCell(d.match),
					received:
						'receivedOn' in d ? (
							<time dateTime={d.receivedOn}>{d.receivedOn}</time>
						) : (
							<LocalTime at={d.receivedAt} style="iso-day" />
						),
					// the word sits inside the money cell, because it is a fact about the money; the
					// cell states `noted` so the figure still lines up and the word takes the line under it.
					amount: d.repeating
						? {
								reading: 'noted' as const,
								value: (
									<>
										{d.amount} <StatusWord secondary>Repeating</StatusWord>
									</>
								)
							}
						: d.amount,
					// a grant carries the id the organisation marks it received by in Chariot's
					// dashboard, beside its state. code, because an operator retypes it.
					status: d.trackingId ? (
						<>
							<StatusWord tone={DONATION_STATUS_TONES[d.status]}>
								{DONATION_STATUS_LABELS[d.status]}
							</StatusWord>{' '}
							Tracking ID <code className="adm-code adm-code--unbroken">{d.trackingId}</code>
						</>
					) : (
						<StatusWord tone={DONATION_STATUS_TONES[d.status]}>
							{DONATION_STATUS_LABELS[d.status]}
						</StatusWord>
					),
					// a crypto gift something arrived in carries the coin beside the rail, in the quiet
					// tone `Repeating` takes beside a figure.
					paidWith: d.coinReceived ? (
						<>
							{d.paidWith} <StatusWord secondary>{d.coinReceived}</StatusWord>
						</>
					) : (
						d.paidWith
					),
					// a cell with nothing in it is dashed and set in the muted ink by the table itself,
					// which is why no column below reaches for a fallback.
					source: d.source,
					program: d.program,
					dedication: d.tribute
						? `${TRIBUTE_KIND_LABELS[d.tribute.kind]} ${d.tribute.honoree}`
						: null,
					message: d.note === null ? null : <GiftNote note={d.note} standing={d.noteStanding} />
				}
			}))}
			// a filter that matched nothing is not a deployment with no gifts, and says which it is.
			empty={match === null ? 'No gifts yet.' : 'No gifts match this filter.'}
		/>
	);
}

/**
 * a gift's match in the list's Match cell: the status word, with the employer the donor named in the
 * caption ink on the line under it. a gift predating matching, and a match with no word and nobody
 * named, have nothing to say: `null`, which the table dashes in the muted ink like any empty cell.
 * a value rather than a component for that reason — an element is never `null` to the table.
 */
export function matchCell(match: GiftMatchCell): ReactNode {
	if (match === null || (match.status === null && match.employer === null)) return null;
	const { status, employer } = match;
	const word =
		status === null ? null : (
			<StatusWord tone={MATCH_STATUS_TONES[status]}>{MATCH_STATUS_LABELS[status]}</StatusWord>
		);
	if (employer === null) return word;
	return (
		<>
			{word}
			<span className={word === null ? 'adm-caption' : 'adm-cell__under adm-caption'}>
				{employer}
			</span>
		</>
	);
}

/** the filter's options in the order the select lists them, after Any. */
const FILTER_ORDER = [
	'no_employer',
	'pack_sent',
	'reminded',
	'filed',
	'matched',
	'voided',
	'send_failed'
] as const satisfies readonly MatchFilter[];

/**
 * the Match filter: a native select on the registry's inline size, in a GET form whose only box is
 * `match`. Any is the empty value, and choosing it drops the parameter rather than posting it
 * blank. a choice navigates straight away rather than waiting on a press, and keeps the page where
 * it was, since what changes is the rows under it.
 */
export function MatchFilterSelect({ value }: { readonly value: MatchFilter | null }) {
	const id = useId();
	const submit = useSubmit();
	const choose = (event: ChangeEvent<HTMLSelectElement>) => {
		const chosen = event.currentTarget.value;
		void submit(chosen === '' ? {} : { match: chosen }, {
			method: 'get',
			preventScrollReset: true
		});
	};
	return (
		<Form method="get" className="adm-actions" preventScrollReset>
			<label htmlFor={id}>Match</label>
			<div className="ds-select ds-select-inline">
				{/* keyed by the value the list was read under, so a navigation that changes it (Back, a
				    pasted address) redraws the box holding it rather than the last choice made here. */}
				<select
					key={value ?? ''}
					id={id}
					name="match"
					className="ds-field-input"
					defaultValue={value ?? ''}
					onChange={choose}
				>
					<option value="">Any</option>
					{FILTER_ORDER.map((filter) => (
						<option key={filter} value={filter}>
							{MATCH_FILTER_LABELS[filter]}
						</option>
					))}
				</select>
				{/* the registry's chevron box, around the one mark component the surface draws. */}
				<span className="ds-select-chevron">
					<Mark name="chevron-down" />
				</span>
			</div>
		</Form>
	);
}
