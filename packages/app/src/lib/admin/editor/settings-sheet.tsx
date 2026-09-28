import { Mark } from '@better-giving/operator/components/status/Mark';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import type { ReactNode } from 'react';
import { formatMinorBrief } from '$lib/donations/money';
import { dayWords } from '$lib/page/end-date';
import { PicturePicker, type PictureOption } from './pictures';

// the Settings sheet: everything about a page that is not a chat, one list. rows that hold a typed
// value open a sheet of their own stacked over this one (./done-sheet.tsx argues their one Done);
// the layout pictures and the look apply the moment they are picked, here, with nothing to finish.
//
// the block list is the keyboard's way to a block: a click on a block in the preview opens the same
// block's sheet (./preview-frame.tsx), and a row here is that click for a reader who cannot point.
//
// a campaign carries its name, address, goal and end date; the Donation page has none of the four.

/** a row that opens a sheet of its own. */
export type SettingsRow =
	| 'name'
	| 'address'
	| 'goal'
	| 'end-date'
	| 'share-message'
	| 'donation-settings';

type OpenRowProps = {
	readonly label: string;
	/** what the row holds now, as a reader would say it. */
	readonly value: string;
	/** the value is a stand-in for nothing set here. */
	readonly unset?: boolean;
	readonly onOpen: () => void;
};

function OpenRow({ label, value, unset = false, onOpen }: OpenRowProps) {
	return (
		<button type="button" className="adm-openrow" aria-haspopup="dialog" onClick={onOpen}>
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
};

type BlockListProps = {
	readonly blocks: readonly BlockRow[];
	/** a block's row was pressed: open that block's sheet. */
	readonly onOpenBlock: (id: string) => void;
};

export function BlockList({ blocks, onOpenBlock }: BlockListProps) {
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

type CampaignSettings = {
	readonly name: string;
	/** the campaign's address as a path — `/winter-coat-drive`. */
	readonly address: string;
	readonly goalMinor: number | null;
	readonly currency: string;
	/** `YYYY-MM-DD`, or null for none. */
	readonly endDate: string | null;
};

type SettingsSheetProps = {
	readonly onDismiss: () => void;
	/** a campaign's own four; absent on the Donation page. */
	readonly campaign?: CampaignSettings | undefined;
	readonly blocks: readonly BlockRow[];
	readonly onOpenBlock: (id: string) => void;
	/** the layouts the page may take, from the block catalog. */
	readonly layouts: readonly PictureOption[];
	readonly layout: string;
	readonly onLayout: (layout: string) => void;
	/** the look controls, which apply on pick as the pictures do. */
	readonly look: ReactNode;
	/** the page's own share message, or null while it takes the Organisation's. */
	readonly shareMessage: string | null;
	/** what the page's donation settings come to — `One program · Winter coats`. */
	readonly donationSettings: string;
	/** a row that opens a sheet of its own was pressed. */
	readonly onOpen: (row: SettingsRow) => void;
};

export function SettingsSheet({
	onDismiss,
	campaign,
	blocks,
	onOpenBlock,
	layouts,
	layout,
	onLayout,
	look,
	shareMessage,
	donationSettings,
	onOpen
}: SettingsSheetProps) {
	return (
		<Sheet title="Settings" tall onDismiss={onDismiss}>
			{campaign ? (
				<Part>
					<div className="adm-openrow-list">
						<OpenRow label="Name" value={campaign.name} onOpen={() => onOpen('name')} />
						<OpenRow label="Address" value={campaign.address} onOpen={() => onOpen('address')} />
					</div>
				</Part>
			) : null}
			<Part title="Blocks">
				<BlockList blocks={blocks} onOpenBlock={onOpenBlock} />
			</Part>
			<Part title="Layout">
				<PicturePicker
					legend="Layout"
					name="layout"
					set="layout"
					options={layouts}
					value={layout}
					onPick={onLayout}
				/>
			</Part>
			<Part title="Look">{look}</Part>
			{campaign ? (
				<Part title="Goal and end date">
					<div className="adm-openrow-list">
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
						<OpenRow
							label="End date"
							value={campaign.endDate === null ? 'None' : dayWords(campaign.endDate)}
							unset={campaign.endDate === null}
							onOpen={() => onOpen('end-date')}
						/>
					</div>
				</Part>
			) : null}
			<Part title="Sharing and gifts">
				<div className="adm-openrow-list">
					<OpenRow
						label="Share message"
						value={shareMessage ?? 'The Organisation’s'}
						unset={shareMessage === null}
						onOpen={() => onOpen('share-message')}
					/>
					<OpenRow
						label="Donation settings"
						value={donationSettings}
						onOpen={() => onOpen('donation-settings')}
					/>
				</div>
			</Part>
		</Sheet>
	);
}
