import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef } from 'react';
import { Form, href, Link, useNavigate, useNavigation, useSearchParams } from 'react-router';
import type { Received } from '$lib/admin/received-order';
import { MATCH_STATUS_TONES } from '$lib/admin/status-tones';
import { boxProps, useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { LocalTime } from '$lib/admin/viewer-time.react';
import { formatMinor } from '$lib/donations/money';
import { DONATION_STATUS_LABELS, type DonationStatus } from '$lib/donations/statuses';
import type { FormRejection } from '$lib/forms/definition';
import {
	MARK_FILED_FORM,
	MARK_MATCHED_FORM,
	MATCH_INTENT,
	VOID_MATCH_FORM
} from '$lib/matching/forms';
import { MATCH_STATUS_LABELS, type MatchStatus } from '$lib/matching/status';

// one gift at /admin/donations/{id}, and the employer match on it: what the gift was, where the
// match stands, every stamp on it in order, and the three presses staff run it with. the route
// mounts this over `readStaffMatch` ($lib/server/matching/views.ts) with each instant crossed as an
// ISO string, the rail as its word and each history row's `who` already a name.
//
// the void is confirmed in a dialog held on the address (`?confirm=void`), the way every
// destructive confirm on /admin is, so a refused void comes back with the dialog still up and its
// reason still typed. the trail above the header is the route's `handle`
// ($lib/admin/crumbs.tsx), and this draws none of it.

/** what a stamp on the match is called in its history. */
export type MatchEventKind =
	| 'pack_sent'
	| 'pack_failed'
	| 'reminded'
	| 'filed'
	| 'matched'
	| 'voided';

/** one row of the history, oldest first, as the route hands it over. */
export type MatchHistoryRow = {
	readonly event: MatchEventKind;
	/** who set the stamp, already a name: a staff member's, the donor's, or the app's own. */
	readonly who: string;
	/** the instant, as an ISO string. */
	readonly at: string;
	/** the void's reason, on `voided` alone. */
	readonly reason?: string;
};

/** what the last press on this screen answered with. */
export type GiftMatchResult =
	| { readonly done: 'filed' | 'matched' | 'void' }
	/** the write failed for a reason no box carries. */
	| { readonly error: string }
	/** the void's reason was refused, through `$lib/server/conform.ts`'s `invalid()`. */
	| { readonly form: FormRejection };

export type GiftDetailProps = {
	readonly gift: Received & {
		readonly donorName: string;
		readonly donorEmail: string | null;
		readonly amountMinor: number;
		readonly currency: string;
		/** the rail's word, or `null` on a gift with nothing attempted. */
		readonly paidWith: string | null;
		readonly status: DonationStatus;
		/** when the receipt went, as an ISO string, or `null` where none has. */
		readonly receiptSentAt: string | null;
	};
	/** `null` on a gift recorded before matching, which shows no match card. */
	readonly match: {
		readonly status: MatchStatus | null;
		readonly employer: string | null;
		readonly history: readonly MatchHistoryRow[];
	} | null;
	/** the profile holds no whole mailing address, so donors' pages and mail leave it out. */
	readonly mailingAddressMissing: boolean;
	/** whether this viewer may open Settings ($lib/admin/destinations.ts), where the address is saved. */
	readonly canOpenSettings: boolean;
	readonly result?: GiftMatchResult | undefined;
};

const EVENT_LABELS: Record<MatchEventKind, string> = {
	pack_sent: 'Details emailed to the donor',
	pack_failed: 'Details email could not be sent',
	reminded: 'Reminder sent',
	filed: 'Marked filed',
	matched: 'Marked matched',
	voided: 'Voided'
};

const DONE_WORDS = {
	filed: 'Marked filed',
	matched: 'Marked matched',
	void: 'Match voided'
} as const;

/** the search parameter the void's confirm is held on, and its one value. */
const CONFIRM = 'confirm';
const CONFIRM_VOID = 'void';

export function GiftDetail({
	gift,
	match,
	mailingAddressMissing,
	canOpenSettings,
	result
}: GiftDetailProps) {
	const amount = formatMinor(gift.amountMinor, gift.currency);
	const received =
		'receivedOn' in gift ? (
			<time dateTime={gift.receivedOn}>{gift.receivedOn}</time>
		) : (
			<LocalTime at={gift.receivedAt} style="day" />
		);

	// where focus lands once a press has taken away the control it was made on: Mark filed goes
	// once the gift is filed and the whole footer goes once it is matched or voided. keyed to the
	// answer arriving, so a page opened fresh moves nobody.
	const matchHeading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (result !== undefined && 'done' in result) matchHeading.current?.focus();
	}, [result]);

	const refusal =
		result !== undefined && 'error' in result ? (
			<Banner tone="blocker" word="Not saved">
				<MarkedText text={result.error} />
			</Banner>
		) : null;
	const live = match !== null && match.status !== 'voided' && match.status !== 'matched';
	const [search] = useSearchParams();
	const asking = live && search.get(CONFIRM) === CONFIRM_VOID;
	const navigation = useNavigation();
	const pending = (intent: string) =>
		navigation.state === 'submitting' && navigation.formData?.get(MATCH_INTENT) === intent;

	return (
		// one column, and the column is what spaces it: no block below carries a margin of its own.
		<Column>
			<PageHeader
				title={`${gift.donorName}, ${amount}`}
				standfirst={
					<>
						{received}
						{gift.paidWith === null ? null : ` · ${gift.paidWith}`} ·{' '}
						{DONATION_STATUS_LABELS[gift.status]}
					</>
				}
			/>

			{mailingAddressMissing ? <MissingAddressNotice canOpenSettings={canOpenSettings} /> : null}

			{result !== undefined && 'done' in result ? (
				<Banner tone="note" word={DONE_WORDS[result.done]} />
			) : null}
			{/* a refusal is read inside the dialog while the dialog is up: the page behind a modal is
			    inert, so a banner up here would be behind it. */}
			{asking ? null : refusal}

			<div className="adm-cardpair">
				<section className="ds-card" aria-labelledby="gift-card-title">
					<header className="ds-card-header">
						<h2 id="gift-card-title">Gift</h2>
					</header>
					<div className="ds-card-body adm-record__body">
						<dl>
							<Row label="Donor">{gift.donorName}</Row>
							<Row label="Email">{gift.donorEmail ?? 'None'}</Row>
							<Row label="Amount">
								<span className="adm-num">{amount}</span>
							</Row>
							<Row label="Date">{received}</Row>
							<Row label="Paid with">{gift.paidWith ?? 'None'}</Row>
							<Row label="Receipt">
								{gift.receiptSentAt === null ? (
									'Not sent'
								) : (
									<>
										Sent <LocalTime at={gift.receiptSentAt} style="day" />
									</>
								)}
							</Row>
						</dl>
					</div>
				</section>

				{match === null ? null : (
					<MatchCard match={match} live={live} heading={matchHeading} pending={pending} />
				)}
			</div>

			{/* outside the cards: a card clips what overflows it, and the dialog arrives from the
			    server in the page's flow before it is lifted. */}
			{asking ? (
				<VoidDialog
					pending={pending('void')}
					fallbackFocus={matchHeading}
					refusal={refusal}
					result={result}
				/>
			) : null}
		</Column>
	);
}

