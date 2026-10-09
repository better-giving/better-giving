import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { Button } from '@better-giving/operator/components/controls/Button';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState
} from 'react';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';
import {
	type FinderView,
	type FinderWatch,
	IDLE_VIEW,
	SEARCH_FLOOR,
	SEARCH_MOST,
	watchFinder
} from './org-search';

// the finder: one box over the IRS list by name or EIN, a Search press beside it, and the matches
// under it — what the Organisation details fold (./org-fold.tsx) draws alone on a fresh set-up, and
// above its form when "Pick a different organisation" is pressed. the fold locks in the number a
// press or a pick hands it.
//
// **the box is ark's combobox, held open while there are matches to show and run with no layer
// of its own.** the listbox roles, `aria-activedescendant`, the arrow keys and Enter on a match are
// the machine's; the list stands in the screen's flow rather than floated over the form under it.
// the machine is told a typed value is the operator's own (`allowCustomValue`), so Enter over no
// match and a blur keep what was typed, and Enter over no match falls through to this form's own
// submit, which is the press.
//
// **the machine moves focus into the box whenever the list opens or shuts** (`setInitialFocus`
// and `setFinalFocus` in the machine under `@ark-ui/react/combobox`), so the list opens on an
// answer only while focus is still inside the finder, and otherwise waits for the box to be
// focused; it is shut only by a new search, which a press inside the finder made. an answer can
// take a minute, and the operator may be anywhere on the page by then.
//
// **a pick is the finder's to take or turn away, so the machine records none** — its `value` is
// held empty. a pick made while a request is out or the page writes is turned away before anything
// marks it selected, and the same match can always be picked again; the options say they are closed
// for as long as a pick would be turned away.
//
// **nothing is asked while typing, and what is typed stays as typed.** a press is Search or Enter,
// and when it asks, and what, is ./org-search.ts's: a name may open with digits ("100 Black Men of
// America"), so the box is never re-spelled as an EIN, and the press reads a number out of it
// instead. the box's text is the machine's `inputValue`, held here, never written into the element.
//
// **the list is the IRS list's answer, unfiltered here**, in the API's order. a search carries no
// revocation, so the one badge a match can carry is not being listed as tax-deductible; the
// revocation is said under the EIN once the number is locked in (./ein-lookup.ts).

export const FINDER_ID = 'org-find';
export const FINDER_LABEL = 'Name or EIN';
/** the box's label on a console that cannot ask the list, where only a whole EIN does anything. */
export const EIN_LABEL = 'EIN';
export const SEARCH_LABEL = 'Search';
export const NO_MATCHES = 'No matches.';
export const SEARCH_UNANSWERED = "Couldn't search the IRS list. Search by EIN instead.";
export const NOT_DEDUCTIBLE_BADGE = 'Not listed as tax-deductible';
export const SEARCHING = 'Searching…';
export const LOOKING_UP = 'Looking up…';
export const TOO_SHORT = `Type at least ${SEARCH_FLOOR} characters.`;
export const EIN_ONLY = 'Type the 9-digit EIN.';

/**
 * what the region under the box says: the wait while a request is out, why a press asked nothing,
 * or what the last search found. the matches are counted rather than left to the list: the listbox
 * opening is a change of attribute on the box, which a reader is not told about.
 */
function said(view: FinderView): string {
	if (view.out === 'search') return SEARCHING;
	if (view.out === 'lookup') return LOOKING_UP;
	if (view.refused === 'short') return TOO_SHORT;
	if (view.refused === 'not-ein') return EIN_ONLY;
	const state = view.found;
	switch (state.kind) {
		case 'idle':
			return '';
		case 'matches':
			return state.matches.length === 1 ? '1 match.' : `${state.matches.length} matches.`;
		case 'none':
			return NO_MATCHES;
		case 'unavailable':
			return SEARCH_UNANSWERED;
	}
}

const NO_MATCH: readonly NonprofitMatch[] = [];

/** the machine's selection, which is never anything: see the header. */
const NO_VALUE: string[] = [];

export type OrgFinderProps = {
	/** whether this console can ask the IRS list; where it cannot, only a whole EIN does anything. */
	readonly lookups: boolean;
	readonly search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
	/**
	 * a whole EIN, in its stored spelling, to look up and lock in, with the match it was picked as or
	 * `null` for one typed; settles once it has.
	 */
	readonly lockIn: (
		ein: string,
		signal: AbortSignal,
		match: NonprofitMatch | null
	) => Promise<void>;
	/** the page is writing, which holds a press and a pick. */
	readonly closed: boolean;
	/** Escape in the box, where there is a form under the finder to go back to. */
	readonly onClose?: (() => void) | undefined;
};

