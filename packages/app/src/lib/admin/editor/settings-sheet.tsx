import { Button } from '@better-giving/operator/components/controls/Button';
import { Menu } from '@better-giving/operator/components/controls/Menu';
import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { formatMinorBrief } from '$lib/donations/money';
import { dayWords } from '$lib/page/end-date';
import { RemoveBlockConfirm } from './confirms';
import { PickRefusal, PicturePicker, type PictureOption } from './pictures';

// the Settings sheet: everything about a page, one list. rows that hold a typed value open a sheet of
// their own stacked over this one (./done-sheet.tsx argues their one Done); the layout pictures, the
// look, the share buttons and the block list's presses apply the moment they are made, here, with
// nothing to finish. a refused layout pick is reported at the foot of its part, in a region there
// whenever the part is; a refused look or share pick is the refusal of the group it was made in,
// which is marked invalid and described by it; and the part draws what the draft holds again. while
// any of the sheet's presses is in flight its head says a change is being saved.
//
// the block list is the keyboard's way to a block: a click on a block in the preview while Edit is
// on opens the same block's sheet (./preview-frame.tsx), and a row here is that click for a reader
// who cannot point. handed `edits`, each row also moves its block a step and takes it off the page,
// offering only what that block can do — the first has no Move up, the donation box no Remove —
// and Add a block under the list offers the blocks the page may be given. a row's presses are named
// for the block and its place, `Move Story up, 2 of 5`, since a page may hold two of one kind. Remove
// asks first, on a card naming the block, because what the block holds goes with it. a landed press
// keeps the focus on the list — on the moved block's press, or on the row that took a removed
// block's place — and says what it did in the list's one region, `Story moved up, 2 of 5`; a
// refused one says its refusal under the row it was pressed on, and the press is described by it.
//
// the look is three questions answered by chips: a shade or a palette drawn as a picture here would
// be the donor page's colours drawn on an operator screen, and the preview beside the sheet shows
// the page wearing the pick as soon as it lands. the share buttons are chips too.
//
// a campaign carries its name, address, goal and end date; the Donation page has none of the four.
//
// every group is the caller's to leave out, and a group left out is not drawn: no heading over
// nothing, no row that opens nothing. a group's value and its handler arrive together or not at
// all, and the rows that open a sheet of their own take `onOpen` as soon as one of them is drawn.

/** a row that opens a sheet of its own. */
export type SettingsRow =
	| 'name'
	| 'address'
	| 'goal'
	| 'end-date'
	| 'share-message'
	| 'donation-settings';

type OpenRowProps = {
	/** for a caller that moves the focus to the row. */
	readonly id?: string | undefined;
	readonly label: string;
	/** what the row holds now, as a reader would say it. */
	readonly value: ReactNode;
	/** the value is a stand-in for nothing set here. */
	readonly unset?: boolean;
	readonly onOpen: () => void;
};

function OpenRow({ id, label, value, unset = false, onOpen }: OpenRowProps) {
	return (
		<button id={id} type="button" className="adm-openrow" aria-haspopup="dialog" onClick={onOpen}>
			<span className="adm-openrow__label">{label}</span>
			<span
				className={unset ? 'adm-openrow__value adm-openrow__value--unset' : 'adm-openrow__value'}
			>
				{value}
			</span>
			<Mark name="chevron-right" />
		</button>
	);
}

