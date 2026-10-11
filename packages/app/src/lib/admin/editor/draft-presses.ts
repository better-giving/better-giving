import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';

// the one way an editor part writes the page's draft: a press posted to the editor route's action
// (`saveBlockForm` in $lib/server/pages/blocks.ts, `savePageSetting` in
// $lib/server/pages/page-settings.ts) through a fetcher, against the page's version the editor holds
// at the press, so the editor does not navigate. a landed write moves that version, which reloads
// the preview and redraws the part from the draft.
//
// a part's presses share the one fetcher, and a press made while another is in flight waits: sent
// then, it would carry the version the first is about to move, and be refused as stale. the last
// press made during the round trip is kept, and sent once the answer lands, at the version that
// answer moved the page to; an earlier one kept is dropped for it, so a run of picks lands as the
// last of them. what is kept, or else what is in flight, is readable (`sending`), so a picture or a
// chip is drawn as the press asked until it is answered, and as the draft holds once it is.
//
// the fetcher is unkeyed, so an answer does not outlive the part that asked: a sheet reopened starts
// with none. a part the editor holds for as long as it is up lets go of an answer with `startClean`.

/** what the editor's action answers a press: what landed, or the form's refusal. */
export type DraftAnswer = AdminActionData & {
	readonly saved?: string;
	/** the block a landed Add a block put on the page. */
	readonly blockId?: string;
};

/** a press's boxes, each posted in turn, so a box named twice posts twice. */
export type PressBoxes = readonly (readonly [string, string])[] | FormData;

export function useDraftPresses(version: number) {
	const fetcher = useFetcher<DraftAnswer>();
	/** the form the last press posted, which is the form the answer standing now is to. */
	const [pressed, setPressed] = useState<string | null>(null);
	/** the last press made while another was in flight, waiting for that one's answer. */
	const [kept, setKept] = useState<{ readonly form: string; readonly body: FormData } | null>(null);
	const busy = fetcher.state !== 'idle';
	const sent = busy ? fetcher.formData : undefined;
	const answer = busy ? undefined : fetcher.data;

	// taken at the press and let go on the render its answer lands in — `busy` going out after it
	// came in — so a second press made before the fetcher's state says it is busy waits too. that
	// render holds the version the answer moved the page to, which is what a kept press goes at.
	const held = useRef(false);
	const wasBusy = useRef(false);

	const send = (form: string, boxes: PressBoxes) => {
		held.current = true;
		const body = new FormData();
		body.set(WHICH_FORM, form);
		body.set(RECORD_VERSION, String(version));
		for (const [box, value] of boxes) body.append(box, value);
		setPressed(form);
		fetcher.submit(body, { method: 'post' });
	};

	const land = useEffectEvent(() => {
		held.current = false;
		if (kept === null) return;
		setKept(null);
		send(kept.form, kept.body);
	});
	useEffect(() => {
		if (busy) wasBusy.current = true;
		else if (wasBusy.current) {
			wasBusy.current = false;
			land();
		}
	}, [busy]);

	/** the first sentence the last answer refused `form` with under `box` — `''` is the form's own. */
	const refused = (form: string, box: string): string | null =>
		resultFor({ id: form }, answer)?.error?.[box]?.[0] ?? null;

	return {
		/** a press is in flight, and a press made now waits for its answer. */
		busy,
		/** posts `form` with its boxes and the version; kept until the answer to a press in flight lands. */
		press(form: string, boxes: PressBoxes = []) {
			if (!busy && !held.current) {
				send(form, boxes);
				return;
			}
			const body = new FormData();
			for (const [box, value] of boxes) body.append(box, value);
			setKept({ form, body });
		},
		/** every value under `box` of the press kept, or else of the one in flight, while it is `form`'s; else null. */
		sending(form: string, box: string): string[] | null {
			const asking = kept?.form === form ? kept.body : sent?.get(WHICH_FORM) === form ? sent : null;
			if (asking == null) return null;
			return asking.getAll(box).filter((value) => typeof value === 'string');
		},
		/** the press in flight is `form`'s. */
		flying: (form: string) => sent?.get(WHICH_FORM) === form,
		refused,
		/** the sentence under `box`, or else the form's own. */
		said: (form: string, box: string) => refused(form, box) ?? refused(form, ''),
		/** the last press was `form`'s, and it landed. */
		landed: (form: string) => answer?.saved !== undefined && pressed === form,
		answer,
		startClean() {
			if (!busy) fetcher.reset();
		}
	};
}

export type DraftPresses = ReturnType<typeof useDraftPresses>;
