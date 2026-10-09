import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
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
//
// **Edit is the shell's**: off, the preview is the page and a click in it does nothing; on, every
// block in it is drawn as clickable and a click opens that block's sheet (./preview-frame.tsx), and
// the bar's press reads Done, which turns it off (./publish-bar.tsx). the bar and the frame both
// read it with `useEditing`, so a route mounting the two hands neither the state.
//
// **before the page's first draft there is no page to show**, so the shell is `undrafted`: no
// preview, the panel alone in the body at a reading width (`alone` in ../chat/ai-panel.tsx), and a
// bar that draws the page's name, where it stands and More, but nothing that edits or publishes a
// page not yet made (./publish-bar.tsx reads it with `useUndrafted`). the draft that lands draws the
// preview in its slot ahead of the panel, which stays mounted where it stood.

type EditorShellProps = {
	/** the publish bar. */
	readonly bar: ReactNode;
	/** the preview frame. */
	readonly preview: ReactNode;
	/** the AI panel: docked beside the preview at the wide breakpoint, a sheet below it. */
	readonly panel?: ReactNode;
	/** the sheet or confirm that is up, if one is. */
	readonly children?: ReactNode;
	/** the page has never been drafted: `preview` is not drawn, and the bar edits nothing. */
	readonly undrafted?: boolean | undefined;
};

/** whether the AI sheet is on its way, and the way `ChatOpening` says so. */
const ChatOpeningFlag = createContext(false);
const ReportChatOpening = createContext<(opening: boolean) => void>(() => {});
/** the bar's AI press, for `ChatClosed` to hand the focus to. */
const AiEntry = createContext<RefObject<HTMLButtonElement | null>>({ current: null });
const Undrafted = createContext(false);
const Editing = createContext<{ readonly on: boolean; readonly turn: (on: boolean) => void }>({
	on: false,
	turn: () => {}
});

export function EditorShell({
	bar,
	preview,
	panel,
	children,
	undrafted = false
}: EditorShellProps) {
	const [chatOpening, setChatOpening] = useState(false);
	const aiEntry = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const edit = useMemo(() => ({ on: editing, turn: setEditing }), [editing]);
	return (
		<ReportChatOpening.Provider value={setChatOpening}>
			<ChatOpeningFlag.Provider value={chatOpening}>
				<AiEntry.Provider value={aiEntry}>
					<Undrafted.Provider value={undrafted}>
						<Editing.Provider value={edit}>
							<div className="adm-editor">
								{bar}
								<div className="adm-editor__body">
									{undrafted ? null : (
										<main className="adm-editor__preview" aria-label="Preview">
											{preview}
										</main>
									)}
									{panel}
								</div>
								{children}
							</div>
						</Editing.Provider>
					</Undrafted.Provider>
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

/** whether Edit is on, and the way the bar's press turns it. */
export function useEditing(): { readonly on: boolean; readonly turn: (on: boolean) => void } {
	return useContext(Editing);
}

/** whether the page has never been drafted, as the shell was told. */
export function useUndrafted(): boolean {
	return useContext(Undrafted);
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
 * stands where an AI panel nobody's press opened was, and hands the focus to the bar's AI press as
 * the panel goes: a sheet opened on arrival (an empty chat's, ./chat-wiring.tsx), and the panel that
 * was the whole editor until the first draft landed below the wide breakpoint. either way the focus
 * was left on the document, and only from there is it taken — the operator who went elsewhere while
 * the reply was written stays there. it mounts in the commit that takes the panel down, so its
 * effect runs after a sheet's cleanup has let go of the page. from the wide breakpoint there is no
 * AI press and no sheet, and it hands the focus nowhere.
 */
export function ChatClosed() {
	const entry = useContext(AiEntry);
	useEffect(() => {
		if (document.activeElement === null || document.activeElement === document.body)
			entry.current?.focus();
	}, [entry]);
	return null;
}
