import { Button } from '@better-giving/operator/components/controls/Button';
import { Menu, type MenuItem } from '@better-giving/operator/components/controls/Menu';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type Ref, useId } from 'react';
import { RouterLink } from '../router-link';
import { useAiEntry, useEditing, useUndrafted } from './editor-shell';
import { InPlaceName } from './in-place-name';
import { useMiddle, useWide } from './wide';

// the bar across the top of the editor: the way out, the page's name and where it stands, and the
// presses that act on the whole page — Edit, AI below the wide breakpoint, a More menu, and
// Publish.
//
// the editor's `h1` is here, naming the page being edited, and read by a screen reader only: the
// name the bar shows is the heading's words already, and a campaign's is a box to rename it in,
// which a heading cannot hold. the Donation page's drawn word is hidden from a screen reader for
// that reason, so the name is not read twice.
//
// **Edit turns the editor's Edit on** (`useEditing` in ./editor-shell.tsx): the preview's blocks
// are drawn as clickable, each opening its own sheet, and the press reads Done, which turns it off
// again. it is one press whose words change, so the focus stays on it through both. while it is
// on, Settings stands beside it and opens the Settings sheet (./settings-sheet.tsx), whose block
// list is the keyboard's way to a block. AI opens the AI sheet, and is drawn only below the wide
// breakpoint (./wide.ts): from there the panel is docked beside the preview and always open. it is
// busy from its press until the sheet is up (`useAiEntry` in ./editor-shell.tsx), held with
// `aria-disabled` so the focus stays on it.
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
// **More holds the presses an operator reaches for now and then**, each line drawn only while it
// can act: Open while something is live, a link to the live page in a new tab; Reset to default,
// the Donation page's alone, once the page has edits; Discard changes while the draft differs from
// what is live. a menu with no line to hold is not drawn. a line closes the menu as it runs, and
// the menu hands the focus back to More; a Reset or a Discard that lands takes its own line away,
// and the caller puts the focus on the state word instead (`statusRef`), which reads the state the
// press left.
//
// **the presses are in the order they are drawn**, so the focus walks them as they read: from the
// middle width the quieter presses stand before Publish on one line, and below it Publish ends the
// state word's line and they take the line under it, so below it Publish comes first
// (`useMiddle` in ./wide.ts).
//
// **nothing pressable does nothing.** a caller with no handler for Settings, AI, Undo or Discard
// changes gets no such press drawn, and with no Settings no Edit either — the editor over a draft
// it cannot read has no blocks to click, nor Settings or a chat to open. Publish is the bar's one
// press that is always there, so without `onPublish` it is drawn held — `aria-disabled`, the press
// turned away — and described by `publishHeld`, which stands in the report region beside any
// refusal.
//
// **a page never drafted has nothing to edit or publish** (`undrafted` in ./editor-shell.tsx): the
// bar draws its name, where it stands and More, and no Edit, AI, Publish or Undo, whatever
// handlers it is handed — the AI panel is the whole editor then, and nothing opens it.

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

const DONATION_PAGE = 'Donation page';

/** which press a refusal answers. */
export type BarPress = 'publish' | 'undo' | 'name';

function publishPressState(at: {
	held: boolean;
	publishing: boolean;
	republished: boolean;
	state: PublishState;
}) {
	if (at.held) return 'disabled';
	if (at.publishing) return 'pending';
	if (at.republished) return 'done';
	// a page that is all live has nothing to publish.
	return at.state === 'live' ? 'disabled' : 'idle';
}

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
	/** opens the Settings sheet, from Settings while Edit is on. absent: neither is drawn. */
	readonly onSettings?: (() => void) | undefined;
	/** opens the AI sheet, below the wide breakpoint. absent: no AI is drawn. */
	readonly onAi?: (() => void) | undefined;
	/** the Donation page, which has no name to edit, or a campaign and its name. */
	readonly page: PublishBarPage;
	readonly state: PublishState;
	/** the live page's address — `/donate`, `/winter-coat-drive` — More's Open while it is live. */
	readonly livePath?: string | undefined;
	/** a Publish is in flight. */
	readonly publishing: boolean;
	/** the latest thing that happened is a republish: Publish reads Published and Undo stands beside it. */
	readonly republished: boolean;
	/** absent: Publish is drawn held. */
	readonly onPublish?: (() => void) | undefined;
	/** why Publish is held, drawn in the report region while `onPublish` is absent. */
	readonly publishHeld?: string | undefined;
	/** an Undo is in flight. */
	readonly undoing: boolean;
	/** absent: no Undo is drawn. */
	readonly onUndo?: (() => void) | undefined;
	/** absent: More holds no Discard changes. */
	readonly onDiscard?: (() => void) | undefined;
	/** the Donation page's Reset to default. absent on a campaign, which has none. */
	readonly reset?: { readonly hasEdits: boolean; readonly onReset: () => void } | undefined;
	/** the last press's refusal, as a sentence naming what to change. */
	readonly report?: { readonly press: BarPress; readonly text: string } | null | undefined;
	/** the state word's holder, which takes the focus from a press that landed and went. */
	readonly statusRef?: Ref<HTMLSpanElement> | undefined;
};

