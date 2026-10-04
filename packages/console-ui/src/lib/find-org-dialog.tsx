import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';
import { SEARCH_MOST, type SearchState, type SearchWatch, watchSearch } from './org-search';

// "Find your organisation": one box over the IRS list by name or EIN, the matches under it, and a
// pick that fills the Legal details fold (./org-fold.tsx, which opens this and answers the pick).
//
// **the dialog is the operator `Modal` and the box is ark's combobox, each left to do its own
// job.** the card's lift, its focus on opening and the focus handed back on closing are
// `@better-giving/operator/behaviour/Dialog`'s; the listbox roles, `aria-activedescendant`, the
// arrow keys and Enter are the machine's. the list is drawn in the card rather than floated over
// it, so the machine is held open while there are matches and runs with no layer of its own — its
// Escape would otherwise be its own and never reach the card, so the box hands Escape to the same
// dismissal the card's ground and its two ways out answer with.
//
// **the list is the IRS list's answer, unfiltered here.** what is asked, and when, is
// ./org-search.ts's; the matches arrive filtered and in the API's order.
//
// **every way out but a pick closes to the plain form with nothing filled.** the by-hand way is
// the card's commit and is quiet beside the matches, and it takes the primary rank once the list
// could not be searched, because then it is the next press.

export const FIND_ORG_TITLE = 'Find your organisation';
export const BY_HAND = "I can't find it, I'll type the details";
export const NOT_NOW = 'Not now';
export const SEARCHING = 'Searching…';
export const NO_MATCHES = 'No matches.';
export const SEARCH_UNANSWERED = "Couldn't search the IRS list. Type the details yourself.";
export const NOT_DEDUCTIBLE_BADGE = 'Not listed as tax-deductible';
export const REVOKED_BADGE = 'Status revoked';

/**
 * what the region under the box says in each state. the matches are counted rather than left to the
 * list: the listbox opening is a change of attribute on the box, which a reader is not told about.
 */
function said(state: SearchState): string {
	switch (state.kind) {
		case 'idle':
			return '';
		case 'searching':
			return SEARCHING;
		case 'matches':
			return state.matches.length === 1 ? '1 match.' : `${state.matches.length} matches.`;
		case 'none':
			return NO_MATCHES;
		case 'unavailable':
			return SEARCH_UNANSWERED;
	}
}

const NO_MATCH: readonly NonprofitMatch[] = [];

export type FindOrgDialogProps = {
	readonly search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
	/** a match was taken; the caller closes the card and fills the fold from it. */
	readonly onPick: (match: NonprofitMatch) => void;
	/** Not now, the by-hand way, Escape and a press on the ground: close with nothing filled. */
	readonly onClose: () => void;
	/** where focus lands when nothing pressed opened the card — a fresh set-up opens it itself. */
	readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
};

export function FindOrgDialog({
	search,
	onPick,
	onClose,
	fallbackFocus
}: FindOrgDialogProps): ReactNode {
	const [state, setState] = useState<SearchState>({ kind: 'idle' });
	const watch = useRef<SearchWatch | null>(null);
	useEffect(() => {
		const watching = watchSearch({ search, onState: setState });
		watch.current = watching;
		return () => {
			watching.stop();
			watch.current = null;
		};
	}, [search]);

	return (
		<FindOrgCard
			state={state}
			onQuery={(query) => watch.current?.typed(query)}
			onPick={onPick}
			onClose={onClose}
			fallbackFocus={fallbackFocus}
		/>
	);
}

export type FindOrgCardProps = Omit<FindOrgDialogProps, 'search'> & {
	readonly state: SearchState;
	/** the box now holds this. */
	readonly onQuery: (query: string) => void;
};

/** the card in one search state, which is the whole of what the dialog draws. */
export function FindOrgCard({
	state,
	onQuery,
	onPick,
	onClose,
	fallbackFocus
}: FindOrgCardProps): ReactNode {
	const matches = state.kind === 'matches' ? state.matches : NO_MATCH;
	const collection = useMemo(
		() =>
			createListCollection({
				items: [...matches],
				itemToValue: (match) => match.ein,
				itemToString: (match) => match.name
			}),
		[matches]
	);

	return (
		<Modal
			title={FIND_ORG_TITLE}
			onDismiss={onClose}
			fallbackFocus={fallbackFocus}
			commit={BY_HAND}
			commitProps={{
				type: 'button',
				variant: state.kind === 'unavailable' ? 'primary' : 'quiet',
				onClick: onClose
			}}
			cancel={NOT_NOW}
			cancelProps={{ type: 'button', onClick: onClose }}
		>
			<Combobox.Root
				className="adm-findorg"
				collection={collection}
				open={matches.length > 0}
				disableLayer
				selectionBehavior="preserve"
				onInputValueChange={(details) => {
					if (details.reason === 'input-change') onQuery(details.inputValue);
				}}
				onValueChange={(details) => {
					const match = details.items[0];
					if (match !== undefined) onPick(match);
				}}
			>
				<Combobox.Label className="adm-field__label">Name or EIN</Combobox.Label>
				<Combobox.Control>
					<Combobox.Input
						className="adm-input"
						maxLength={SEARCH_MOST}
						onKeyDown={(event) => {
							if (event.key === 'Escape') onClose();
						}}
					/>
				</Combobox.Control>
				<Combobox.Content className="adm-findlist">
					{matches.map((match) => (
						<Combobox.Item key={match.ein} item={match} className="adm-findrow" persistFocus>
							<span className="adm-findrow__who">
								<Combobox.ItemText className="adm-findrow__name">{match.name}</Combobox.ItemText>
								<span className="adm-findrow__place">{placeOf(match)}</span>
								<MatchBadge match={match} />
							</span>
							<span className="adm-findrow__ein">
								<span className="adm-findrow__einlabel">EIN</span>
								<span className="adm-num">{einAsPrinted(match.ein)}</span>
							</span>
						</Combobox.Item>
					))}
				</Combobox.Content>
				<p className="adm-hint adm-findorg__said" role="status">
					{said(state)}
				</p>
			</Combobox.Root>
		</Modal>
	);
}

/** the city and the state on one line, as an address is read. */
const placeOf = (match: NonprofitMatch): string =>
	[match.city, match.state].filter((part) => part !== '').join(', ');

/** the one badge a match carries, where one applies: a revocation outranks not being deductible. */
function MatchBadge({ match }: { match: NonprofitMatch }): ReactNode {
	if (match.revokedOn !== '') return <StatusWord tone="blocker">{REVOKED_BADGE}</StatusWord>;
	if (!match.deductible) return <StatusWord tone="attention">{NOT_DEDUCTIBLE_BADGE}</StatusWord>;
	return null;
}