function Part({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
	return (
		<section className="adm-sheetpart">
			{title ? <h3>{title}</h3> : null}
			{children}
		</section>
	);
}

/** one block on the page, in the page's order. */
export type BlockRow = {
	readonly id: string;
	/** the block's name — Title, Story, Donation box. */
	readonly label: string;
	/** a line of what it holds, or `''` for a block that holds nothing typed. */
	readonly summary: string;
	/** whether a block stands above it, and below it, for a move to swap it with. */
	readonly movesUp?: boolean | undefined;
	readonly movesDown?: boolean | undefined;
	/** false for the donation box, which every page holds once. */
	readonly removable?: boolean | undefined;
};

type Direction = 'up' | 'down';

/** the block list's own presses, which apply at once. */
export type BlockEdits = {
	readonly onMove: (id: string, direction: Direction) => void;
	readonly onRemove: (id: string) => void;
	/** the blocks the page may be given, as Add a block offers them. */
	readonly addable: readonly PictureOption[];
	readonly onAdd: (type: string) => void;
	/** a press of the sheet's is in flight: the list's presses hold until it is answered. */
	readonly busy: boolean;
	/** the last press's refusal. */
	readonly refusal?: string | null | undefined;
};

type BlockListProps = {
	readonly blocks: readonly BlockRow[];
	/** a block's row was pressed: open that block's sheet. */
	readonly onOpenBlock: (id: string) => void;
	/** absent, the rows only open their blocks. */
	readonly edits?: BlockEdits | undefined;
};

/** a press of the list's that is waiting on its answer, and whether it has gone out yet. */
type Pressed = {
	/** the block pressed on, or `''` for Add a block. */
	readonly id: string;
	readonly label: string;
	readonly act: Direction | 'remove' | 'add';
	/** where the block stood when it was pressed. */
	readonly at: number;
	readonly sent: boolean;
};

/** the place a block stands in, as its row's presses and the list's region say it. */
const place = (at: number, of: number) => `${at + 1} of ${of}`;

/** what a landed press did, in the words the list's region says it in. */
function outcome(blocks: readonly BlockRow[], { id, label, act }: Pressed): string {
	if (act === 'add') return '';
	const now = blocks.findIndex((one) => one.id === id);
	if (act === 'remove') return now === -1 ? `${label} removed` : '';
	return now === -1 ? '' : `${label} moved ${act}, ${place(now, blocks.length)}`;
}

export function BlockList({ blocks, onOpenBlock, edits }: BlockListProps) {
	const list = useId();
	const control = (block: string, part: 'open' | Direction | 'remove') =>
		`${list}-${block}-${part}`;
	const refusalId = `${list}-refusal`;
	const [pressed, setPressed] = useState<Pressed | null>(null);
	/** the last landed press, and what the list's region says of it. */
	const [landed, setLanded] = useState<{ readonly press: Pressed; readonly said: string } | null>(
		null
	);
	/** the block whose Remove was pressed, while its card asks. */
	const [asking, setAsking] = useState<{ readonly row: BlockRow; readonly at: number } | null>(
		null
	);
	const busy = edits?.busy ?? false;
	const refusal = edits?.refusal ?? null;
	/** the press a standing refusal answers, which is where it is said. */
	const refused = refusal === null ? null : (landed?.press ?? null);

	// the focus is put back on the render the press's answer lands in — `busy` going out after it
	// came in — which is the render the redrawn list arrives in: a moved row's press may be gone
	// (the first row has no Move up), and a removed row's always is.
	useEffect(() => {
		if (pressed === null) return;
		if (busy) {
			if (!pressed.sent) setPressed({ ...pressed, sent: true });
			return;
		}
		if (!pressed.sent) return;
		setPressed(null);
		setLanded({ press: pressed, said: refusal ?? outcome(blocks, pressed) });
		document.getElementById(landing(pressed))?.focus();
	}, [busy, pressed, refusal, blocks]);

	/** the id of the control the focus goes back to; none for Add a block, whose sheet takes it. */
	function landing({ id, act, at }: Pressed): string {
		if (act === 'add') return '';
		const block = blocks.find((one) => one.id === id);
		if (block === undefined) {
			const next = blocks[at] ?? blocks[at - 1];
			return next === undefined ? '' : control(next.id, 'open');
		}
		if (act === 'remove') return block.removable ? control(id, 'remove') : control(id, 'open');
		const again = act === 'up' ? block.movesUp : block.movesDown;
		const other = act === 'up' ? block.movesDown : block.movesUp;
		return again
			? control(id, act)
			: other
				? control(id, act === 'up' ? 'down' : 'up')
				: control(id, 'open');
	}

	if (edits === undefined) {
		return (
			<div className="adm-openrow-list">
				{blocks.map((block) => (
					<OpenRow
						key={block.id}
						label={block.label}
						value={block.summary}
						onOpen={() => onOpenBlock(block.id)}
					/>
				))}
			</div>
		);
	}

	const send = (press: Omit<Pressed, 'sent'>) => {
		setPressed({ ...press, sent: false });
		setLanded(null);
	};

	/** a row's press, held while any press of the sheet's is in flight. */
	const rowPress = (block: BlockRow, at: number, act: Direction | 'remove') => {
		const where = place(at, blocks.length);
		const isRefused = refused?.id === block.id && refused.act === act;
		return {
			id: control(block.id, act),
			type: 'button' as const,
			variant: 'quiet' as const,
			'aria-label':
				act === 'remove'
					? `Remove ${block.label}, ${where}`
					: `Move ${block.label} ${act}, ${where}`,
			'aria-busy': (busy && pressed?.id === block.id && pressed.act === act) || undefined,
			'aria-disabled': busy || undefined,
			'aria-describedby': isRefused ? refusalId : undefined,
			onClick: () => {
				if (busy) return;
				if (act === 'remove') {
					setAsking({ row: block, at });
					return;
				}
				send({ id: block.id, label: block.label, act, at });
				edits.onMove(block.id, act);
			}
		};
	};

	const refusalLine =
		refusal === null ? null : (
			<p className="adm-blockrow__refusal" id={refusalId}>
				<StatusWord register="momentary" blocked mark="circle-alert">
					<MarkedText text={refusal} />
				</StatusWord>
			</p>
		);

	return (
		<>
			<div className="adm-openrow-list">
				{blocks.map((block, at) => (
					<div key={block.id} className="adm-blockrow">
						<OpenRow
							id={control(block.id, 'open')}
							label={block.label}
							value={block.summary}
							onOpen={() => onOpenBlock(block.id)}
						/>
						{block.movesUp ? (
							<Button
								className="adm-blockrow__up"
								mark="chevron-up"
								{...rowPress(block, at, 'up')}
							/>
						) : null}
						{block.movesDown ? (
							<Button
								className="adm-blockrow__down"
								mark="chevron-down"
								{...rowPress(block, at, 'down')}
							/>
						) : null}
						{block.removable ? (
							<Button
								className="adm-blockrow__remove"
								mark="trash-2"
								{...rowPress(block, at, 'remove')}
							/>
						) : null}
						{refused !== null && refused.id === block.id ? refusalLine : null}
					</div>
				))}
			</div>
			{edits.addable.length === 0 ? null : (
				<Menu
					label="Add a block"
					labelled
					mark="plus"
					held={busy}
					describedBy={refused?.act === 'add' ? refusalId : undefined}
					items={edits.addable.map((option) => ({
						label: option.label,
						onSelect: () => {
							send({ id: '', label: option.label, act: 'add', at: blocks.length });
							edits.onAdd(option.value);
						}
					}))}
				/>
			)}
			{refused?.act === 'add' ? refusalLine : null}
			<p className="adm-vh" role="status">
				{landed?.said ?? ''}
			</p>
			{asking === null ? null : (
				<RemoveBlockConfirm
					name={asking.row.label}
					removing={busy}
					onRemove={() => {
						send({ id: asking.row.id, label: asking.row.label, act: 'remove', at: asking.at });
						setAsking(null);
						edits.onRemove(asking.row.id);
					}}
					onCancel={() => setAsking(null)}
				/>
			)}
		</>
	);
}

/** a campaign's own four rows, each drawn only when it is handed. */
type CampaignSettings = {
	readonly name?: string | undefined;
	/** the campaign's address as a path — `/winter-coat-drive`. */
	readonly address?: string | undefined;
	/** `YYYY-MM-DD`, or null for none. */
	readonly endDate?: string | null | undefined;
} & (
	| { readonly goalMinor: number | null; readonly currency: string }
	| { readonly goalMinor?: undefined; readonly currency?: undefined }
);

type BlocksGroup =
	| {
			readonly blocks: readonly BlockRow[];
			readonly onOpenBlock: (id: string) => void;
			/** the list's moves, removes and Add a block; absent, the rows only open. */
			readonly blockEdits?: BlockEdits | undefined;
	  }
	| {
			readonly blocks?: undefined;
			readonly onOpenBlock?: undefined;
			readonly blockEdits?: undefined;
	  };

/** one of the look's three questions, by the name its form posts it under. */
export type LookPart = 'shade' | 'corners' | 'palette';

type LookGroup =
	| {
			/** the look the page wears now, or the one a pick in flight asked for. */
			readonly look: Readonly<Record<LookPart, string>>;
			/** what each question may be answered with, from the block catalog. */
			readonly lookPictures: {
				readonly shades: readonly PictureOption[];
				readonly corners: readonly PictureOption[];
				readonly palettes: readonly PictureOption[];
			};
			/** an answer was picked. it applies to the draft at once. */
			readonly onLook: (part: LookPart, value: string) => void;
			/** the last look pick's refusal, under the question it was picked in. */
			readonly lookRefusals?: Partial<Readonly<Record<LookPart, string | null>>> | undefined;
	  }
	| {
			readonly look?: undefined;
			readonly lookPictures?: undefined;
			readonly onLook?: undefined;
			readonly lookRefusals?: undefined;
	  };

type SharingGroup =
	| {
			readonly share: {
				/** `''` where the page has none, and a share says the page's title. */
				readonly message: string;
				/** the buttons the page offers, in the order they stand, or the ones a pick in flight asked for. */
				readonly channels: readonly string[];
			};
			/** every share button a page may offer. */
			readonly shareChannels: readonly PictureOption[];
			/** a button was ticked or unticked. it applies to the draft at once. */
			readonly onChannel: (channel: string, ticked: boolean) => void;
			/** the Share message row was pressed. */
			readonly onShareMessage: () => void;
			/** the last share buttons pick's refusal. */
			readonly sharingRefusal?: string | null | undefined;
	  }
	| {
			readonly share?: undefined;
			readonly shareChannels?: undefined;
			readonly onChannel?: undefined;
			readonly onShareMessage?: undefined;
			readonly sharingRefusal?: undefined;
	  };

type LayoutGroup =
	| {
			/** the layouts the page may take, from the block catalog. */
			readonly layouts: readonly PictureOption[];
			readonly layout: string;
			readonly onLayout: (layout: string) => void;
			/** the last layout pick's refusal. */
			readonly layoutRefusal?: string | null | undefined;
	  }
	| {
			readonly layouts?: undefined;
			readonly layout?: undefined;
			readonly onLayout?: undefined;
			readonly layoutRefusal?: undefined;
	  };

type OpenRows =
	| {
			/** a campaign's own four; absent on the Donation page. */
			readonly campaign?: CampaignSettings | undefined;
			/** what the page's donation settings come to — `One program, Winter coats`. */
			readonly donationSettings?: string | undefined;
			/** a row that opens a sheet of its own was pressed. */
			readonly onOpen: (row: SettingsRow) => void;
	  }
	| {
			readonly campaign?: undefined;
			readonly donationSettings?: undefined;
			readonly onOpen?: undefined;
	  };

type SettingsSheetProps = {
	readonly onDismiss: () => void;
	/** a pick that applies at once is in flight. absent, the sheet's head says nothing either way. */
	readonly saving?: boolean | undefined;
} & BlocksGroup &
	LayoutGroup &
	LookGroup &
	SharingGroup &
	OpenRows;

type LookChipsProps = {
	readonly id: string;
	readonly legend: string;
	readonly options: readonly PictureOption[];
	readonly value: string;
	readonly onPick: (value: string) => void;
	readonly refusal: string | null | undefined;
};

/** one question of the look, answered by one chip, applied as it is picked. */
function LookChips({ id, legend, options, value, onPick, refusal }: LookChipsProps) {
	return (
		<ChoiceChips
			id={id}
			name={id}
			legend={legend}
			error={refusal ? <MarkedText text={refusal} /> : undefined}
			options={options.map((option) => ({
				value: option.value,
				label: option.label,
				checked: option.value === value,
				onChange: () => onPick(option.value)
			}))}
		/>
	);
}

export function SettingsSheet({
	onDismiss,
	saving,
	campaign,
	blocks,
	onOpenBlock,
	blockEdits,
	layouts,
	layout,
	onLayout,
	layoutRefusal,
	look,
	lookPictures,
	onLook,
	lookRefusals,
	share,
	shareChannels,
	onChannel,
	onShareMessage,
	sharingRefusal,
	donationSettings,
	onOpen
}: SettingsSheetProps) {
	const id = useId();
	const campaignTop = campaign?.name !== undefined || campaign?.address !== undefined;
	const campaignDates = campaign?.goalMinor !== undefined || campaign?.endDate !== undefined;
	return (
		<Sheet
			title="Settings"
			tall
			status={saving === undefined ? undefined : saving ? 'Saving your change…' : ''}
			onDismiss={onDismiss}
		>
			{campaign && campaignTop ? (
				<Part>
					<div className="adm-openrow-list">
						{campaign.name === undefined ? null : (
							<OpenRow label="Name" value={campaign.name} onOpen={() => onOpen('name')} />
						)}
						{campaign.address === undefined ? null : (
							<OpenRow label="Address" value={campaign.address} onOpen={() => onOpen('address')} />
						)}
					</div>
				</Part>
			) : null}
			{blocks ? (
				<Part title="Blocks">
					<BlockList blocks={blocks} onOpenBlock={onOpenBlock} edits={blockEdits} />
				</Part>
			) : null}
			{layouts ? (
				<Part title="Layout">
					<PicturePicker
						legend="Layout"
						name="layout"
						set="layout"
						options={layouts}
						value={layout}
						onPick={onLayout}
					/>
					<PickRefusal refusal={layoutRefusal} />
				</Part>
			) : null}
			{look ? (
				<Part title="Look">
					<LookChips
						id={`${id}-shade`}
						legend="Shade"
						options={lookPictures.shades}
						value={look.shade}
						onPick={(value) => onLook('shade', value)}
						refusal={lookRefusals?.shade}
					/>
					<LookChips
						id={`${id}-corners`}
						legend="Corners"
						options={lookPictures.corners}
						value={look.corners}
						onPick={(value) => onLook('corners', value)}
						refusal={lookRefusals?.corners}
					/>
					<LookChips
						id={`${id}-palette`}
						legend="Colours"
						options={lookPictures.palettes}
						value={look.palette}
						onPick={(value) => onLook('palette', value)}
						refusal={lookRefusals?.palette}
					/>
				</Part>
			) : null}
			{campaign && campaignDates ? (
				<Part title="Goal and end date">
					<div className="adm-openrow-list">
						{campaign.goalMinor === undefined ? null : (
							<OpenRow
								label="Goal"
								value={
									campaign.goalMinor === null
										? 'None'
										: formatMinorBrief(campaign.goalMinor, campaign.currency)
								}
								unset={campaign.goalMinor === null}
								onOpen={() => onOpen('goal')}
							/>
						)}
						{campaign.endDate === undefined ? null : (
							<OpenRow
								label="End date"
								value={campaign.endDate === null ? 'None' : dayWords(campaign.endDate)}
								unset={campaign.endDate === null}
								onOpen={() => onOpen('end-date')}
							/>
						)}
					</div>
				</Part>
			) : null}
			{share ? (
				<Part title="Sharing">
					<div className="adm-openrow-list">
						<OpenRow
							label="Share message"
							value={share.message === '' ? 'The page’s title' : share.message}
							unset={share.message === ''}
							onOpen={onShareMessage}
						/>
					</div>
					<ChoiceChips
						id={`${id}-channels`}
						name={`${id}-channels`}
						type="checkbox"
						legend="Share buttons"
						error={sharingRefusal ? <MarkedText text={sharingRefusal} /> : undefined}
						options={shareChannels.map((channel) => ({
							value: channel.value,
							label: channel.label,
							checked: share.channels.includes(channel.value),
							onChange: (event) => onChannel(channel.value, event.currentTarget.checked)
						}))}
					/>
				</Part>
			) : null}
			{onOpen && donationSettings !== undefined ? (
				<Part title="Gifts">
					<div className="adm-openrow-list">
						<OpenRow
							label="Donation settings"
							value={donationSettings}
							onOpen={() => onOpen('donation-settings')}
						/>
					</div>
				</Part>
			) : null}
		</Sheet>
	);
}
