import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useId } from 'react';
import { RouterLink } from '../router-link';
import { InPlaceName } from './in-place-name';

// the bar across the top of the editor: the way out, the page's name and where it stands, and the
// presses that act on the whole page — Open, Reset to default, Discard changes, Publish.
//
// **Publish reports at itself.** it is `SaveButton`, so a press in flight holds its focus and draws
// its dots, and a republish reads "Published" with Undo beside it for as long as the caller says the
// republish is the latest thing that happened. the Donation page is live from the start, so every
// Publish of it is a republish; a campaign's first Publish goes through ./confirms.tsx's
// `FirstPublishConfirm` first and is the caller's to route there.
//
// **a refused press is reported on the bar's own row under Publish**, in a region that is on the
// page before it has anything to say (`.adm-publishbar__report` holds no room while empty), and the
// control that was pressed is described by it. a refused rename marks the name box as well.
//
// Reset to default is the Donation page's alone and is drawn only once the page has edits; Discard
// changes only while the draft differs from what is live; Open only while something is live.

/** where the page stands against what donors see. */
export type PublishState =
	/** a campaign never published. */
	| 'unpublished'
	/** live, and the draft differs from it. */
	| 'changed'
	/** live, and the draft is what is live. */
	| 'live'
	/** a campaign that has ended; Publish brings it back. */
	| 'ended';

const STATE_WORDS = {
	unpublished: { word: 'Not published', tone: 'attention' },
	changed: { word: 'Changes not published', tone: 'attention' },
	live: { word: 'Live', tone: 'done' },
	ended: { word: 'Ended', tone: 'note' }
} as const;

/** which press a refusal answers. */
export type BarPress = 'publish' | 'undo' | 'name';

type PublishBarPage =
	| { readonly kind: 'donation' }
	| {
			readonly kind: 'campaign';
			readonly name: string;
			readonly onRename: (name: string) => void;
	  };

type PublishBarProps = {
	/** where the X goes: the dashboard or the Campaigns list. */
	readonly closeHref: string;
	/** the Donation page, which has no name to edit, or a campaign and its name. */
	readonly page: PublishBarPage;
	readonly state: PublishState;
	/** the live page's address — `/donate`, `/winter-coat-drive` — drawn as Open while it is live. */
	readonly livePath?: string | undefined;
	/** a Publish is in flight. */
	readonly publishing: boolean;
	/** the latest thing that happened is a republish: Publish reads Published and Undo stands beside it. */
	readonly republished: boolean;
	readonly onPublish: () => void;
	/** an Undo is in flight. */
	readonly undoing: boolean;
	readonly onUndo: () => void;
	readonly onDiscard: () => void;
	/** the Donation page's Reset to default. absent on a campaign, which has none. */
	readonly reset?: { readonly hasEdits: boolean; readonly onReset: () => void } | undefined;
	/** the last press's refusal, as a sentence naming what to change. */
	readonly report?: { readonly press: BarPress; readonly text: string } | null | undefined;
};

export function PublishBar({
	closeHref,
	page,
	state,
	livePath,
	publishing,
	republished,
	onPublish,
	undoing,
	onUndo,
	onDiscard,
	reset,
	report
}: PublishBarProps) {
	const reportId = useId();
	const describe = (press: BarPress) => (report?.press === press ? reportId : undefined);
	const { word, tone } = STATE_WORDS[state];
	const live = state === 'changed' || state === 'live';

	return (
		<header className="adm-publishbar">
			<div className="adm-publishbar__who">
				<Button
					as={RouterLink}
					href={closeHref}
					variant="quiet"
					size="sm"
					mark="x"
					aria-label="Close editor"
				/>
				{page.kind === 'campaign' ? (
					<InPlaceName
						value={page.name}
						onRename={page.onRename}
						invalid={report?.press === 'name'}
						aria-describedby={describe('name')}
					/>
				) : (
					<span className="adm-publishbar__name">Donation page</span>
				)}
				<StatusWord tone={tone}>{word}</StatusWord>
			</div>
			<div className="adm-publishbar__acts">
				<div className="adm-publishbar__quiet">
					{live && livePath ? (
						<Button
							as="a"
							href={livePath}
							target="_blank"
							rel="noopener"
							variant="quiet"
							size="sm"
							markAfter="arrow-up-right"
						>
							Open {livePath}
							<span className="adm-vh"> (opens in a new tab)</span>
						</Button>
					) : null}
					{reset?.hasEdits ? (
						<Button
							type="button"
							variant="quiet"
							size="sm"
							mark="undo-2"
							aria-haspopup="dialog"
							onClick={reset.onReset}
						>
							Reset to default
						</Button>
					) : null}
					{state === 'changed' ? (
						<Button
							type="button"
							variant="quiet"
							size="sm"
							aria-haspopup="dialog"
							onClick={onDiscard}
						>
							Discard changes
						</Button>
					) : null}
				</div>
				<div className="adm-publishbar__done">
					<SaveButton
						type="button"
						label="Publish"
						doneLabel="Published"
						elsewhere=""
						state={
							publishing ? 'pending' : republished ? 'done' : state === 'live' ? 'disabled' : 'idle'
						}
						aria-describedby={describe('publish')}
						onClick={onPublish}
					/>
					{republished ? (
						<Button
							type="button"
							variant="quiet"
							size="sm"
							mark="undo-2"
							aria-busy={undoing}
							aria-disabled={undoing || undefined}
							aria-describedby={describe('undo')}
							onClick={() => {
								if (!undoing) onUndo();
							}}
						>
							Undo
						</Button>
					) : null}
				</div>
			</div>
			<p className="adm-publishbar__report" id={reportId} role="status">
				{report ? (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{report.text}
					</StatusWord>
				) : null}
			</p>
		</header>
	);
}
