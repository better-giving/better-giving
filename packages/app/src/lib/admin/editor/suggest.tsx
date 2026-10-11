import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { richTextOf } from '$lib/page/suggest-fields';
import {
	RichTextEditor,
	type RichTextEditorProps,
	type RichTextHandle
} from '../rich-text/rich-text-editor';

// a text box the AI can write, in a block's sheet and in a campaign's Name sheet: every box
// $lib/page/suggest-fields.ts names. the press is Write with AI, drawn as its mark and the word
// Write at the end of the box's label row (`labelAside` on the field) — the name starts with the
// word, so a reader saying what they see says its name — and it asks the page's suggest route
// (src/routes/_app.admin.pages.$pageId.suggest.ts) for that one box with the words it holds now,
// and `beside`, the box the words are written for as the sheet holds it. it asks by fetcher, so
// a signed-out operator follows the sign-in redirect; the ask writes nothing, so the editor's
// loaders are not read again after it (`revalidatesAfter` in ./suggest-url.ts).
//
// while the ask is out the press is busy, held with `aria-disabled` so the focus stays on it, and
// the box stays open to typing. the words that land fill the box in place, and the box reads "AI
// suggestion" with Undo beside it until the operator types in it or the block is saved; Undo puts
// back what the box held before the first fill, and hands the focus to the press, since it takes
// itself away. a second ask over a fill keeps that first state for Undo. nothing is saved here: the
// filled words go with the sheet's Done like typed ones. while that Done is out the press is held
// too, and an ask still out when it was pressed is let go, its answer never filling the box: the
// Done posted the words from before it.
//
// the field's polite region (`status`) says, to a reader alone, Writing while the ask is out, AI
// suggestion over a fill and Put back after an Undo. words that could not be written are said in
// it on the screen: the route's own sentence for an answer of `ok: false`, and a line of this
// module's for any other — a 400 or 404 `{ error }` is written for agents and never shown. a new
// ask clears what it said.

const DIDNT_GO_THROUGH = 'That didn’t go through. Try again.';

/** the box an ask is for: the route, the block's id or `page`, the box's name as it posts, and
 *  `beside`, the box its words are written for, as the sheet holds it at the press. */
export type SuggestAsk = {
	readonly url: string;
	readonly block: string;
	readonly field: string;
	readonly beside?: (() => string) | undefined;
};

/** how a box's words are read, filled and put back; `S` is what Undo puts back. */
type SuggestBox<S> = {
	readonly read: () => string;
	readonly keep: () => S;
	readonly fill: (text: string) => void;
	readonly put: (kept: S) => void;
};

/** what a box draws for its suggestion, as a field's own props. */
export type SuggestParts = {
	readonly labelAside: ReactNode;
	readonly status: string;
	readonly statusSaid: string | undefined;
};

type Answer =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly text: string };

function answerOf(landed: unknown): Answer {
	if (typeof landed === 'object' && landed !== null) {
		const { ok, text } = landed as Record<string, unknown>;
		if (typeof ok === 'boolean' && typeof text === 'string') return { ok, text } as Answer;
	}
	return { ok: false, text: DIDNT_GO_THROUGH };
}

/** where a block's save stands: `saved` is its last save that landed, `saving` a Done out now. */
export type Saves = { readonly saved?: unknown; readonly saving: boolean };

/**
 * the press, its word and its Undo for one box, and what the box's region says. `edited` is the
 * box's own change handler, called for the operator's typing and never for a fill.
 */