export function OrgFinder({ lookups, search, lockIn, closed, onClose }: OrgFinderProps): ReactNode {
	const [view, setView] = useState<FinderView>(IDLE_VIEW);
	const [typed, setTyped] = useState('');
	/** whether matches are drawn as an open list: decided as each answer lands, by where focus is. */
	const [listed, setListed] = useState(false);
	const box = useRef<HTMLInputElement>(null);
	const finder = useRef<HTMLElement>(null);
	const locking = useEffectEvent(lockIn);
	const viewed = useEffectEvent((next: FinderView) => {
		setView(next);
		if (next.out === null) setListed(finder.current?.contains(document.activeElement) ?? false);
	});

	const watch = useRef<FinderWatch | null>(null);
	useEffect(() => {
		const watching = watchFinder({ search, lockIn: locking, lookups, onView: viewed });
		watch.current = watching;
		return () => {
			watching.stop();
			watch.current = null;
		};
	}, [search, lookups]);

	/* the finder is opened to be typed in: on a fresh set-up it is the whole screen, and above the
	   form it is what the press that opened it asked for. */
	useEffect(() => {
		box.current?.focus();
	}, []);

	return (
		<OrgFinderCard
			view={view}
			lookups={lookups}
			listed={listed}
			finder={finder}
			box={box}
			typed={typed}
			onType={setTyped}
			onBoxFocus={() => setListed(true)}
			onPress={() => {
				if (!closed) watch.current?.press(typed);
			}}
			onPick={(match) => {
				if (!closed) watch.current?.pick(match);
			}}
			closed={closed}
			onClose={onClose}
		/>
	);
}

export type OrgFinderCardProps = {
	readonly view: FinderView;
	/** whether this console can ask the list, which is what the box is labelled for. */
	readonly lookups: boolean;
	/** whether matches are drawn as an open list rather than counted alone. */
	readonly listed: boolean;
	readonly closed: boolean;
	readonly finder?: RefObject<HTMLElement | null> | undefined;
	readonly box?: RefObject<HTMLInputElement | null> | undefined;
	/** what the box holds, as typed. */
	readonly typed: string;
	readonly onType: (typed: string) => void;
	readonly onBoxFocus?: (() => void) | undefined;
	readonly onPress: () => void;
	readonly onPick: (match: NonprofitMatch) => void;
	readonly onClose?: (() => void) | undefined;
};

/** the finder in one view, which is the whole of what it draws. */
export function OrgFinderCard({
	view,
	lookups,
	listed,
	closed,
	finder,
	box,
	typed,
	onType,
	onBoxFocus,
	onPress,
	onPick,
	onClose
}: OrgFinderCardProps): ReactNode {
	const matches = view.found.kind === 'matches' ? view.found.matches : NO_MATCH;
	const held = closed || view.out !== null;
	const collection = useMemo(
		() =>
			createListCollection({
				items: [...matches],
				itemToValue: (match) => match.ein,
				itemToString: (match) => match.name,
				isItemDisabled: () => held
			}),
		[matches, held]
	);

	return (
		<search id={FINDER_ID} ref={finder}>
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					onPress();
				}}
			>
				<Combobox.Root
					className="adm-findorg"
					collection={collection}
					open={listed && matches.length > 0}
					disableLayer
					allowCustomValue
					selectionBehavior="preserve"
					value={NO_VALUE}
					inputValue={typed}
					onInputValueChange={(details) => onType(details.inputValue)}
					onValueChange={(details) => {
						const match = details.items[0];
						if (match !== undefined) onPick(match);
					}}
				>
					<Combobox.Label className="adm-field__label">
						{lookups ? FINDER_LABEL : EIN_LABEL}
					</Combobox.Label>
					{/* the box and the press that acts on it on one row, which wraps at the floor. */}
					<Combobox.Control className="adm-actions">
						<Combobox.Input
							ref={box}
							className="adm-input"
							maxLength={SEARCH_MOST}
							autoComplete="off"
							onFocus={onBoxFocus}
							onKeyDown={(event) => {
								if (event.key === 'Escape') onClose?.();
							}}
						/>
						{/* closed as the field's own presses are, so a reader standing on it keeps the focus
					    through a wait that can run to a minute. */}
						<Button
							type="submit"
							aria-busy={view.out !== null || undefined}
							aria-disabled={held || undefined}
							onClick={(event) => {
								if (held) event.preventDefault();
							}}
						>
							{SEARCH_LABEL}
						</Button>
					</Combobox.Control>
					<Combobox.Content className="adm-findlist">
						{matches.map((match) => (
							<Combobox.Item key={match.ein} item={match} className="adm-findrow" persistFocus>
								<span className="adm-findrow__who">
									<Combobox.ItemText className="adm-findrow__name">{match.name}</Combobox.ItemText>
									<span className="adm-findrow__place">{placeOf(match)}</span>
									{match.deductible ? null : (
										<StatusWord tone="attention">{NOT_DEDUCTIBLE_BADGE}</StatusWord>
									)}
								</span>
								<span className="adm-findrow__ein">
									<span className="adm-findrow__einlabel">EIN</span>
									<span className="adm-num">{einAsPrinted(match.ein)}</span>
								</span>
							</Combobox.Item>
						))}
					</Combobox.Content>
					<p className="adm-hint adm-findorg__said" role="status">
						{said(view)}
					</p>
				</Combobox.Root>
			</form>
		</search>
	);
}

/** the city and the state on one line, as an address is read. */
const placeOf = (match: NonprofitMatch): string =>
	[match.city, match.state].filter((part) => part !== '').join(', ');
