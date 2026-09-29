import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { type FormRejection, RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import {
	DISCARD_FORM_ID,
	FIRST_PUBLISH_FORM_ID,
	GIFTS_GO_TO,
	PUBLISH_FORM_ID,
	RESET_FORM_ID,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { resultFor } from '../use-admin-form';
import { DiscardConfirm, FirstPublishConfirm, ResetConfirm } from './confirms';
import type { BarPress, PublishState } from './publish-bar';

// Publish, Undo and Discard changes as both editors mount them, and the Donation page's Reset to
// default: the bar's props for the presses, and the confirms while one is up. each press posts to
// the editor's own action (`answerPublishPress` in $lib/server/pages/publish.ts, `answerResetPress`
// in $lib/server/pages/reset.ts) against the version the editor was drawn at, on one fetcher, so the
// latest press's answer is what the bar reports.
//
// a campaign never published goes through `FirstPublishConfirm` first, which says where its gifts
// go and the address it takes; every other Publish goes at once. "Published" with Undo beside it
// stands while the latest answer is a republish and the draft is still what is live, so the next
// edit takes both down. a press stays held from its post until the revalidation it brings lands,
// and a confirm stays up, held, until its answer does: a refusal is said in it, and a success takes
// it down. a confirm cancelled on a refusal opens again without it. a Reset, a Discard or an Undo
// that lands takes its press off the bar (a Reset or a Discard with its confirm), so the focus goes
// to the bar's state word (`statusRef`) once any confirm is down — before then the page behind it
// is inert.

/** what the editor's action answers the presses: what one did, or a refusal. */
type PressAnswer = {
	readonly published?: true;
	readonly undoable?: boolean;
	readonly undone?: true;
	readonly discarded?: true;
	readonly reset?: true;
	readonly form?: FormRejection;
};

/** where a campaign's first Publish sends its gifts, as its confirm asks it. */
export type FirstPublish = {
	readonly name: string;
	readonly programs: readonly { readonly value: string; readonly label: string }[];
	/** the choice the draft's donation settings hold now. */
	readonly program: string;
	readonly address: string;
	/** the address the campaign's name asked for, where another page holds it. */
	readonly asked?: string | undefined;
};

type Presses = {
	/** `PublishBar`'s props for Publish, Undo, Discard changes and Reset to default. */
	readonly bar: {
		readonly publishing: boolean;
		readonly republished: boolean;
		readonly onPublish: () => void;
		readonly undoing: boolean;
		readonly onUndo: () => void;
		readonly onDiscard: () => void;
		readonly reset: { readonly hasEdits: boolean; readonly onReset: () => void } | undefined;
		readonly report: { readonly press: BarPress; readonly text: string } | null;
		readonly statusRef: RefObject<HTMLSpanElement | null>;
	};
	/** the confirm up, if one is. */
	readonly confirm: ReactNode;
};

const refusalOf = (answer: PressAnswer | undefined, id: string) =>
	resultFor({ id }, answer)?.error?.['']?.[0] ?? null;

export function usePublishPresses({
	version,
	state,
	first,
	reset
}: {
	readonly version: number;
	readonly state: PublishState;
	/** present while the page is a campaign never published. */
	readonly first?: FirstPublish | undefined;
	/** the Donation page's alone: whether it has edits to reset. */
	readonly reset?: { readonly hasEdits: boolean } | undefined;
}): Presses {
	const presses = useFetcher<PressAnswer>({ key: 'page-presses' });
	const [asked, setAsked] = useState<'first-publish' | 'discard' | 'reset' | null>(null);
	/** the answer a confirm was cancelled on, whose refusal it does not open on again. */
	const [cancelledOn, setCancelledOn] = useState<PressAnswer | undefined>(undefined);
	/** the Reset, Discard or Undo answer that took its press away, which hands the focus to the state word. */
	const [pressGoneOn, setPressGoneOn] = useState<PressAnswer | undefined>(undefined);
	const statusRef = useRef<HTMLSpanElement>(null);

	const busy = presses.state !== 'idle';
	const pressing = busy ? presses.formData?.get(WHICH_FORM) : null;
	const answer = busy ? undefined : presses.data;

	// an answer that landed takes its confirm down; a refusal leaves it up, saying why.
	useEffect(() => {
		if (answer?.published || answer?.discarded || answer?.reset) setAsked(null);
		if (answer?.discarded || answer?.reset || answer?.undone) setPressGoneOn(answer);
	}, [answer]);

	// runs in the commit that takes the confirm down, after the confirm's own cleanup has let go of
	// the page.
	useEffect(() => {
		if (pressGoneOn !== undefined) statusRef.current?.focus();
	}, [pressGoneOn]);

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
	} else if (asked === 'reset') {
		confirm = (
			<ResetConfirm
				resetting={pressing === RESET_FORM_ID}
				onReset={() => press(RESET_FORM_ID)}
				onCancel={cancel}
				refusal={refusalOf(confirmAnswer, RESET_FORM_ID)}
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
			reset: reset && { hasEdits: reset.hasEdits, onReset: () => setAsked('reset') },
			report:
				publishRefusal !== null
					? { press: 'publish', text: publishRefusal }
					: undoRefusal !== null
						? { press: 'undo', text: undoRefusal }
						: null,
			statusRef
		},
		confirm
	};
}
