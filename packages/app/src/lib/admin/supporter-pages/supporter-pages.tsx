import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { PageHeading } from '@better-giving/operator/components/shell/PageHeading';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { CONFIRMATION_MS } from '@better-giving/operator/save-state';
import { useSaveState } from '@better-giving/operator/save-state.react';
import {
	type ChangeEvent,
	type FormEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';
import { href } from 'react-router';
import { buttonState } from '$lib/admin/save-button-state';
import { whichForm } from '$lib/admin/use-admin-form';
import { formatMinor } from '$lib/donations/money';
import { SUPPORTER_HIDE_INPUT } from '$lib/supporters/input';

// Supporter pages at /admin/supporter-pages: the organisation setting that lets supporters start
// fundraisers, then every supporter's page, newest first, each with Open and Hide or Show again.
//
// the route owns the reads and the writes. every write is a real `<form method="post">` carrying
// its form's id in the `whichForm` box (`SUPPORTER_PAGES_FORMS`, read by `submittedForm` in
// $lib/server/conform.ts), so the body a callback is handed is the body a browser would post
// without script; the callback is where the route hands it to a fetcher.
//
// the setting is the deployer's (AGENTS.md → Boundaries): a member is drawn the same switch,
// disabled, with the reason as its hint, and no Save. it is read on Save and never applied on a
// flip, which is the registry's own contract for the switch (switch-css.usage.md → Accessibility).
//
// Hide asks first, in a confirm that opens on Cancel so Enter never hides by accident, with an
// optional note the supporter is shown word for word; Show again does not ask, being harmless to
// undo. a landed press reports at the press, which keeps focus: for a moment its face is the words
// saying what happened, then it is the flipped press. a refused Hide is said in the confirm, which
// stays open; a refused Show again is said under its press. the rows come from the route's re-read,
// so a landed press is already drawn in them when its outcome arrives.
//
// the list comes a batch at a time, newest first: the route's read hands down the first batch,
// how many pages there are in all and the cursor past it, and Show more pages under the table asks
// `onShowMore` for the batch after the last one held. a re-read after a press redraws the first
// batch from it and keeps every row held past it, each page once, so a press never takes away what
// Show more pages brought; the rows the re-read does not reach are drawn with the way their own
// last press landed (`withLanding`). a press out is `aria-disabled` and refuses itself rather than
// `disabled`, so it keeps the keyboard. when the last batch takes the press away, focus goes to the
// press in the first row it brought rather than to the page.
//
// the empty list is the registry's state card (state-card-css.usage.md), titled by what the setting
// is, since with fundraisers off no list can start.

/** the name of the hidden box a row's form names its page in. */
export const PAGE_ID_FIELD = 'page_id';

/** the id each form on this screen posts in its `whichForm` box. */
export const SUPPORTER_PAGES_FORMS = {
	saveSetting: 'supporter-setting',
	hide: 'supporter-page-hide',
	show: 'supporter-page-show'
} as const;

/** where a supporter's page stands on its own lifecycle, as the server lists it. */
export type SupporterPageLifecycle = 'pending' | 'live' | 'ended';

/** one supporter's page as the list shows it. money in minor units of `currency`. */
export type SupporterPageRow = {
	/** the page's id, which a press names. */
	readonly id: string;
	readonly supporterName: string;
	/** shown to staff alone; the public never sees it. */
	readonly supporterEmail: string;
	readonly title: string;
	/** the page's public address as the row prints it, `/f/<slug>`. */
	readonly address: string;
	/** where Open goes: the public page, or the staff preview for a page that is hidden. */
	readonly openHref: string;
	readonly goalMinor: number;
	readonly raisedMinor: number;
	readonly currency: string;
	readonly status: SupporterPageLifecycle;
	readonly hidden: boolean;
};

/** the organisation setting, as the deployer or a member is shown it. */
export type SupporterSetting = {
	/** the stored value. */
	readonly enabled: boolean;
	/** whether this session may change it: the `STAFF_USER_ID` gate. */
	readonly mayChange: boolean;
	/** whether a save is in flight. */
	readonly pending: boolean;
	/** whether the last save landed and nothing has answered since. */
	readonly saved: boolean;
	/** the sentence the last save was refused with; null with none. */
	readonly refused: string | null;
};

/** the route's answer to a row's last press: which way it landed, or why it was refused. */
export type RowOutcome = { readonly landed: 'hidden' | 'shown' } | { readonly refused: string };

/** one row's press: whether it is out, and the answer to the last one; null before any. */
export type RowPress = { readonly pending: boolean; readonly outcome: RowOutcome | null };

/** the batch of pages after a cursor, how many there are in all, and the cursor past it. */
export type SupporterPageBatch = {
	readonly pages: readonly SupporterPageRow[];
	readonly total: number;
	/** null where it ends on the oldest page. */
	readonly next: string | null;
};

export type SupporterPagesProps = {
	/** the organisation's name, as the standfirst says it. */
	readonly orgName: string;
	readonly setting: SupporterSetting;
	/** newest first: the first batch. */
	readonly pages: readonly SupporterPageRow[];
	/** every supporter's page, listed or not. */
	readonly total: number;
	/** the cursor past `pages`, null where they are every page. */
	readonly next: string | null;
	/** Show more pages: the batch after `after`, or null where it could not be read. */
	readonly onShowMore: (after: string) => Promise<SupporterPageBatch | null>;
	/** each row's press by the page it names; a row not in it is at rest. */
	readonly presses?: Readonly<Record<string, RowPress>>;
	/** the setting form's body: its id, and `enabled=on` when on. */
	readonly onSaveSetting: (body: FormData) => void;
	/** a Hide confirmed: its form's id, `page_id`, and `note` (blank for none). */
	readonly onHide: (pageId: string, body: FormData) => void;
	/** Show again: its form's id and `page_id`. */
	readonly onShow: (pageId: string, body: FormData) => void;
};

const SCREEN_TITLE = 'Supporter pages';

const SWITCH_LABEL = 'Let supporters start fundraisers';
const SWITCH_HINT =
	'Adds a Start a fundraiser card to your Donation page and campaigns, and opens /fundraise. Turning it off stops new pages. Pages already live stay live.';
const NOT_YOURS = 'Only whoever runs this server can change this.';
const MORE_FAILED = 'Couldn’t load more pages. Try again.';

/** what a landed press says at the press, for the moment before it turns back into one. */
const LANDED_WORDS = { hidden: 'Hidden from visitors', shown: 'Showing again' } as const;
type Landed = keyof typeof LANDED_WORDS;

const AT_REST: RowPress = { pending: false, outcome: null };

const STATUS_WORDS = { pending: 'Pending', live: 'Live', ended: 'Ended' } as const;

/**
 * a row past the route's re-read as its last landed press left it: hidden, Open goes to the staff
 * preview as `listedRow` in $lib/server/supporters/admin.ts sends a hidden page's; shown again, it
 * is the row as it was read, whose Open is the preview where it was read hidden, which draws a
 * page in any state (../../../routes/admin.supporter-pages.$id.preview.tsx).
 */
function withLanding(page: SupporterPageRow, landed: Landed | undefined): SupporterPageRow {
	if (landed === 'hidden') {
		return {
			...page,
			hidden: true,
			openHref: href('/admin/supporter-pages/:id/preview', { id: page.id })
		};
	}
	return landed === 'shown' ? { ...page, hidden: false } : page;
}

/**
 * the columns in the order a row is read. the supporter is the row's header and what the plane
 * pins. a share is a fact about these six columns, as DataTable's `width` says.
 */
const COLUMNS = [
	{ key: 'supporter', label: 'Supporter', width: '20%' },
	{ key: 'page', label: 'Page', width: '30%' },
	{ key: 'goal', label: 'Goal', kind: 'money', width: '10%' },
	{ key: 'raised', label: 'Raised', kind: 'money', width: '10%' },
	{ key: 'status', label: 'Status', width: '10%' },
	{ key: 'actions', label: <span className="adm-vh">Actions</span>, width: '20%' }
] as const;

export function SupporterPages({
	orgName,
	setting,
	pages: firstBatch,
	total,
	next,
	presses = {},
	onSaveSetting,
	onHide,
	onShow,
	onShowMore
}: SupporterPagesProps) {
	// every row Show more pages brought, after the first batch as it stood when the first was asked
	// for, so a row a re-read's first batch no longer reaches stays listed.
	const [paged, setPaged] = useState<SupporterPageBatch | null>(null);
	const [asking, setAsking] = useState<'idle' | 'loading' | 'failed'>('idle');
	// how each row last landed, wherever it stood when it did: a row a later re-read pushes past its
	// first batch is drawn from `paged`, which the re-read cannot redraw.
	const [heldLandings, setHeldLandings] = useState<Readonly<Record<string, Landed>>>({});
	const firstIds = new Set(firstBatch.map((p) => p.id));
	const pages =
		paged === null
			? firstBatch
			: [
					...firstBatch,
					...paged.pages
						.filter((p) => !firstIds.has(p.id))
						.map((p) => withLanding(p, heldLandings[p.id]))
				];
	// the re-read and the last batch each answer a total, and either may be the newer. neither is a
	// floor for the rows shown, which keep a row the sweep in $lib/server/supporters/sweep.ts deleted
	// since it was read.
	const counted = paged === null ? total : Math.max(total, paged.total, pages.length);
	const cursor = paged === null ? next : paged.next;
	// the first row the batch that took Show more pages away brought, its press where focus goes.
	const [arrived, setArrived] = useState<{ readonly firstId: string } | null>(null);
	const showMore = async () => {
		if (asking === 'loading' || cursor === null) return;
		setAsking('loading');
		const batch = await onShowMore(cursor);
		if (batch === null) {
			setAsking('failed');
			return;
		}
		setPaged((was) => ({
			pages: [...(was?.pages ?? firstBatch), ...batch.pages],
			total: batch.total,
			next: batch.next
		}));
		setAsking('idle');
		const first = batch.pages[0];
		if (batch.next === null && first !== undefined) setArrived({ firstId: first.id });
	};
	const pressOf = (id: string): RowPress => presses[id] ?? AT_REST;
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

	// the confirm, open over one row's page, and whether Hide page was pressed in it, so a refusal
	// from before it opened is not said inside it. it stands only over a page still shown: the
	// re-read after a landed Hide draws the row hidden, and that is what takes the confirm down.
	const [confirming, setConfirming] = useState<{
		readonly id: string;
		readonly pressed: boolean;
	} | null>(null);
	const open =
		confirming === null ? undefined : pages.find((p) => p.id === confirming.id && !p.hidden);
	if (confirming !== null && open === undefined) setConfirming(null);

	// each row's landing as last drawn, so the one that changed is told apart by its value: the
	// record the route hands down may be a fresh object on every render. the last one is said
	// aloud, since a focused press's own words changing is announced to nobody.
	const landings = Object.fromEntries(
		pages.flatMap((p) => {
			const landed = landedOf(p.id);
			return landed === null ? [] : [[p.id, landed] as const];
		})
	);
	const [seenLandings, setSeenLandings] = useState(landings);
	const [announced, setAnnounced] = useState<{ readonly landed: Landed } | null>(null);
	const fresh = pages.filter(
		(p) => landings[p.id] !== undefined && landings[p.id] !== seenLandings[p.id]
	);
	if (
		fresh.length > 0 ||
		Object.keys(seenLandings).some((id) => landings[id] !== seenLandings[id])
	) {
		setSeenLandings(landings);
		if (fresh.length > 0) {
			setHeldLandings((held) => ({
				...held,
				...Object.fromEntries(fresh.map((p) => [p.id, landings[p.id] as Landed]))
			}));
		}
		const last = fresh.at(-1);
		if (last !== undefined) setAnnounced({ landed: landings[last.id] as Landed });
	}
	useEffect(() => {
		if (announced === null) return;
		const over = setTimeout(() => setAnnounced(null), CONFIRMATION_MS);
		return () => clearTimeout(over);
	}, [announced]);

	const cancel = useRef<HTMLButtonElement>(null);
	const ids = useId();
	const newTab = `${ids}-new-tab`;
	const pressIdOf = (id: string) => `${ids}-${id}-press`;

	// keyed on the arrival that took Show more pages away: focus was on it and would otherwise fall
	// to the document.
	useEffect(() => {
		if (arrived !== null) document.getElementById(pressIdOf(arrived.firstId))?.focus();
	}, [arrived]);

	const standfirst = `Fundraisers your supporters started for ${orgName}. Hide one that shouldn’t be public, and show it again if you change your mind. The gifts and the supporter’s own page stay either way.`;

	return (
		<Column wide>
			<PageHeading title={SCREEN_TITLE} />
			<p className="adm-hint">{standfirst}</p>
			<SettingCard setting={setting} onSave={onSaveSetting} />
			{pages.length === 0 ? (
				<EmptyCard enabled={setting.enabled} mayChange={setting.mayChange} />
			) : (
				<DataTable
					caption={`${counted} supporter ${counted === 1 ? 'page' : 'pages'}, newest first.`}
					columns={COLUMNS}
					rows={pages.map((p) => ({
						id: p.id,
						cells: {
							supporter: (
								<>
									{p.supporterName}
									<span className="adm-cell__under adm-cell__quiet">{p.supporterEmail}</span>
								</>
							),
							page: (
								<>
									<span id={`${ids}-${p.id}-title`}>{p.title}</span>
									<span className="adm-cell__under adm-cell__quiet">{p.address}</span>
								</>
							),
							goal: formatMinor(p.goalMinor, p.currency),
							raised: formatMinor(p.raisedMinor, p.currency),
							status: <PageStatus page={p} />,
							actions: (
								<RowActions
									page={p}
									titleId={`${ids}-${p.id}-title`}
									pressId={pressIdOf(p.id)}
									newTabId={newTab}
									busy={pressOf(p.id).pending}
									landed={landedOf(p.id)}
									refusal={confirming?.id === p.id ? null : refusalOf(p.id)}
									onHidePress={() => setConfirming({ id: p.id, pressed: false })}
									onShow={(body) => onShow(p.id, body)}
								/>
							)
						}
					}))}
				/>
			)}
			{pages.length === 0 || (cursor === null && paged === null) ? null : (
				<MorePages
					showing={pages.length}
					total={counted}
					more={cursor !== null}
					asking={asking}
					onPress={showMore}
				/>
			)}
			<p className="adm-vh" role="status">
				{announced === null ? '' : LANDED_WORDS[announced.landed]}
			</p>
			<span hidden id={newTab}>
				in a new tab
			</span>
			{open === undefined ? null : (
				<HideConfirm
					page={open}
					busy={pressOf(open.id).pending}
					refusal={confirming?.pressed ? refusalOf(open.id) : null}
					cancelRef={cancel}
					rowPress={pressIdOf(open.id)}
					onHide={(body) => {
						setConfirming({ id: open.id, pressed: true });
						onHide(open.id, body);
					}}
					onCancel={() => setConfirming(null)}
				/>
			)}
		</Column>
	);
}

/** Show more pages beside how many are shown; once every page is, the count alone. */
function MorePages({
	showing,
	total,
	more,
	asking,
	onPress
}: {
	readonly showing: number;
	readonly total: number;
	readonly more: boolean;
	readonly asking: 'idle' | 'loading' | 'failed';
	readonly onPress: () => void;
}) {
	const failureId = useId();
	const loading = asking === 'loading';
	const failed = asking === 'failed';
	return (
		<div className="adm-actions">
			{more ? (
				<Button
					type="button"
					size="sm"
					aria-busy={loading || undefined}
					aria-disabled={loading || undefined}
					aria-describedby={failed ? failureId : undefined}
					onClick={onPress}
				>
					Show more pages
				</Button>
			) : null}
			<p className="adm-caption" role="status">
				{`Showing ${showing} of ${total} ${total === 1 ? 'page' : 'pages'}`}
			</p>
			{/* there before it speaks, so a failure is announced as it arrives. */}
			<span id={failureId} role="alert">
				{failed ? (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{MORE_FAILED}
					</StatusWord>
				) : null}
			</span>
		</div>
	);
}

/** a hidden page reads Hidden whatever its lifecycle, since that is what a visitor gets. */
function PageStatus({ page }: { readonly page: SupporterPageRow }) {
	if (page.hidden) return <StatusWord tone="attention">Hidden</StatusWord>;
	if (page.status === 'live') return <StatusWord tone="done">{STATUS_WORDS.live}</StatusWord>;
	if (page.status === 'ended') return <StatusWord tone="note">{STATUS_WORDS.ended}</StatusWord>;
	return <StatusWord>{STATUS_WORDS.pending}</StatusWord>;
}

function SettingCard({
	setting,
	onSave
}: {
	readonly setting: SupporterSetting;
	readonly onSave: (body: FormData) => void;
}) {
	const ids = useId();
	const headingId = `${ids}-heading`;
	const labelId = `${ids}-label`;
	const hintId = `${ids}-hint`;
	const refusalId = `${ids}-refusal`;

	// the flip is held here until Save, and taken back to the stored value whenever that changes:
	// a landed save, or another session's.
	const [checked, setChecked] = useState(setting.enabled);
	const [stored, setStored] = useState(setting.enabled);
	if (stored !== setting.enabled) {
		setStored(setting.enabled);
		setChecked(setting.enabled);
	}
	const save = useSaveState({
		landed: setting.saved,
		changed: checked !== setting.enabled,
		pending: setting.pending
	});

	const row = (
		<label className="ds-switch-field">
			<span className="ds-switch-text">
				<span className="ds-switch-label" id={labelId}>
					{SWITCH_LABEL}
				</span>
				<span className="ds-switch-hint" id={hintId}>
					{setting.mayChange ? SWITCH_HINT : `${setting.enabled ? 'On' : 'Off'}. ${NOT_YOURS}`}
				</span>
			</span>
			<input
				type="checkbox"
				// biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox carries its checked state itself, and the registry's switch writes no `aria-checked` (switch-css.usage.md).
				role="switch"
				className="ds-switch"
				name="enabled"
				aria-labelledby={labelId}
				aria-describedby={hintId}
				checked={setting.mayChange ? checked : setting.enabled}
				disabled={!setting.mayChange}
				onChange={(event) => setChecked(event.currentTarget.checked)}
			/>
		</label>
	);

	if (!setting.mayChange) {
		return (
			<Section card>
				<h2 id={headingId}>Start a fundraiser</h2>
				{row}
			</Section>
		);
	}

	return (
		<form
			method="post"
			aria-labelledby={headingId}
			onSubmit={(event: FormEvent<HTMLFormElement>) => {
				event.preventDefault();
				onSave(new FormData(event.currentTarget));
			}}
		>
			<input {...whichForm(SUPPORTER_PAGES_FORMS.saveSetting)} />
			<Section card>
				<h2 id={headingId}>Start a fundraiser</h2>
				{row}
				<div className="adm-actions">
					<SaveButton
						state={buttonState(save)}
						elsewhere=""
						aria-describedby={setting.refused === null ? undefined : refusalId}
					/>
					{/* there before it speaks, so a refusal is announced as it arrives. */}
					<span id={refusalId} role="alert">
						{setting.refused === null || setting.pending ? null : (
							<StatusWord register="momentary" blocked mark="circle-alert">
								{setting.refused}
							</StatusWord>
						)}
					</span>
				</div>
			</Section>
		</form>
	);
}

/** no list yet: why, by what the setting is. a member cannot turn it on, so is told no way to. */
function EmptyCard({
	enabled,
	mayChange
}: {
	readonly enabled: boolean;
	readonly mayChange: boolean;
}) {
	const titleId = useId();
	return (
		<section className="ds-state-card" aria-labelledby={titleId}>
			<h2 className="ds-state-card-title" id={titleId}>
				{enabled ? 'No supporter pages yet' : 'Supporter fundraisers are off'}
			</h2>
			{enabled ? (
				<p className="ds-state-card-body">
					Pages show here as soon as a supporter confirms their email.
				</p>
			) : mayChange ? (
				<p className="ds-state-card-body">
					Turn them on above to add a Start a fundraiser card to your Donation page.
				</p>
			) : null}
		</section>
	);
}

function RowActions({
	page,
	titleId,
	pressId,
	newTabId,
	busy,
	landed,
	refusal,
	onHidePress,
	onShow
}: {
	readonly page: SupporterPageRow;
	/** the id of the page title's cell text, which every press here is named after. */
	readonly titleId: string;
	/** the id this row's Hide or Show again is drawn under, whichever of the two stands. */
	readonly pressId: string;
	readonly newTabId: string;
	readonly busy: boolean;
	/** which way this row's last press landed, standing until its next press goes out. */
	readonly landed: Landed | null;
	readonly refusal: string | null;
	readonly onHidePress: () => void;
	readonly onShow: (body: FormData) => void;
}) {
	const ids = useId();
	const openId = `${ids}-open`;
	const refusalId = `${ids}-refusal`;
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
	const face =
		moment !== null ? (
			<StatusWord register="momentary">{LANDED_WORDS[moment]}</StatusWord>
		) : page.hidden ? (
			'Show again'
		) : (
			'Hide'
		);
	const pressProps = {
		size: 'sm',
		className: moment !== null ? 'adm-saidpress' : undefined,
		mark: moment !== null ? undefined : page.hidden ? 'eye' : 'eye-off',
		id: pressId,
		'aria-labelledby': `${pressId} ${titleId}`,
		'aria-busy': busy || undefined,
		'aria-disabled': held || undefined,
		'aria-describedby': refusal === null ? undefined : refusalId
	} as const;
	return (
		<>
			<div className="adm-actions">
				<Button
					as="a"
					href={page.openHref}
					target="_blank"
					rel="noopener"
					variant="quiet"
					size="sm"
					markAfter="external-link"
					id={openId}
					aria-labelledby={`${openId} ${titleId} ${newTabId}`}
				>
					Open
				</Button>
				{page.hidden ? (
					<form
						method="post"
						onSubmit={(event: FormEvent<HTMLFormElement>) => {
							event.preventDefault();
							if (!held) onShow(new FormData(event.currentTarget));
						}}
					>
						<input {...whichForm(SUPPORTER_PAGES_FORMS.show)} />
						<input type="hidden" name={PAGE_ID_FIELD} value={page.id} />
						<Button type="submit" {...pressProps}>
							{face}
						</Button>
					</form>
				) : (
					<Button
						type="button"
						aria-haspopup="dialog"
						{...pressProps}
						onClick={() => {
							if (!held) onHidePress();
						}}
					>
						{face}
					</Button>
				)}
			</div>
			{/* there before it speaks, so the refusal is announced as it arrives; it takes its place
			    under the presses only once it holds one. */}
			<span
				className={refusal === null ? undefined : 'adm-cell__under'}
				id={refusalId}
				role="alert"
			>
				{refusal === null ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{refusal}
					</StatusWord>
				)}
			</span>
		</>
	);
}

