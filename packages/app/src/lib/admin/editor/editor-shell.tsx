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
// (./preview-frame.tsx) across the editor's whole width. the AI panel (../chat/ai-panel.tsx) is
// opened and closed by the bar's AI press at every width: from the wide breakpoint it floats over
// the preview's end edge, non-modal, and below it it is a sheet that places itself, so nothing in
// the body makes room for it and nothing reflows as it comes and goes. what a bar press or a clicked
// block opens is a sheet, and a sheet or a confirm the route renders is handed in as `children`:
// each is a modal that lifts itself into the top layer, so where it stands in the tree decides
// nothing about where it paints.
//
// **the AI panel and a sheet never stand together.** the bar's Settings and a block clicked in the
// preview close the panel as they open their sheet (`useAiEntry`'s `close`), and the AI press
// cannot be reached while a sheet is up, because a sheet is modal.
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
// preview in its slot ahead of the panel, which from the wide breakpoint stays mounted and open
// where it floats (./chat-wiring.tsx says what goes below it).

type EditorShellProps = {
	/** the publish bar. */
	readonly bar: ReactNode;
	/** the preview frame. */
	readonly preview: ReactNode;
	/** the AI panel: floating over the preview's end edge at the wide breakpoint, a sheet below it. */
	readonly panel?: ReactNode;
	/** the sheet or confirm that is up, if one is. */
	readonly children?: ReactNode;
	/** the page has never been drafted: `preview` is not drawn, and the bar edits nothing. */
	readonly undrafted?: boolean | undefined;
};

/** whether the AI sheet is on its way, and the way `ChatOpening` says so. */
const ChatOpeningFlag = createContext(false);
const ReportChatOpening = createContext<(opening: boolean) => void>(() => {});
/** the AI panel as `AiLayer` reports it, and the way to close it. */
type AiShown = { readonly open: boolean; readonly unread: boolean };
const AI_GONE: AiShown = { open: false, unread: false };
const AiShownFlag = createContext<AiShown & { readonly close: () => void }>({
	...AI_GONE,
	close: () => {}
});
const ReportAi = createContext<{
	readonly shown: (shown: AiShown) => void;
	readonly close: RefObject<() => void>;
}>({ shown: () => {}, close: { current: () => {} } });
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
	const [aiShown, setAiShown] = useState(AI_GONE);
	const closeAi = useRef<() => void>(() => {});
	const reportAi = useMemo(
		() => ({
			shown: (next: AiShown) =>
				setAiShown((was) => (was.open === next.open && was.unread === next.unread ? was : next)),
			close: closeAi
		}),
		[]
	);
	const ai = useMemo(() => ({ ...aiShown, close: () => closeAi.current() }), [aiShown]);
	return (
		<ReportChatOpening.Provider value={setChatOpening}>
			<ChatOpeningFlag.Provider value={chatOpening}>
				<ReportAi.Provider value={reportAi}>
					<AiShownFlag.Provider value={ai}>
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
					</AiShownFlag.Provider>
				</ReportAi.Provider>
			</ChatOpeningFlag.Provider>
		</ReportChatOpening.Provider>
	);
}

/**
 * the bar's AI press as the shell knows it: the ref `ChatClosed` hands the focus to, whether the
 * panel it opened is still on its way, whether the panel is open, whether a reply landed while it
 * was not, and the way to close it. the press is busy from its press until its panel is up — the
 * first open waits on the chat being read — and is held with `aria-disabled` rather than `disabled`
 * for that time, so the focus stays on it to be handed to the panel. `close` does nothing while the
 * panel is not open.
 */
export function useAiEntry(): {
	readonly ref: RefObject<HTMLButtonElement | null>;
	readonly opening: boolean;
	readonly open: boolean;
	readonly unread: boolean;
	readonly close: () => void;
} {
	const { open, unread, close } = useContext(AiShownFlag);
	return { ref: useContext(AiEntry), opening: useContext(ChatOpeningFlag), open, unread, close };
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
 * tells the shell whether the AI panel is open and whether a reply landed while it was not, for the
 * bar's AI press to draw, and hands it `onClose` for the bar's Settings and the preview's block
 * click to take the panel down with. ./chat-wiring.tsx hands it in as `children` while the page is
 * drafted; the routes pass it through without knowing it is there.
 */
export function AiLayer({
	open,
	unread,
	onClose
}: {
	readonly open: boolean;
	readonly unread: boolean;
	readonly onClose: () => void;
}) {
	const report = useContext(ReportAi);
	useLayoutEffect(() => {
		report.close.current = onClose;
	});
	useLayoutEffect(() => report.shown({ open, unread }), [report, open, unread]);
	useLayoutEffect(
		() => () => {
			report.shown(AI_GONE);
			report.close.current = () => {};
		},
		[report]
	);
	return null;
}

/**
 * stands where the AI panel will, from the AI press until the panel mounts, and holds the press busy
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
 * stands where an AI panel was, and hands the focus to the bar's AI press as the panel goes: the
 * floating panel Escape closed with the focus inside it, and the panel that was the whole editor
 * until the first draft landed below the wide breakpoint (./chat-wiring.tsx). the focus was left on
 * the document, and only from there is it taken — the operator who pressed AI, Settings or a block
 * stays where they pressed, and one who went elsewhere while the reply was written stays there. it
 * mounts in the commit that takes the panel down.
 */
export function ChatClosed() {
	const entry = useContext(AiEntry);
	useEffect(() => {
		if (document.activeElement === null || document.activeElement === document.body)
			entry.current?.focus();
	}, [entry]);
	return null;
}