function useSuggest<S>(
	ask: SuggestAsk,
	box: SuggestBox<S>,
	{ saved, saving }: Saves
): SuggestParts & { readonly edited: () => void } {
	const fetcher = useFetcher<unknown>();
	const asking = fetcher.state !== 'idle';
	const [marked, setMarked] = useState(false);
	const [putBack, setPutBack] = useState(false);
	const [said, setSaid] = useState('');
	const before = useRef<{ readonly kept: S } | null>(null);
	const latest = useRef(box);
	latest.current = box;
	const press = useRef<HTMLButtonElement>(null);
	const fetching = useRef(fetcher);
	fetching.current = fetcher;

	// the Done posted the words from before the answer, so an ask still out goes with it.
	useEffect(() => {
		if (saving && fetching.current.state !== 'idle') fetching.current.reset();
	}, [saving]);

	const landed = asking ? undefined : fetcher.data;
	useEffect(() => {
		if (landed === undefined || landed === null) return;
		const answer = answerOf(landed);
		if (answer.ok) {
			before.current ??= { kept: latest.current.keep() };
			latest.current.fill(answer.text);
			setMarked(true);
		} else {
			setSaid(answer.text);
		}
	}, [landed]);

	useEffect(() => {
		if (saved === null || saved === undefined) return;
		before.current = null;
		setMarked(false);
		setPutBack(false);
	}, [saved]);

	const write = () => {
		setSaid('');
		setPutBack(false);
		const body = new FormData();
		body.set('block', ask.block);
		body.set('field', ask.field);
		body.set('current', latest.current.read());
		if (ask.beside !== undefined) body.set('beside', ask.beside());
		void fetcher.submit(body, { method: 'post', action: ask.url });
	};

	const undo = () => {
		if (before.current !== null) latest.current.put(before.current.kept);
		before.current = null;
		setMarked(false);
		setPutBack(true);
		press.current?.focus();
	};

	const held = asking || saving;
	const shown = marked && !asking;
	return {
		labelAside: (
			<>
				{shown ? <StatusWord>AI suggestion</StatusWord> : null}
				{shown ? (
					<Button
						type="button"
						variant="quiet"
						size="sm"
						mark="undo-2"
						className="adm-field__press"
						onClick={undo}
					>
						Undo
					</Button>
				) : null}
				<Button
					ref={press}
					type="button"
					variant="quiet"
					size="sm"
					mark="sparkles"
					className="adm-field__press"
					aria-label="Write with AI"
					aria-busy={asking}
					aria-disabled={held || undefined}
					onClick={() => {
						if (!held) write();
					}}
				>
					Write
				</Button>
			</>
		),
		status: said,
		statusSaid: asking ? 'Writing' : shown ? 'AI suggestion' : putBack ? 'Put back' : undefined,
		edited: () => {
			before.current = null;
			setMarked(false);
			setPutBack(false);
		}
	};
}

type SuggestedFieldProps = {
	readonly ask: SuggestAsk;
	readonly saves: Saves;
	readonly id: string;
	readonly name: string;
	readonly label: string;
	readonly optional?: boolean;
	readonly hint?: string;
	readonly as?: 'textarea';
	readonly defaultValue: string;
	readonly error: string | null;
};

/** a plain box, uncontrolled as a block's boxes are, that the AI can write. */
export function SuggestedField({ ask, saves, ...field }: SuggestedFieldProps) {
	const element = () =>
		document.getElementById(field.id) as HTMLInputElement | HTMLTextAreaElement | null;
	const words = (text: string) => {
		const box = element();
		if (box !== null) box.value = text;
	};
	const { edited, ...drawn } = useSuggest<string>(
		ask,
		{
			read: () => element()?.value ?? '',
			keep: () => element()?.value ?? '',
			fill: words,
			put: words
		},
		saves
	);
	return <Field {...field} {...drawn} onChange={edited} />;
}

/** a box holding its value in the caller's state — a campaign's name — the AI can write. */
export function useSuggestedValue(
	ask: SuggestAsk,
	value: string,
	setValue: (next: string) => void,
	saving: boolean
): SuggestParts & { readonly edited: () => void } {
	return useSuggest<string>(
		ask,
		{ read: () => value, keep: () => value, fill: setValue, put: setValue },
		{ saving }
	);
}

type SuggestedRichTextProps = Omit<
	RichTextEditorProps,
	'labelAside' | 'status' | 'statusSaid' | 'ref' | 'onChange'
> & {
	readonly ask: SuggestAsk;
	readonly saves: Saves;
};

/** a rich-text box the AI can write, its paragraphs made the box's document by `richTextOf`. */
export function SuggestedRichText({ ask, saves, ...box }: SuggestedRichTextProps) {
	const handle = useRef<RichTextHandle>(null);
	// a fill and an Undo are updates of the editor's like typing, and neither is the operator's.
	const writing = useRef(false);
	const quietly = (change: () => void) => {
		writing.current = true;
		change();
		writing.current = false;
	};
	const { edited, ...drawn } = useSuggest(
		ask,
		{
			read: () => handle.current?.words() ?? '',
			keep: () => handle.current?.kept() ?? null,
			fill: (text) => quietly(() => handle.current?.fill(richTextOf(text))),
			put: (kept) => {
				if (kept !== null) quietly(() => handle.current?.put(kept));
			}
		},
		saves
	);
	return (
		<RichTextEditor
			{...box}
			{...drawn}
			ref={handle}
			onChange={() => {
				if (!writing.current) edited();
			}}
		/>
	);
}
