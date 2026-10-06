import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { Button } from '@better-giving/operator/components/controls/Button';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import {
	type FormEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState
} from 'react';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';
import { spellEin } from './fold-boxes';
import {
	type FinderView,
	type FinderWatch,
	IDLE_VIEW,
	SEARCH_MOST,
	type SearchState,
	watchFinder
} from './org-search';

// the finder: one box over the IRS list by name or EIN, a Search press beside it, and the matches
// under it — what the Organisation details fold (./org-fold.tsx) draws alone on a fresh set-up, and
// above its form when "Pick a different organisation" is pressed. the fold locks in the number a
// press or a pick hands it.
//
// **the box is ark's combobox, held open while there are matches and run with no layer of its
// own.** the listbox roles, `aria-activedescendant`, the arrow keys and Enter on a match are the
// machine's; the list stands in the screen's flow rather than floated over the form under it. the
// machine is told a typed value is the operator's own (`allowCustomValue`), so Enter over no match
// and a blur keep what was typed, and Enter over no match falls through to this form's own submit,
// which is the press.
//
// **nothing is asked while typing.** a press is Search or Enter, and when it asks, and what, is
// ./org-search.ts's. a box holding nothing but digits, dashes and spaces is spelled as an EIN as it
// is typed, the way the fold's own EIN box is.
//
// **the list is the IRS list's answer, unfiltered here**, in the API's order. a search carries no
// revocation, so the one badge a match can carry is not being listed as tax-deductible; the
// revocation is said under the EIN once the number is locked in (./ein-lookup.ts).

export const FINDER_ID = 'org-find';
export const FINDER_LABEL = 'Name or EIN';
export const SEARCH_LABEL = 'Search';
export const NO_MATCHES = 'No matches.';
export const SEARCH_UNANSWERED = "Couldn't search the IRS list. Search by EIN instead.";
export const NOT_DEDUCTIBLE_BADGE = 'Not listed as tax-deductible';

/** what an EIN looks like part-typed: digits, dashes and spaces, with a digit among them. */
const EIN_TYPING = /^[\d\s-]*\d[\d\s-]*$/;

/**
 * what the region under the box says. the matches are counted rather than left to the list: the
 * listbox opening is a change of attribute on the box, which a reader is not told about.
 */
function said(state: SearchState): string {
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

export type OrgFinderProps = {
	/** whether this console can ask the IRS list; where it cannot, only a whole EIN does anything. */
	readonly lookups: boolean;
	readonly search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
	/** a whole EIN, in its stored spelling, to look up and lock in; settles once it has. */
	readonly lockIn: (ein: string, signal: AbortSignal) => Promise<void>;
	/** the page is writing, which holds a press and a pick. */
	readonly closed: boolean;
	/** Escape in the box, where there is a form under the finder to go back to. */
	readonly onClose?: (() => void) | undefined;
};

export function OrgFinder({ lookups, search, lockIn, closed, onClose }: OrgFinderProps): ReactNode {
	const [view, setView] = useState<FinderView>(IDLE_VIEW);
	const box = useRef<HTMLInputElement>(null);
	const locking = useEffectEvent(lockIn);

	const watch = useRef<FinderWatch | null>(null);
	useEffect(() => {
		const watching = watchFinder({ search, lockIn: locking, lookups, onView: setView });
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
			box={box}
			onPress={() => {
				if (!closed) watch.current?.press(box.current?.value ?? '');
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
	readonly closed: boolean;
	readonly box?: RefObject<HTMLInputElement | null> | undefined;
	readonly onPress: () => void;
	readonly onPick: (match: NonprofitMatch) => void;
	readonly onClose?: (() => void) | undefined;
};

/** the finder in one view, which is the whole of what it draws. */
export function OrgFinderCard({
	view,
	closed,
	box,
	onPress,
	onPick,
	onClose
}: OrgFinderCardProps): ReactNode {
	const matches = view.found.kind === 'matches' ? view.found.matches : NO_MATCH;
	const collection = useMemo(
		() =>
			createListCollection({
				items: [...matches],
				itemToValue: (match) => match.ein,
				itemToString: (match) => match.name
			}),
		[matches]
	);
	const held = closed || view.out;

	return (
		<search id={FINDER_ID}>
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
					open={matches.length > 0}
					disableLayer
					allowCustomValue
					selectionBehavior="preserve"
					onValueChange={(details) => {
						const match = details.items[0];
						if (match !== undefined) onPick(match);
					}}
				>
					<Combobox.Label className="adm-field__label">{FINDER_LABEL}</Combobox.Label>
					{/* the box and the press that acts on it on one row, which wraps at the floor. */}
					<Combobox.Control className="adm-actions">
						<Combobox.Input
							ref={box}
							className="adm-input"
							maxLength={SEARCH_MOST}
							autoComplete="off"
							onInput={(event: FormEvent<HTMLInputElement>) => {
								if (EIN_TYPING.test(event.currentTarget.value)) {
									spellEin(event.currentTarget, event.nativeEvent);
								}
							}}
							onKeyDown={(event) => {
								if (event.key === 'Escape') onClose?.();
							}}
						/>
						{/* closed as the field's own presses are, so a reader standing on it keeps the focus
					    through a wait that can run to a minute. */}
						<Button
							type="submit"
							aria-busy={view.out || undefined}
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
						{said(view.found)}
					</p>
				</Combobox.Root>
			</form>
		</search>
	);
}

/** the city and the state on one line, as an address is read. */
const placeOf = (match: NonprofitMatch): string =>
	[match.city, match.state].filter((part) => part !== '').join(', ');
