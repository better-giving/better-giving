import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { Button } from '@better-giving/operator/components/controls/Button';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type ReactNode, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import type {
	NonprofitLookupAnswer,
	NonprofitMatch,
	NonprofitSearchAnswer,
	NonprofitStanding
} from '$lib/org/nonprofit-answers';
import {
	ADDRESS_READY,
	addressWait,
	FETCH_ADDRESS,
	FINDER_HINT,
	FINDER_LABEL,
	finderAsk,
	LOOKING_UP,
	LOOKUP_UNAVAILABLE,
	matchCount,
	NOT_LISTED,
	SEARCH_LABEL,
	SEARCH_UNAVAILABLE,
	SEARCHING,
	standingNote,
	TOO_SHORT,
	tooManyLookups
} from './nonprofit-finder';

// Settings' "Find your charity": one box over the IRS list by name or EIN, a Search press beside
// it, and the matches under it, inside the Organisation details card above its boxes. the screen
// (packages/app/src/routes/_app.admin.settings.tsx) makes the calls and fills the boxes from a
// picked match and from a found lookup; this draws the box, the list and what the last press came
// to. what a press asks is ./nonprofit-finder.ts's.
//
// **a pick's address lookup turned away for the rate limit keeps what the pick filled**, says when
// the address can be fetched, and offers the press that fetches it, held until then: a press inside
// the wait is a call the service refuses again.
//
// **it stands inside the details `<form>`, so it is no form of its own**: the press is a plain
// button, and Enter in the box is the press rather than the details form's implicit submit. the box
// has no `name`, so the details save never carries it and conform never reads it.
//
// **the box is ark's combobox, held open while there are matches and run with no layer of its
// own**: the list stands in the card's flow, the machine records no selection (`value` is held
// empty, so a match can be picked again), and a typed value is the deployer's own
// (`allowCustomValue`). the machine moves focus into the box whenever the list opens, so an answer
// opens it only while focus is still inside the finder, and otherwise the list waits for the box to
// be focused.
//
// **ark runs a handler passed to a part before its own**, so Enter is the press only where no
// open list has a match highlighted: over one, the event is left to the machine, which picks it.

/** what the screen is waiting on: a name search, a lookup, or neither. */
export type FinderOut = 'search' | 'lookup' | null;

export type OrgFinderProps = {
	/** the last name search's answer, `undefined` before the first. */
	readonly search: NonprofitSearchAnswer | undefined;
	/** the last lookup's answer, `undefined` before the first. */
	readonly lookup: NonprofitLookupAnswer | undefined;
	/** which call is out; while one is, a press and a pick are held. */
	readonly out: FinderOut;
	/** a name to search, trimmed. */
	readonly onSearch: (query: string) => void;
	/** an EIN typed whole, to look up, in its stored spelling `XX-XXXXXXX`. */
	readonly onLookUp: (ein: string) => void;
	/** a match picked off the list: the boxes it carries are filled, and its address looked up. */
	readonly onPick: (match: NonprofitMatch) => void;
	/** the EIN of the last pick, to look its address up again once a refusal's wait is over. */
	readonly onFetchAddress: (ein: string) => void;
	/** whether the box takes the focus as it is drawn: true where a press opened the finder. */
	readonly autoFocus?: boolean | undefined;
};

/** which press the region under the box answers: the last one made in this finder. */
type Pressed = 'search' | 'lookup' | 'pick' | 'short' | null;

const NO_MATCHES: readonly NonprofitMatch[] = [];

/** the machine's selection, which is never anything: see the header. */
const NO_VALUE: string[] = [];

/**
 * what the region under the box says about the last press. a found lookup says nothing here.
 * `waited` is whether a refused address lookup's wait is over.
 */
function said(
	out: FinderOut,
	pressed: Pressed,
	search: NonprofitSearchAnswer | undefined,
	lookup: NonprofitLookupAnswer | undefined,
	waited: boolean
): string {
	if (out === 'search') return SEARCHING;
	if (out === 'lookup') return LOOKING_UP;
	if (pressed === 'short') return TOO_SHORT;
	const answer = pressed === 'search' ? search : pressed === null ? undefined : lookup;
	switch (answer?.outcome) {
		case undefined:
			return '';
		case 'rate_limited':
			if (pressed !== 'pick') return tooManyLookups(answer.retryAfter);
			return waited ? ADDRESS_READY : addressWait(answer.retryAfter);
		case 'unavailable':
			return answer.kind === 'search' ? SEARCH_UNAVAILABLE : LOOKUP_UNAVAILABLE;
		case 'not_found':
			return NOT_LISTED;
		case 'found':
			return answer.kind === 'search' ? matchCount(answer.matches.length) : '';
	}
}

