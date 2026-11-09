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
// `onHide` or `onShow`, and each row's press stands as `presses` says: whether it is out, and the
// answer the route had back — which way it landed, or the sentence it was refused with — so a press
// on one row leaves another row's answer standing. without `presses`, one `pending` and one
// `outcome` stand for the whole list. the rows themselves come from the route's read, so a landed
// press is already drawn in them when its outcome arrives.
//
// the route owns the list too: `messages` is every row read so far, the older pages included, so a
// press on an older row is drawn from the same re-read as one on the newest. `older` says whether
// the read has more past them; Show older messages hands `onShowOlder` its cursor. when the last of
// them arrives that press goes, and focus moves from it to the first row it brought.
//
// a landed press reports at the press, which stays where it is with focus on it: for a moment its
// face is the word that says what happened, then it is the flipped press. a refused Hide is said in
// the confirm, which stays open; a refused Show again is said under its press.
//
// a press is named by what it shows, then the row's name and day as their cells write them
// (`aria-labelledby`), so two rows shown as the same name read apart and the name always holds the
// words on the press, the landed ones included.

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

/** one row's press: whether it is out, and the answer to the last one; null before any. */
export type PressState = { readonly pending: boolean; readonly outcome: PressOutcome | null };

export type OlderStatus = 'idle' | 'loading' | 'error';

/** the messages past the ones listed, as the route reads them a page at a time. */
export type OlderMessages = {
	/** the cursor the list ends on; null where nothing is older. */
	readonly next: string | null;
	readonly status: OlderStatus;
	/** asks for the page after `after`, which arrives as more `messages`. */
	readonly onShowOlder: (after: string) => void;
};

export type PublicMessagesProps = {
	/** newest first: every message read so far. */
	readonly messages: readonly ModeratedMessage[];
	/** every message listed, past the ones read too. */
	readonly total: number;
	/** each row's press by the gift it names; a row not in it is at rest. read over `pending` and `outcome`. */
	readonly presses?: Readonly<Record<string, PressState>>;
	/** the press in flight, by the gift it names; null with none. unread where `presses` is given. */
	readonly pending?: { readonly donationId: string } | null;
	/** the answer to the last press; null before any. unread where `presses` is given. */
	readonly outcome?: PressOutcome | null;
	readonly onHide: (donationId: string) => void;
	readonly onShow: (donationId: string) => void;
	/** absent where the route reads no page past the first, which the cap note then says. */
	readonly older?: OlderMessages;
};

const SCREEN_TITLE = 'Public messages';

const STANDFIRST =
	'Notes donors chose to show on your donation page. Hide one and donors stop seeing it right away. The gift and the note stay in your records.';

/** what a landed press says at the press, for the moment before it turns back into one. */
const LANDED_WORDS = { hidden: 'Hidden from your page', shown: 'Showing again' } as const;

type Landed = keyof typeof LANDED_WORDS;

const AT_REST: PressState = { pending: false, outcome: null };