/** a label and its value, the house `dl` row. */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="adm-setting">
			<dt className="adm-setting__label">{label}</dt>
			<dd className="adm-setting__value">{children}</dd>
		</div>
	);
}

function MatchCard({
	match,
	live,
	heading,
	pending
}: {
	readonly match: NonNullable<GiftDetailProps['match']>;
	readonly live: boolean;
	readonly heading: RefObject<HTMLHeadingElement | null>;
	/** whether a press carrying this intent is in flight. */
	readonly pending: (intent: string) => boolean;
}) {
	const filed = match.status === 'filed';

	return (
		<section className="ds-card" aria-labelledby="match-card-title">
			{/* the status on the title's first line, the registry's box for a mark beside text that
			    can wrap. */}
			<header className="ds-card-header">
				<h2 id="match-card-title" ref={heading} tabIndex={-1}>
					Employer match
				</h2>
				{match.status === null ? null : (
					<span className="ds-card-status">
						<StatusWord tone={MATCH_STATUS_TONES[match.status]}>
							{MATCH_STATUS_LABELS[match.status]}
						</StatusWord>
					</span>
				)}
			</header>
			<div className="ds-card-body adm-stack">
				<dl>
					<Row label="Employer">{match.employer ?? 'None named'}</Row>
				</dl>
				<h3>History</h3>
				{match.history.length === 0 ? (
					<p className="adm-hint">Nothing has happened on this match yet.</p>
				) : (
					// biome-ignore lint/a11y/noRedundantRoles: ./base.css takes `list-style` off every list, which stops a browser reporting this one as a list.
					<ol role="list">
						{match.history.map((row) => (
							<li className="adm-setting" key={`${row.event}-${row.at}`}>
								<div className="adm-setting__label">
									<div>
										<p>{EVENT_LABELS[row.event]}</p>
										<p className="adm-caption">By {row.who}</p>
										{row.reason === undefined ? null : (
											<p className="adm-caption">Reason: {row.reason}</p>
										)}
									</div>
								</div>
								<div className="adm-setting__value">
									<LocalTime at={row.at} style="moment" />
								</div>
							</li>
						))}
					</ol>
				)}
			</div>
			{/* the presses, while there is a claim left to act on: none once the employer's money
			    arrived or the match was closed. Mark filed goes once it is filed — pressed again it
			    would change nothing. Mark matched stands before filed as well, since staff can see the
			    employer's money before the donor says they filed. */}
			{live ? (
				<footer className="ds-card-footer">
					{filed ? null : (
						<Form method="post">
							<input {...whichForm(MARK_FILED_FORM.id)} />
							<input type="hidden" name={MATCH_INTENT} value="filed" />
							<PendingButton pending={pending('filed')}>Mark filed</PendingButton>
						</Form>
					)}
					<Form method="post">
						<input {...whichForm(MARK_MATCHED_FORM.id)} />
						<input type="hidden" name={MATCH_INTENT} value="matched" />
						<PendingButton variant="primary" pending={pending('matched')}>
							Mark matched
						</PendingButton>
					</Form>
					{/* a link and not a button: it writes nothing, it asks. `preventScrollReset` because
					    the question opens at this same address. */}
					<Button
						as={Link}
						to={`?${CONFIRM}=${CONFIRM_VOID}`}
						preventScrollReset
						variant="danger-outline"
					>
						Void…
					</Button>
				</footer>
			) : null}
		</section>
	);
}

