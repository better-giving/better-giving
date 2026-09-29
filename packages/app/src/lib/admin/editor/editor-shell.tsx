import { Button } from '@better-giving/operator/components/controls/Button';
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from 'react';

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

/** whether the Chat entry's sheet is on its way, and the way `ChatOpening` says so. */
const ChatOpeningFlag = createContext(false);
const ReportChatOpening = createContext<(opening: boolean) => void>(() => {});

export function EditorShell({ bar, preview, entries, children }: EditorShellProps) {
	const [chatOpening, setChatOpening] = useState(false);
	return (
		<ReportChatOpening.Provider value={setChatOpening}>
			<ChatOpeningFlag.Provider value={chatOpening}>
				<div className="adm-editor">
					{bar}
					<main className="adm-editor__preview" aria-label="Preview">
						{preview}
					</main>
					{entries}
					{children}
				</div>
			</ChatOpeningFlag.Provider>
		</ReportChatOpening.Provider>
	);
}

/**
 * stands where the chat sheet will, from the Chat press until the sheet mounts, and holds the Chat
 * entry busy for as long as it does. it is handed in as `children` by ./chat-wiring.tsx, which is
 * what knows the sheet is waiting on the chat's first read; the routes that mount both pass it
 * through without knowing it is there.
 */
export function ChatOpening() {
	const report = useContext(ReportChatOpening);
	useLayoutEffect(() => {
		report(true);
		return () => report(false);
	}, [report]);
	return null;
}

type EditorEntriesProps = {
	readonly onChat: () => void;
	readonly onSettings: () => void;
};

/**
 * Chat and Settings, floating at the preview's foot at both widths. each opens a sheet, and the
 * sheet hands the focus back to the entry that opened it when it goes.
 *
 * Chat is busy from its press until its sheet is up (`ChatOpening`): the first open waits on the
 * chat being read. it is held with `aria-disabled` rather than `disabled`, so the focus stays on it
 * to be handed to the sheet.
 */
export function EditorEntries({ onChat, onSettings }: EditorEntriesProps) {
	const chatOpening = useContext(ChatOpeningFlag);
	return (
		<div className="adm-fabs">
			<Button
				type="button"
				mark="message-square"
				aria-haspopup="dialog"
				aria-busy={chatOpening || undefined}
				aria-disabled={chatOpening || undefined}
				onClick={() => {
					if (!chatOpening) onChat();
				}}
			>
				Chat
			</Button>
			<Button type="button" mark="settings" aria-haspopup="dialog" onClick={onSettings}>
				Settings
			</Button>
		</div>
	);
}