const OLDER_FAILED = 'Couldn’t load older messages. Try again.';

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
	presses,
	pending = null,
	outcome = null,
	onHide,
	onShow,
	older
}: PublicMessagesProps) {
	const pressOf = (id: string): PressState =>
		presses !== undefined
			? (presses[id] ?? AT_REST)
			: {
					pending: pending?.donationId === id,
					// one answer for the whole list stands down while any press is out.
					outcome: pending === null && outcome?.donationId === id ? outcome : null
				};
	const settled = (id: string) => {
		const state = pressOf(id);
		return state.pending ? null : state.outcome;
	};
	const refusalOf = (id: string) => {
		const answer = settled(id);
		return answer !== null && 'refused' in answer ? answer.refused : null;
	};
	const landedOf = (id: string): Landed | null => {
		const answer = settled(id);
		return answer !== null && 'landed' in answer ? answer.landed : null;
	};

	// the confirm, open over one row's message, and whether Hide message was pressed in it, so a
	// refusal from before it opened is not said inside it.
	const [confirming, setConfirming] = useState<{
		readonly id: string;
		readonly pressed: boolean;
	} | null>(null);

	// each row's landing as last drawn, so the one that changed is told apart by its value: the
	// record the route hands down may be a fresh object on every render.
	const landings = Object.fromEntries(
		messages.flatMap((m) => {
			const landed = landedOf(m.id);
			return landed === null ? [] : [[m.id, landed] as const];
		})
	);
	const [seenLandings, setSeenLandings] = useState(landings);
	const [announced, setAnnounced] = useState<{ readonly landed: Landed } | null>(null);
	const fresh = messages.filter(
		(m) => landings[m.id] !== undefined && landings[m.id] !== seenLandings[m.id]
	);
	if (
		fresh.length > 0 ||
		Object.keys(seenLandings).some((id) => landings[id] !== seenLandings[id])
	) {
		setSeenLandings(landings);
		const last = fresh.at(-1);
		if (last !== undefined) setAnnounced({ landed: landings[last.id] as Landed });
		if (confirming !== null && fresh.some((m) => m.id === confirming.id)) setConfirming(null);
	}
	// keyed on the landing that started it, so a second landing's line runs its own length.
	useEffect(() => {
		if (announced === null) return;
		const over = setTimeout(() => setAnnounced(null), CONFIRMATION_MS);
		return () => clearTimeout(over);
	}, [announced]);

	// where the rows Show older messages asked for start, until they arrive.
	const [olderFrom, setOlderFrom] = useState<number | null>(null);
	const [olderArrived, setOlderArrived] = useState<{
		readonly firstId: string;
		readonly last: boolean;
	} | null>(null);
	if (olderFrom !== null && messages.length > olderFrom) {
		setOlderFrom(null);
		setOlderArrived({ firstId: messages[olderFrom]?.id ?? '', last: older?.next === null });
	}

	// the press that opened the confirm, where focus goes back to where the browser recorded none.
	const opener = useRef<HTMLElement | null>(null);
	const ids = useId();
	const cellId = (m: ModeratedMessage | string, cell: 'name' | 'day' | 'press') =>
		`${ids}-${typeof m === 'string' ? m : m.id}-${cell}`;
	const cancel = useRef<HTMLButtonElement>(null);

	// keyed on the arrival that unmounted Show older messages: focus was on it and would otherwise
	// fall to the document. a reader who moved on meanwhile is left be.
	useEffect(() => {
		if (olderArrived === null || !olderArrived.last) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		document.getElementById(cellId(olderArrived.firstId, 'press'))?.focus();
	}, [olderArrived]);

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
	const withheld = older === undefined ? total > messages.length : older.next !== null;

	return (
		<Column wide>
			<PageHeader title={SCREEN_TITLE} standfirst={STANDFIRST} />
			<DataTable
				caption={`${total} ${total === 1 ? 'message' : 'messages'}, newest first.`}
				capNote={withheld ? `Only the most recent ${messages.length} are shown.` : undefined}
				columns={COLUMNS}
				rows={messages.map((m) => ({
					id: m.id,
					cells: {
						received: (
							<span id={cellId(m, 'day')}>
								<LocalTime at={m.receivedAt} style="iso-day" />
							</span>
						),
						name: (
							<span className={m.hidden ? 'adm-cell__quiet' : undefined} id={cellId(m, 'name')}>
								{m.name}
							</span>
						),
						note: m.hidden ? <span className="adm-cell__quiet">{m.note}</span> : m.note,
						standing: m.hidden ? (
							<StatusWord tone="note">Hidden</StatusWord>
						) : (
							<StatusWord>On the page</StatusWord>
						),
						press: (
							<RowPress
								message={m}
								id={cellId(m, 'press')}
								labelledBy={`${ids}-from ${cellId(m, 'name')} ${ids}-received ${cellId(m, 'day')}`}
								busy={pressOf(m.id).pending}
								landed={landedOf(m.id)}
								refusal={confirming?.id === m.id ? null : refusalOf(m.id)}
								onPress={(target) => {
									if (m.hidden) {
										onShow(m.id);
										return;
									}
									opener.current = target;
									setConfirming({ id: m.id, pressed: false });
								}}
							/>
						)
					}
				}))}
			/>
			{older === undefined || older.next === null ? null : (
				<OlderPress
					status={older.status}
					onPress={() => {
						if (older.next === null) return;
						setOlderFrom(messages.length);
						older.onShowOlder(older.next);
					}}
				/>
			)}
			{/* what a landed press says, said aloud: a focused press's name changing is not announced. */}
			<p className="adm-vh" role="status">
				{announced === null ? '' : LANDED_WORDS[announced.landed]}
			</p>
			{/* the words between a press's own and its row's cells, in every press's name. */}
			<span hidden id={`${ids}-from`}>
				the message from
			</span>
			<span hidden id={`${ids}-received`}>
				received
			</span>
			{open == null ? null : (
				<HideConfirm
					message={open}
					busy={pressOf(open.id).pending}
					refusal={confirming?.pressed ? refusalOf(open.id) : null}
					cancelRef={cancel}
					openerRef={opener}
					onHide={() => {
						setConfirming({ id: open.id, pressed: true });
						onHide(open.id);
					}}
					onCancel={() => setConfirming(null)}
				/>
			)}
		</Column>
	);
}