export function PublishBar({
	closeHref,
	onSettings,
	onAi,
	page,
	state,
	livePath,
	publishing,
	republished,
	onPublish,
	publishHeld,
	undoing,
	onUndo,
	onDiscard,
	reset,
	report,
	statusRef
}: PublishBarProps) {
	const reportId = useId();
	const heldId = useId();
	const describe = (press: BarPress) => (report?.press === press ? reportId : undefined);
	const held = onPublish === undefined;
	const heldReason = held && publishHeld ? publishHeld : null;
	const { word, tone } = STATE_WORDS[state];
	const live = state === 'changed' || state === 'live';
	const wide = useWide();
	const middle = useMiddle();
	const ai = useAiEntry();
	const undrafted = useUndrafted();
	const editing = useEditing();
	const more: MenuItem[] = [];
	if (live && livePath) more.push({ label: `Open ${livePath}`, href: livePath, newTab: true });
	if (reset?.hasEdits) more.push({ label: 'Reset to default', onSelect: reset.onReset });
	if (state === 'changed' && onDiscard)
		more.push({ label: 'Discard changes', onSelect: onDiscard });

	const quiet = (
		<div key="quiet" className="adm-publishbar__quiet">
			{onSettings && !undrafted ? (
				<Button
					type="button"
					mark={editing.on ? 'check' : 'pencil'}
					onClick={() => editing.turn(!editing.on)}
				>
					{editing.on ? 'Done' : 'Edit'}
				</Button>
			) : null}
			{onSettings && !undrafted && editing.on ? (
				<Button type="button" mark="settings" aria-haspopup="dialog" onClick={onSettings}>
					Settings
				</Button>
			) : null}
			{wide || !onAi || undrafted ? null : (
				<Button
					ref={ai.ref}
					type="button"
					mark="sparkles"
					aria-haspopup="dialog"
					aria-busy={ai.opening || undefined}
					aria-disabled={ai.opening || undefined}
					onClick={() => {
						if (!ai.opening) onAi();
					}}
				>
					AI
				</Button>
			)}
			{more.length === 0 ? null : <Menu label="More" items={more} />}
		</div>
	);
	const done = undrafted ? null : (
		<div key="done" className="adm-publishbar__done">
			<SaveButton
				type="button"
				label="Publish"
				doneLabel="Published"
				elsewhere=""
				state={publishPressState({ held, publishing, republished, state })}
				aria-describedby={heldReason ? heldId : describe('publish')}
				onClick={onPublish}
			/>
			{republished && onUndo ? (
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
	);

	return (
		<header className="adm-publishbar">
			<h1 className="adm-vh">{page.kind === 'campaign' ? page.name : DONATION_PAGE}</h1>
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
					<span className="adm-publishbar__name" aria-hidden="true">
						{DONATION_PAGE}
					</span>
				)}
			</div>
			{/* the state word stands with the presses rather than with the name, so that on a phone
			    where the two do not fit one line it is the name that takes a line of its own and
			    Publish stays on the state word's (`.adm-publishbar__acts` in adm.css). */}
			<div className="adm-publishbar__acts">
				<span className="adm-publishbar__state" ref={statusRef} tabIndex={-1}>
					<StatusWord tone={tone}>{word}</StatusWord>
				</span>
				{middle ? [quiet, done] : [done, quiet]}
			</div>
			<p className="adm-publishbar__report" role="status">
				{report ? (
					<span id={reportId}>
						<StatusWord register="momentary" blocked mark="circle-alert">
							{report.text}
						</StatusWord>
					</span>
				) : null}
				{heldReason ? (
					<span id={heldId}>
						<StatusWord register="momentary" neutral>
							{heldReason}
						</StatusWord>
					</span>
				) : null}
			</p>
		</header>
	);
}
