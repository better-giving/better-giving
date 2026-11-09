import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { EmptyState } from '@better-giving/operator/components/data/EmptyState';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { CONFIRMATION_MS } from '@better-giving/operator/save-state';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { LocalTime } from '$lib/admin/viewer-time.react';

// Public messages at /admin/donations/messages: the notes donors asked to show on the donate page,
// newest first, each with the press that hides it or shows it again. staff and members alike.
//
// the route owns the writes. Hide asks first, in a confirm that opens on Cancel so Enter never hides
// by accident; Show again does not ask, being harmless to undo. a press hands the gift's id to
// `onHide` or `onShow`, `pending` says which press is out, and `outcome` is the answer the route had
// back — which way it landed, or the sentence it was refused with. the rows themselves come from
// the route's read, so a landed press is already drawn in them when its outcome arrives.
//
// a landed press reports at the press, which stays where it is with focus on it: for a moment its
// face is the word that says what happened, then it is the flipped press. a refused Hide is said in
// the confirm, which stays open; a refused Show again is said under its press.

/** a message as the screen lists it: a note a donor asked to show, and whether staff hid it. */
export type ModeratedMessage = {
	/** the gift's id, which a press names. */
	readonly id: string;
	/** what the donate page shows it as: first name and last initial, or "Anonymous". */
	readonly name: string;
	readonly note: string;
	/** ISO 8601. */
	readonly receivedAt: string;
	readonly hidden: boolean;
};

/** the route's answer to the last press: where it landed, or why it was refused. */
export type PressOutcome =
	| { readonly donationId: string; readonly landed: 'hidden' | 'shown' }
	| { readonly donationId: string; readonly refused: string };

export type PublicMessagesProps = {
	/** newest first, at most `limit`. */
	readonly messages: readonly ModeratedMessage[];
	/** every message listed, past the cap too. */
	readonly total: number;
	readonly limit: number;
	/** the press in flight, by the gift it names; null with none. */
	readonly pending: { readonly donationId: string } | null;
	/** the answer to the last press; null before any. */
	readonly outcome: PressOutcome | null;
	readonly onHide: (donationId: string) => void;
	readonly onShow: (donationId: string) => void;
};

const SCREEN_TITLE = 'Public messages';

const STANDFIRST =
	'Notes donors chose to show on your donation page. Hide one and donors stop seeing it right away. The gift and the note stay in your records.';

/** what a landed press says at the press, for the moment before it turns back into one. */
const LANDED_WORDS = { hidden: 'Hidden from your page', shown: 'Showing again' } as const;

/**
 * the columns in the order a row is read. the date is the row's header and what the plane pins:
 * two donors may show as the same name, so the day is what tells one message from another in a
 * list ordered by it. a share is a fact about these five columns, as the gifts list's header says.
 */
const COLUMNS = [
	{ key: 'received', label: 'Date', kind: 'date', width: '14%' },
	{ key: 'name', label: 'Shown as', width: '16%' },
	{ key: 'note', label: 'Message', kind: 'whole', width: '40%' },
	{ key: 'standing', label: 'On the page', width: '14%' },
	{ key: 'press', label: <span className="adm-vh">Action</span>, width: '16%' }
] as const;