function OlderPress({
	status,
	onPress
}: {
	readonly status: OlderStatus;
	readonly onPress: () => void;
}) {
	const refusalId = useId();
	const loading = status === 'loading';
	const failed = status === 'error';
	return (
		<div className="adm-actions">
			<Button
				type="button"
				aria-busy={loading || undefined}
				aria-disabled={loading || undefined}
				aria-describedby={failed ? refusalId : undefined}
				onClick={() => {
					if (!loading) onPress();
				}}
			>
				{loading ? 'Loading' : 'Show older messages'}
			</Button>
			{/* there before it speaks, so a failure is announced as it arrives. */}
			<span id={refusalId} role="alert">
				{failed ? (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{OLDER_FAILED}
					</StatusWord>
				) : null}
			</span>
		</div>
	);
}

function RowPress({
	message,
	id,
	labelledBy,
	busy,
	landed,
	refusal,
	onPress
}: {
	readonly message: ModeratedMessage;
	readonly id: string;
	/** the ids after the press's own that its name reads: the row's name and day, as `aria-labelledby`. */
	readonly labelledBy: string;
	readonly busy: boolean;
	/** which way this row's last press landed, standing until its next press goes out. */
	readonly landed: Landed | null;
	readonly refusal: string | null;
	readonly onPress: (target: HTMLElement) => void;
}) {
	const refusalId = useId();
	// the press's face says a landing for a moment, keyed on the landing that changed: rows land on
	// their own, so each runs its own moment.
	const [moment, setMoment] = useState<Landed | null>(null);
	const [seen, setSeen] = useState(landed);
	if (landed !== seen) {
		setSeen(landed);
		if (landed !== null) setMoment(landed);
	}
	useEffect(() => {
		if (moment === null) return;
		const over = setTimeout(() => setMoment(null), CONFIRMATION_MS);
		return () => clearTimeout(over);
	}, [moment]);
	const held = busy || moment !== null;
	return (
		<>
			<Button
				type="button"
				variant="quiet"
				size="sm"
				className={moment !== null ? 'adm-saidpress' : undefined}
				mark={moment !== null ? undefined : message.hidden ? 'eye' : 'eye-off'}
				id={id}
				aria-labelledby={`${id} ${labelledBy}`}
				aria-haspopup={message.hidden ? undefined : 'dialog'}
				aria-busy={busy || undefined}
				aria-disabled={held || undefined}
				aria-describedby={refusal === null ? undefined : refusalId}
				onClick={(event) => {
					if (!held) onPress(event.currentTarget);
				}}
			>
				{moment !== null ? (
					<StatusWord register="momentary">{LANDED_WORDS[moment]}</StatusWord>
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
			<p className="adm-dialog__refusal adm-dialog__refusal--ink" id={refusalId} role="alert">
				{refusal === null ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{refusal}
					</StatusWord>
				)}
			</p>
		</Modal>
	);
}