/** a press in flight keeps its focus: held by `aria-disabled` and a refused click, never `disabled`. */
function PendingButton({
	pending,
	variant,
	children
}: {
	readonly pending: boolean;
	readonly variant?: 'primary';
	readonly children: ReactNode;
}) {
	return (
		<Button
			type="submit"
			variant={variant}
			aria-disabled={pending || undefined}
			aria-busy={pending || undefined}
			onClick={(event) => {
				if (pending) event.preventDefault();
			}}
		>
			{children}
		</Button>
	);
}

function VoidDialog({
	pending,
	fallbackFocus,
	refusal,
	result
}: {
	readonly pending: boolean;
	readonly fallbackFocus: RefObject<HTMLHeadingElement | null>;
	readonly refusal: ReactNode;
	readonly result: GiftMatchResult | undefined;
}) {
	const navigate = useNavigate();
	const [form, fields] = useAdminForm(VOID_MATCH_FORM, result);
	// the box by its id, read when the dialog lifts: `Field` takes no ref, and the dialog asks for
	// one only to find the element it puts the focus on.
	const reasonId = fields.reason.id;
	const reason = useMemo(
		() => ({
			get current() {
				return document.getElementById(reasonId);
			}
		}),
		[reasonId]
	);
	const leave = () => navigate('.', { preventScrollReset: true });

	return (
		// the `form` stands around the whole card, never inside its actions row
		// (packages/operator/src/components/shell/Dialog.jsx says why).
		<Form method="post" {...getFormProps(form)}>
			<input {...whichForm(VOID_MATCH_FORM.id)} />
			<input type="hidden" name={MATCH_INTENT} value="void" />
			<Modal
				title="Void this match?"
				danger="Void match"
				dangerProps={{
					type: 'submit',
					'aria-disabled': pending || undefined,
					'aria-busy': pending || undefined,
					onClick: (event) => {
						if (pending) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: '.', preventScrollReset: true }}
				onDismiss={leave}
				initialFocus={reason}
				fallbackFocus={fallbackFocus}
			>
				<p className="adm-prose">
					The donor's gift page will say this request is closed and no more reminders go out. This
					can't be undone.
				</p>
				<Field
					as="textarea"
					label="Reason"
					hint="Only your team sees this."
					required
					{...boxProps(fields.reason)}
				/>
				{refusal}
			</Modal>
		</Form>
	);
}

/**
 * the profile holds no whole mailing address, so the filing details donors are given leave it out.
 * staff who may open Settings are taken there; a member is told who can.
 */
export function MissingAddressNotice({ canOpenSettings }: { readonly canOpenSettings: boolean }) {
	return (
		<Banner
			tone="attention"
			word="Matching details are missing a mailing address"
			body={
				<>
					<p>Donors' gift pages and emails leave the address line out until it's saved.</p>
					{canOpenSettings ? null : (
						<p>Ask whoever runs this server to save the mailing address in Settings.</p>
					)}
				</>
			}
			actions={
				canOpenSettings ? (
					<Button as={Link} to={href('/admin/settings')}>
						Open Settings
					</Button>
				) : undefined
			}
		/>
	);
}