export function PublicMessages({
	messages,
	total,
	limit,
	pending,
	outcome,
	onHide,
	onShow
}: PublicMessagesProps) {
	// the confirm, open over one row's message, and the answer standing when it opened, so a refusal
	// from before it is not said inside it.
	const [confirming, setConfirming] = useState<{
		readonly id: string;
		readonly before: PressOutcome | null;
	} | null>(null);
	const [moment, setMoment] = useState<Extract<PressOutcome, { landed: unknown }> | null>(null);
	const [seen, setSeen] = useState(outcome);
	if (outcome !== seen) {
		setSeen(outcome);
		if (outcome !== null && 'landed' in outcome) {
			setMoment(outcome);
			if (confirming?.id === outcome.donationId) setConfirming(null);
		}
	}
	// keyed on the landing that started it, so a second press's moment runs its own length.
	useEffect(() => {
		if (moment === null) return;
		const over = setTimeout(() => setMoment(null), CONFIRMATION_MS);
		return () => clearTimeout(over);
	}, [moment]);

	// the press that opened the confirm, where focus goes back to where the browser recorded none.
	const opener = useRef<HTMLElement | null>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const refusalFor = (id: string) =>
		pending === null && outcome !== null && 'refused' in outcome && outcome.donationId === id
			? outcome.refused
			: null;

	if (messages.length === 0) {
		return (
			<Column wide>
				<PageHeader title={SCREEN_TITLE} />
				<EmptyState>
					No donor has chosen to show a note yet. A note appears here when a donor ticks Show my
					note on the gift form.
				</EmptyState>
			</Column>
		);
	}

	const open = confirming === null ? null : messages.find((m) => m.id === confirming.id);
	const confirmRefusal =
		confirming !== null && outcome !== confirming.before ? refusalFor(confirming.id) : null;

	return (
		<Column wide>
			<PageHeader title={SCREEN_TITLE} standfirst={STANDFIRST} />
			<DataTable
				caption={`${total} ${total === 1 ? 'message' : 'messages'}, newest first.`}
				capNote={total > messages.length ? `Only the most recent ${limit} are shown.` : undefined}
				columns={COLUMNS}
				rows={messages.map((m) => ({
					id: m.id,
					cells: {
						received: <LocalTime at={m.receivedAt} style="iso-day" />,
						name: m.hidden ? <span className="adm-cell__quiet">{m.name}</span> : m.name,
						note: m.hidden ? <span className="adm-cell__quiet">{m.note}</span> : m.note,
						standing: m.hidden ? (
							<StatusWord tone="note">Hidden</StatusWord>
						) : (
							<StatusWord>On the page</StatusWord>
						),
						press: (
							<RowPress
								message={m}
								busy={pending?.donationId === m.id}
								landed={moment?.donationId === m.id ? moment.landed : null}
								refusal={confirming?.id === m.id ? null : refusalFor(m.id)}
								onPress={(target) => {
									if (m.hidden) {
										onShow(m.id);
										return;
									}
									opener.current = target;
									setConfirming({ id: m.id, before: outcome });
								}}
							/>
						)
					}
				}))}
			/>
			{/* what a landed press says, for a reader on the press whose name stays the press's own. */}
			<p className="adm-vh" role="status">
				{moment === null ? '' : LANDED_WORDS[moment.landed]}
			</p>
			{open == null ? null : (
				<HideConfirm
					message={open}
					busy={pending?.donationId === open.id}
					refusal={confirmRefusal}
					cancelRef={cancel}
					openerRef={opener}
					onHide={() => onHide(open.id)}
					onCancel={() => setConfirming(null)}
				/>
			)}
		</Column>
	);
}

function RowPress({
	message,
	busy,
	landed,
	refusal,
	onPress
}: {
	readonly message: ModeratedMessage;
	readonly busy: boolean;
	readonly landed: 'hidden' | 'shown' | null;
	readonly refusal: string | null;
	readonly onPress: (target: HTMLElement) => void;
}) {
	const refusalId = useId();
	const held = busy || landed !== null;
	return (
		<>
			<Button
				type="button"
				variant="quiet"
				size="sm"
				mark={landed !== null ? undefined : message.hidden ? 'eye' : 'eye-off'}
				aria-label={
					message.hidden
						? `Show the message from ${message.name} again`
						: `Hide the message from ${message.name}`
				}
				aria-haspopup={message.hidden ? undefined : 'dialog'}
				aria-busy={busy || undefined}
				aria-disabled={held || undefined}
				aria-describedby={refusal === null ? undefined : refusalId}
				onClick={(event) => {
					if (!held) onPress(event.currentTarget);
				}}
			>
				{landed !== null ? (
					<StatusWord register="momentary">{LANDED_WORDS[landed]}</StatusWord>
				) : message.hidden ? (
					'Show again'
				) : (
					'Hide'
				)}
			</Button>
			{refusal === null ? null : (
				<span className="adm-cell__under" id={refusalId} role="alert">
					<StatusWord register="momentary" blocked mark="circle-alert">
						{refusal}
					</StatusWord>
				</span>
			)}
		</>
	);
}

function HideConfirm({
	message,
	busy,
	refusal,
	cancelRef,
	openerRef,
	onHide,
	onCancel
}: {
	readonly message: ModeratedMessage;
	readonly busy: boolean;
	readonly refusal: string | null;
	readonly cancelRef: RefObject<HTMLButtonElement | null>;
	readonly openerRef: RefObject<HTMLElement | null>;
	readonly onHide: () => void;
	readonly onCancel: () => void;
}) {
	const refusalId = useId();
	return (
		<Modal
			alert
			title="Hide this message?"
			commit="Hide message"
			commitProps={{
				type: 'button',
				'aria-busy': busy || undefined,
				'aria-disabled': busy || undefined,
				'aria-describedby': refusal === null ? undefined : refusalId,
				onClick: () => {
					if (!busy) onHide();
				}
			}}
			cancel="Cancel"
			cancelProps={{ type: 'button', ref: cancelRef, onClick: onCancel }}
			initialFocus={cancelRef}
			fallbackFocus={openerRef}
			onDismiss={onCancel}
		>
			<blockquote className="adm-quote">
				<p>{message.note}</p>
				<p className="adm-quote__by">
					Shown as {message.name} · <LocalTime at={message.receivedAt} style="day" />
				</p>
			</blockquote>
			<p className="adm-prose">
				It stops showing on your donation page right away. The gift and the note stay in your
				records, and you can show it again.
			</p>
			{/* there before it speaks, so the refusal is announced as it arrives. */}
			<p className="adm-dialog__refusal" id={refusalId} role="alert">
				{refusal === null ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{refusal}
					</StatusWord>
				)}
			</p>
		</Modal>
	);
}