function HideConfirm({
	page,
	busy,
	refusal,
	cancelRef,
	rowPress,
	onHide,
	onCancel
}: {
	readonly page: SupporterPageRow;
	readonly busy: boolean;
	readonly refusal: string | null;
	readonly cancelRef: RefObject<HTMLButtonElement | null>;
	/**
	 * the id of the row's Hide or Show again. a landed Hide redraws that row with Show again in Hide's
	 * place, so the press that opened this is gone when it comes down, and focus goes to the one
	 * standing under the same id then.
	 */
	readonly rowPress: string;
	readonly onHide: (body: FormData) => void;
	readonly onCancel: () => void;
}) {
	const ids = useId();
	const noteId = `${ids}-note`;
	const refusalId = `${ids}-refusal`;
	const [note, setNote] = useState('');
	// the note's rule is checked first on Hide page, then on every change once it has failed.
	const [checked, setChecked] = useState(false);
	const problem = (value: string) => {
		const read = SUPPORTER_HIDE_INPUT.safeParse({ note: value });
		return read.success ? null : (read.error.issues[0]?.message ?? null);
	};
	const error = checked ? problem(note) : null;
	// read by the Modal as the card comes down, so it is whichever press stands in the row by then.
	const rowPressNow = {
		get current() {
			return document.getElementById(rowPress);
		}
	};
	return (
		<form
			method="post"
			noValidate
			onSubmit={(event: FormEvent<HTMLFormElement>) => {
				event.preventDefault();
				if (busy) return;
				setChecked(true);
				if (problem(note) !== null) {
					document.getElementById(noteId)?.focus();
					return;
				}
				onHide(new FormData(event.currentTarget));
			}}
		>
			<input {...whichForm(SUPPORTER_PAGES_FORMS.hide)} />
			<input type="hidden" name={PAGE_ID_FIELD} value={page.id} />
			<Modal
				alert
				title="Hide this page?"
				commit="Hide page"
				commitProps={{
					type: 'submit',
					'aria-busy': busy || undefined,
					'aria-disabled': busy || undefined,
					'aria-describedby': refusal === null ? undefined : refusalId
				}}
				cancel="Cancel"
				cancelProps={{ type: 'button', ref: cancelRef, onClick: onCancel }}
				initialFocus={cancelRef}
				fallbackFocus={rowPressNow}
				onDismiss={onCancel}
			>
				<blockquote className="adm-quote">
					<p>{page.title}</p>
					<p className="adm-quote__by">
						{page.supporterName} · {formatMinor(page.raisedMinor, page.currency)} raised
					</p>
				</blockquote>
				<p className="adm-prose">
					Visitors get the same page a mistyped address gets, and it stops taking gifts. The gifts
					already given stay in your records, and {page.supporterName} can still see the page.
				</p>
				<Field
					as="textarea"
					id={noteId}
					name="note"
					label="Note for the supporter"
					optional
					placeholder="Please replace the photo."
					value={note}
					error={error}
					onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
						setNote(event.currentTarget.value)
					}
				/>
				{/* there before it speaks, so the refusal is announced as it arrives. */}
				<p className="adm-dialog__refusal adm-dialog__refusal--ink" id={refusalId} role="alert">
					{refusal === null ? null : (
						<StatusWord register="momentary" blocked mark="circle-alert">
							{refusal}
						</StatusWord>
					)}
				</p>
			</Modal>
		</form>
	);
}
