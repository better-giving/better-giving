import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';

// the one way an editor part writes the page's draft: a press posted to the editor route's action
// (`saveBlockForm` in $lib/server/pages/blocks.ts, `savePageSetting` in
// $lib/server/pages/page-settings.ts) through a fetcher, against the page's version the editor holds
// at the press, so the editor does not navigate. a landed write moves that version, which reloads
// the preview and redraws the part from the draft.
//
// a part's presses share the one fetcher, and a press made while another is in flight is turned
// away: the second would carry the version the first is about to move, and be refused as stale.
// what is in flight is readable (`sending`), so a picture or a chip is drawn as the press asked
// until it is answered, and as the draft holds once it is.
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
	const busy = fetcher.state !== 'idle';
	const sent = busy ? fetcher.formData : undefined;
	const answer = busy ? undefined : fetcher.data;
	// taken at the press and let go on the render its answer lands in — `busy` going out after it
	// came in — so a second press made before the fetcher's state says it is busy is turned away too.
	const held = useRef(false);
	const wasBusy = useRef(false);
	useEffect(() => {
		if (busy) wasBusy.current = true;
		else if (wasBusy.current) {
			wasBusy.current = false;
			held.current = false;
		}
	}, [busy]);

	/** the first sentence the last answer refused `form` with under `box` — `''` is the form's own. */
	const refused = (form: string, box: string): string | null =>
		resultFor({ id: form }, answer)?.error?.[box]?.[0] ?? null;

	return {
		/** a press is in flight, and the part's presses are held until it is answered. */
		busy,
		/** posts `form` with its boxes and the version; turned away while a press is in flight. */
		press(form: string, boxes: PressBoxes = []) {
			if (busy || held.current) return;
			held.current = true;
			const body = new FormData();
			body.set(WHICH_FORM, form);
			body.set(RECORD_VERSION, String(version));
			for (const [box, value] of boxes) body.append(box, value);
			setPressed(form);
			fetcher.submit(body, { method: 'post' });
		},
		/** every value the press in flight posts under `box`, while it is `form`'s; else null. */
		sending(form: string, box: string): string[] | null {
			if (sent?.get(WHICH_FORM) !== form) return null;
			return sent.getAll(box).filter((value) => typeof value === 'string');
		},
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
