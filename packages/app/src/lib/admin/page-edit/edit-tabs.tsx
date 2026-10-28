import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';

// a page's edit screen as one tab per section card: the tablist, and every panel mounted at once,
// the ones not chosen `hidden`, so a card keeps what is typed in it while another tab is open and
// each card's Save still posts its own form (./section-card.tsx).
//
// the tablist follows the WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/):
// one tab stop, the chosen tab; Left and Right move along the tabs and choose the one moved to,
// wrapping at the ends, and Home and End go to the first and last. a tab whose card holds unsaved
// edits carries a dot, and says so in its name. on a narrow screen the tablist scrolls sideways
// (`.adm-tabs` in packages/operator/src/styles/adm.css), and the chosen tab is scrolled into view.

/** a card reporting whether it holds unsaved edits, to the tab it stands in. */
const ReportChanged = createContext<((changed: boolean) => void) | null>(null);

/** tells the tab a card stands in whether the card holds unsaved edits; outside tabs, nothing. */
export function useReportChanged(changed: boolean): void {
	const report = useContext(ReportChanged);
	useEffect(() => {
		report?.(changed);
	}, [report, changed]);
}

export type EditTab = {
	readonly id: string;
	readonly label: string;
	readonly panel: ReactNode;
};

/** one panel, handing its card the way to report unsaved edits to its tab. */
function Panel({
	tab,
	tabId,
	panelId,
	chosen,
	onChanged
}: {
	readonly tab: EditTab;
	readonly tabId: string;
	readonly panelId: string;
	readonly chosen: boolean;
	readonly onChanged: (id: string, changed: boolean) => void;
}) {
	const report = useCallback((changed: boolean) => onChanged(tab.id, changed), [onChanged, tab.id]);
	return (
		<div
			role="tabpanel"
			id={panelId}
			aria-labelledby={tabId}
			hidden={!chosen}
			className="adm-tabs__panel"
		>
			<ReportChanged.Provider value={report}>{tab.panel}</ReportChanged.Provider>
		</div>
	);
}

export function EditTabs({
	tabs,
	label
}: {
	readonly tabs: readonly EditTab[];
	/** what the tablist is named: "Campaign sections". */
	readonly label: string;
}) {
	const base = useId();
	const [chosen, setChosen] = useState(tabs[0]?.id ?? '');
	const [unsaved, setUnsaved] = useState<Readonly<Record<string, boolean>>>({});
	const refs = useRef<Record<string, HTMLButtonElement | null>>({});
	const onChanged = useCallback((id: string, changed: boolean) => {
		setUnsaved((held) => (held[id] === changed ? held : { ...held, [id]: changed }));
	}, []);
	const tabId = (id: string) => `${base}-tab-${id}`;
	const panelId = (id: string) => `${base}-panel-${id}`;

	const choose = (id: string) => {
		setChosen(id);
		const tab = refs.current[id];
		tab?.focus();
		tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	};

	const move = (event: KeyboardEvent<HTMLDivElement>) => {
		const at = tabs.findIndex((tab) => tab.id === chosen);
		const last = tabs.length - 1;
		const to =
			event.key === 'ArrowRight'
				? at === last
					? 0
					: at + 1
				: event.key === 'ArrowLeft'
					? at === 0
						? last
						: at - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: null;
		if (to === null) return;
		event.preventDefault();
		const tab = tabs[to];
		if (tab !== undefined) choose(tab.id);
	};

	return (
		<div className="adm-stack">
			<div role="tablist" aria-label={label} className="adm-tabs" onKeyDown={move}>
				{tabs.map((tab) => {
					const selected = tab.id === chosen;
					const dirty = unsaved[tab.id] === true;
					return (
						<button
							key={tab.id}
							ref={(node) => {
								refs.current[tab.id] = node;
							}}
							type="button"
							role="tab"
							id={tabId(tab.id)}
							aria-controls={panelId(tab.id)}
							aria-selected={selected}
							tabIndex={selected ? 0 : -1}
							className="adm-tabs__tab"
							onClick={() => choose(tab.id)}
						>
							{tab.label}
							{dirty ? (
								<>
									<span className="adm-tabs__dot" aria-hidden="true" />
									<span className="adm-vh">, unsaved changes</span>
								</>
							) : null}
						</button>
					);
				})}
			</div>
			{tabs.map((tab) => (
				<Panel
					key={tab.id}
					tab={tab}
					tabId={tabId(tab.id)}
					panelId={panelId(tab.id)}
					chosen={tab.id === chosen}
					onChanged={onChanged}
				/>
			))}
		</div>
	);
}
