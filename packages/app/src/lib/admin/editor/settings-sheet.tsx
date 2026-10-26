import { Button } from '@better-giving/operator/components/controls/Button';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import type { ReactNode } from 'react';
import { formatMinorBrief } from '$lib/donations/money';
import { dayWords } from '$lib/page/end-date';

// the Settings sheet: everything about a page, one list, and every row opening a sheet of its own
// stacked over this one (./done-sheet.tsx argues their one Done). there is nothing to lay out: no
// layout, look, colour, share button or section order is chosen here, since the page picks a whole
// layout from what its content holds ($lib/page/shape.ts) and its one colour is the organisation's.
//
// the content list is the keyboard's way to a section: a click on a section in the preview while
// Edit is on opens the same section's sheet (./preview-frame.tsx), and a row here is that click for
// a reader who cannot point. Add a photo opens an empty photo's sheet, up to the catalog's cap.
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

/** one content section, in the order Settings lists them. */
export type SectionRow = {
	readonly id: string;
	/** the section's name — Title, Story, Cover photo. */
	readonly label: string;
	/** a line of what it holds, or what stands in where it holds nothing. */
	readonly summary: string;
	/** it holds nothing yet. */
	readonly empty: boolean;
};

type ContentGroup =
	| {
			readonly sections: readonly SectionRow[];
			/** a section's row was pressed: open that section's sheet. */
			readonly onOpenSection: (id: string) => void;
			/** Add a photo was pressed; absent where the page takes no more. */
			readonly onAddPhoto?: (() => void) | undefined;
	  }
	| {
			readonly sections?: undefined;
			readonly onOpenSection?: undefined;
			readonly onAddPhoto?: undefined;
	  };

type SharingGroup =
	| {
			/** `''` where the page has none, and a share says the page's title. */
			readonly shareMessage: string;
			/** the Share message row was pressed. */
			readonly onShareMessage: () => void;
	  }
	| { readonly shareMessage?: undefined; readonly onShareMessage?: undefined };

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
} & ContentGroup &
	SharingGroup &
	OpenRows;

export function SettingsSheet({
	onDismiss,
	campaign,
	sections,
	onOpenSection,
	onAddPhoto,
	shareMessage,
	onShareMessage,
	donationSettings,
	onOpen
}: SettingsSheetProps) {
	const campaignTop = campaign?.name !== undefined || campaign?.address !== undefined;
	const campaignDates = campaign?.goalMinor !== undefined || campaign?.endDate !== undefined;
	return (
		<Sheet title="Settings" tall onDismiss={onDismiss}>
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
			{sections ? (
				<Part title="Page content">
					<div className="adm-openrow-list">
						{sections.map((section) => (
							<OpenRow
								key={section.id}
								label={section.label}
								value={section.summary}
								unset={section.empty}
								onOpen={() => onOpenSection(section.id)}
							/>
						))}
					</div>
					{onAddPhoto === undefined ? null : (
						<div className="adm-actions">
							<Button
								type="button"
								size="sm"
								mark="plus"
								className="adm-rowpress"
								onClick={onAddPhoto}
							>
								Add a photo
							</Button>
						</div>
					)}
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
			{shareMessage === undefined ? null : (
				<Part title="Sharing">
					<div className="adm-openrow-list">
						<OpenRow
							label="Share message"
							value={shareMessage === '' ? 'The page’s title' : shareMessage}
							unset={shareMessage === ''}
							onOpen={onShareMessage}
						/>
					</div>
				</Part>
			)}
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
