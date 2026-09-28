import { type ReactNode, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { type FormRejection, RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import {
	DISCARD_FORM_ID,
	FIRST_PUBLISH_FORM_ID,
	GIFTS_GO_TO,
	PUBLISH_FORM_ID,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { resultFor } from '../use-admin-form';
import { DiscardConfirm, FirstPublishConfirm } from './confirms';
import type { BarPress, PublishState } from './publish-bar';

// Publish, Undo and Discard changes as both editors mount them: the bar's props for the three
// presses, and the two confirms while one is up. each press posts to the editor's own action
// (`answerPublishPress` in $lib/server/pages/publish.ts) against the version the editor was drawn
// at, on one fetcher, so the latest press's answer is what the bar reports.
//
// a campaign never published goes through `FirstPublishConfirm` first, which says where its gifts
// go and the address it takes; every other Publish goes at once. "Published" with Undo beside it
// stands while the latest answer is a republish and the draft is still what is live, so the next
// edit takes both down. a press stays held from its post until the revalidation it brings lands,
// and a confirm stays up, held, until its answer does: a refusal is said in it, and a success takes
// it down. a confirm cancelled on a refusal opens again without it.

/** what the editor's action answers the four presses: one of the three, or a refusal. */
type PressAnswer = {
	readonly published?: true;
	readonly undoable?: boolean;
	readonly undone?: true;
	readonly discarded?: true;
	readonly form?: FormRejection;
};

/** where a campaign's first Publish sends its gifts, as its confirm asks it. */
export type FirstPublish = {
	readonly name: string;
	readonly programs: readonly { readonly value: string; readonly label: string }[];
	/** the choice the draft's donation settings hold now. */
	readonly program: string;
	readonly address: string;
};

type Presses = {
	/** `PublishBar`'s props for Publish, Undo and Discard changes. */
	readonly bar: {
		readonly publishing: boolean;
		readonly republished: boolean;
		readonly onPublish: () => void;
		readonly undoing: boolean;
		readonly onUndo: () => void;
		readonly onDiscard: () => void;
		readonly report: { readonly press: BarPress; readonly text: string } | null;
	};
	/** the confirm up, if one is. */
	readonly confirm: ReactNode;
};

const refusalOf = (answer: PressAnswer | undefined, id: string) =>
	resultFor({ id }, answer)?.error?.['']?.[0] ?? null;

export function usePublishPresses({
	version,
	state,
	first
}: {
	readonly version: number;
	readonly state: PublishState;
	/** present while the page is a campaign never published. */
	readonly first?: FirstPublish | undefined;
}): Presses {
	const presses = useFetcher<PressAnswer>({ key: 'page-presses' });
	const [asked, setAsked] = useState<'first-publish' | 'discard' | null>(null);
	/** the answer a confirm was cancelled on, whose refusal it does not open on again. */
	const [cancelledOn, setCancelledOn] = useState<PressAnswer | undefined>(undefined);

	const busy = presses.state !== 'idle';
	const pressing = busy ? presses.formData?.get(WHICH_FORM) : null;
	const answer = busy ? undefined : presses.data;

	// an answer that landed takes its confirm down; a refusal leaves it up, saying why.
	useEffect(() => {
		if (answer?.published || answer?.discarded) setAsked(null);
	}, [answer]);

	const press = (which: string, fields: Record<string, string> = {}) => {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		presses.submit(body, { method: 'post' });
	};

	const republished = answer?.published === true && answer.undoable === true && state === 'live';
	const publishRefusal = refusalOf(answer, PUBLISH_FORM_ID);
	const undoRefusal = refusalOf(answer, UNDO_FORM_ID);

	const cancel = () => {
		setCancelledOn(answer);
		setAsked(null);
	};
	const confirmAnswer = answer === cancelledOn ? undefined : answer;

	let confirm: ReactNode = null;
	if (asked === 'first-publish' && first) {
		confirm = (
			<FirstPublishConfirm
				{...first}
				publishing={pressing === FIRST_PUBLISH_FORM_ID}
				onPublish={(program) => press(FIRST_PUBLISH_FORM_ID, { [GIFTS_GO_TO]: program })}
				onCancel={cancel}
				refusal={refusalOf(confirmAnswer, FIRST_PUBLISH_FORM_ID)}
			/>
		);
	} else if (asked === 'discard') {
		confirm = (
			<DiscardConfirm
				discarding={pressing === DISCARD_FORM_ID}
				onDiscard={() => press(DISCARD_FORM_ID)}
				onCancel={cancel}
				refusal={refusalOf(confirmAnswer, DISCARD_FORM_ID)}
			/>
		);
	}

	return {
		bar: {
			publishing: pressing === PUBLISH_FORM_ID || pressing === FIRST_PUBLISH_FORM_ID,
			republished,
			onPublish: () => (first ? setAsked('first-publish') : press(PUBLISH_FORM_ID)),
			undoing: pressing === UNDO_FORM_ID,
			onUndo: () => press(UNDO_FORM_ID),
			onDiscard: () => setAsked('discard'),
			report:
				publishRefusal !== null
					? { press: 'publish', text: publishRefusal }
					: undoRefusal !== null
						? { press: 'undo', text: undoRefusal }
						: null
		},
		confirm
	};
}