export function OrgFinder({
	search,
	lookup,
	out,
	onSearch,
	onLookUp,
	onPick,
	onFetchAddress,
	autoFocus = false
}: OrgFinderProps): ReactNode {
	const hintId = `${useId()}-hint`;
	const [typed, setTyped] = useState('');
	const [pressed, setPressed] = useState<Pressed>(null);
	/** whether the matches are drawn as an open list: decided as each answer lands, by where focus is. */
	const [listed, setListed] = useState(false);
	/** the EIN of the last match picked, whose address a refused lookup leaves to fetch. */
	const [picked, setPicked] = useState<string | null>(null);
	/** whether the last press was Fetch the address, so its answer can hand the focus back. */
	const [fetchPressed, setFetchPressed] = useState(false);
	const finder = useRef<HTMLElement>(null);
	const box = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (autoFocus) box.current?.focus();
	}, [autoFocus]);

	// keyed to the answer that landed, so an answer arriving while the deployer is elsewhere on the
	// page leaves the list shut until they are back in the box.
	useEffect(() => {
		if (search === undefined) return;
		setListed(finder.current?.contains(document.activeElement) ?? false);
	}, [search]);

	/** the last pick's address lookup, where the service turned it away for the rate limit. */
	const refused = pressed === 'pick' && lookup?.outcome === 'rate_limited' ? lookup : null;
	const [waitedOn, setWaitedOn] = useState<NonprofitLookupAnswer | null>(null);
	// keyed to the refusal that landed, so each one's own wait is what releases the press.
	useEffect(() => {
		if (refused === null) return;
		const timer = setTimeout(() => setWaitedOn(refused), refused.retryAfter * 1000);
		return () => clearTimeout(timer);
	}, [refused]);
	const waited = refused !== null && waitedOn === refused;

	// the press is drawn only over a refusal, so an answer that is not one takes it away from under
	// the focus: a focus it dropped goes back to the box.
	const handBack = useEffectEvent((answer: NonprofitLookupAnswer | undefined) => {
		if (answer === undefined || answer.outcome === 'rate_limited' || !fetchPressed) return;
		setFetchPressed(false);
		if (document.activeElement === document.body) box.current?.focus();
	});
	useEffect(() => {
		handBack(lookup);
	}, [lookup]);

	const matches = search?.outcome === 'found' ? search.matches : NO_MATCHES;
	const held = out !== null;
	const open = listed && matches.length > 0;
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

	const press = () => {
		if (held) return;
		const ask = finderAsk(typed);
		setPressed(ask.kind);
		if (ask.kind === 'lookup') onLookUp(ask.ein);
		if (ask.kind === 'search') onSearch(ask.query);
	};

	const fetchAddress = () => {
		if (held || !waited || picked === null) return;
		setFetchPressed(true);
		onFetchAddress(picked);
	};

	return (
		<search ref={finder}>
			<Combobox.Root
				className="adm-findorg"
				collection={collection}
				open={open}
				disableLayer
				allowCustomValue
				selectionBehavior="preserve"
				value={NO_VALUE}
				inputValue={typed}
				onInputValueChange={(details) => setTyped(details.inputValue)}
				onValueChange={(details) => {
					const match = details.items[0];
					if (match === undefined) return;
					setPressed('pick');
					setPicked(match.ein);
					onPick(match);
				}}
			>
				<Combobox.Label className="adm-field__label">{FINDER_LABEL}</Combobox.Label>
				<p className="adm-hint" id={hintId}>
					{FINDER_HINT}
				</p>
				{/* the box and the press that acts on it on one row, which wraps at the floor. */}
				<Combobox.Control className="adm-actions">
					<Combobox.Input
						ref={box}
						className="adm-input"
						autoComplete="off"
						aria-describedby={hintId}
						onFocus={() => setListed(true)}
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							if (open && event.currentTarget.hasAttribute('aria-activedescendant')) return;
							event.preventDefault();
							press();
						}}
					/>
					{/* held with `aria-disabled` rather than `disabled`, so a reader standing on it keeps the
					    focus through the wait: one press is one call. */}
					<Button
						type="button"
						aria-busy={held || undefined}
						aria-disabled={held || undefined}
						onClick={press}
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
								<StandingWord standing={match} />
							</span>
							<span className="adm-findrow__ein">
								<span className="adm-findrow__einlabel">EIN</span>
								<span className="adm-num">{match.ein}</span>
							</span>
						</Combobox.Item>
					))}
				</Combobox.Content>
				<p className="adm-hint adm-findorg__said" role="status">
					{said(out, pressed, search, lookup, waited)}
				</p>
				{/* held with `aria-disabled` through the wait and the call, as Search is. */}
				{refused === null ? null : (
					<Button
						type="button"
						aria-busy={held || undefined}
						aria-disabled={held || !waited || undefined}
						onClick={fetchAddress}
					>
						{FETCH_ADDRESS}
					</Button>
				)}
			</Combobox.Root>
		</search>
	);
}

/** the city and the state on one line, as an address is read. */
const placeOf = (match: NonprofitMatch): string =>
	[match.city, match.state].filter((part) => part !== '').join(', ');

/** the one note an organisation's standing draws, or nothing for one listed as tax-deductible. */
export function StandingWord({ standing }: { readonly standing: NonprofitStanding }): ReactNode {
	const note = standingNote(standing);
	if (note === null) return null;
	return note.known ? (
		<StatusWord tone="attention">{note.words}</StatusWord>
	) : (
		<StatusWord unset>{note.words}</StatusWord>
	);
}
