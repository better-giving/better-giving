import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState
} from 'react';

// the editor, one for the Donation page and a campaign alike: a route of its own outside the rail,
// the publish bar across the top (./publish-bar.tsx), and under it the page's preview
// (./preview-frame.tsx) with the AI panel (../chat/ai-panel.tsx) docked beside it from the wide
// breakpoint. below that breakpoint the panel is a sheet the bar's AI press opens, and it places
// itself, so the slot beside the preview holds nothing there. what a bar press or a clicked block
// opens is a sheet, and a sheet or a confirm the route renders is handed in as `children`: each is
// a modal that lifts itself into the top layer, so where it stands in the tree decides nothing about
// where it paints.

type EditorShellProps = {
	/** the publish bar. */
	readonly bar: ReactNode;
	/** the preview frame. */
	readonly preview: ReactNode;
	/** the AI panel: docked beside the preview at the wide breakpoint, a sheet below it. */
	readonly panel?: ReactNode;
	/** the sheet or confirm that is up, if one is. */
	readonly children?: ReactNode;
};

/** whether the AI sheet is on its way, and the way `ChatOpening` says so. */
const ChatOpeningFlag = createContext(false);
const ReportChatOpening = createContext<(opening: boolean) => void>(() => {});
/** the bar's AI press, for `ChatClosed` to hand the focus to. */
const AiEntry = createContext<RefObject<HTMLButtonElement | null>>({ current: null });

export function EditorShell({ bar, preview, panel, children }: EditorShellProps) {
	const [chatOpening, setChatOpening] = useState(false);
	const aiEntry = useRef<HTMLButtonElement>(null);
	return (
		<ReportChatOpening.Provider value={setChatOpening}>
			<ChatOpeningFlag.Provider value={chatOpening}>
				<AiEntry.Provider value={aiEntry}>
					<div className="adm-editor">
						{bar}
						<div className="adm-editor__body">
							<main className="adm-editor__preview" aria-label="Preview">
								{preview}
							</main>
							{panel}
						</div>
						{children}
					</div>
				</AiEntry.Provider>
			</ChatOpeningFlag.Provider>
		</ReportChatOpening.Provider>
	);
}

/**
 * the bar's AI press as the shell knows it: the ref `ChatClosed` hands the focus to, and whether the
 * sheet it opened is still on its way. the press is busy from its press until its sheet is up — the
 * first open waits on the chat being read — and is held with `aria-disabled` rather than `disabled`
 * for that time, so the focus stays on it to be handed to the sheet.
 */
export function useAiEntry(): {
	readonly ref: RefObject<HTMLButtonElement | null>;
	readonly opening: boolean;
} {
	return { ref: useContext(AiEntry), opening: useContext(ChatOpeningFlag) };
}

/**
 * stands where the AI sheet will, from the AI press until the sheet mounts, and holds the press busy
 * for as long as it does. it is handed in as `children` by ./chat-wiring.tsx, which is what knows
 * the sheet is waiting on the chat's first read; the routes that mount both pass it through without
 * knowing it is there.
 */
export function ChatOpening() {
	const report = useContext(ReportChatOpening);
	useLayoutEffect(() => {
		report(true);
		return () => report(false);
	}, [report]);
	return null;
}

/**
 * stands where an AI sheet nobody's press opened was, and hands the focus to the bar's AI press as
 * the sheet goes. a sheet opened on arrival (an empty chat's, ./chat-wiring.tsx) was put up with
 * the focus on the document, which is where its own return would leave it. it mounts in the commit
 * that takes the sheet down, so its effect runs after the sheet's cleanup has let go of the page.
 * from the wide breakpoint there is no AI press and no sheet, and it hands the focus nowhere.
 */
export function ChatClosed() {
	const entry = useContext(AiEntry);
	useEffect(() => {
		entry.current?.focus();
	}, [entry]);
	return null;
}
