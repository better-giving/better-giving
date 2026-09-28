import { Button } from '@better-giving/operator/components/controls/Button';
import type { ReactNode } from 'react';

// the editor, one for the Donation page and a campaign alike: a route of its own outside the rail,
// the publish bar across the top (./publish-bar.tsx), the page's preview filling everything under
// it (./preview-frame.tsx), and the two floating entries over its foot. what an entry or a clicked
// block opens is a sheet, and a sheet or a confirm the route renders is handed in as `children`:
// each is a modal that lifts itself into the top layer, so where it stands in the tree decides
// nothing about where it paints.

type EditorShellProps = {
	/** the publish bar. */
	readonly bar: ReactNode;
	/** the preview frame. */
	readonly preview: ReactNode;
	/**
	 * the floating entries. they stay mounted while a sheet one of them opened is up: the sheet hands
	 * the focus back to the control that opened it, and one taken off the page has nowhere to take it.
	 */
	readonly entries?: ReactNode;
	/** the sheet or confirm that is up, if one is. */
	readonly children?: ReactNode;
};

export function EditorShell({ bar, preview, entries, children }: EditorShellProps) {
	return (
		<div className="adm-editor">
			{bar}
			<main className="adm-editor__preview" aria-label="Preview">
				{preview}
			</main>
			{entries}
			{children}
		</div>
	);
}

type EditorEntriesProps = {
	readonly onChat: () => void;
	readonly onSettings: () => void;
};

/**
 * Chat and Settings, floating at the preview's foot at both widths. each opens a sheet, and the
 * sheet hands the focus back to the entry that opened it when it goes.
 */
export function EditorEntries({ onChat, onSettings }: EditorEntriesProps) {
	return (
		<div className="adm-fabs">
			<Button type="button" mark="message-square" aria-haspopup="dialog" onClick={onChat}>
				Chat
			</Button>
			<Button type="button" mark="settings" aria-haspopup="dialog" onClick={onSettings}>
				Settings
			</Button>
		</div>
	);
}
