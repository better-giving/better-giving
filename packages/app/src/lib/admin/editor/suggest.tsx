import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { richTextOf } from '$lib/page/suggest-fields';
import {
	RichTextEditor,
	type RichTextEditorProps,
	type RichTextHandle
} from '../rich-text/rich-text-editor';

// a text box the AI can write, in a block's sheet and in a campaign's Name sheet: every box
// $lib/page/suggest-fields.ts names. the press is Write with AI, drawn as its mark alone at the end
// of the box's label row (`labelAside` on the field), and it asks the page's suggest route
// (src/routes/_app.admin.pages.$pageId.suggest.ts) for that one box with the words it holds now.
// it is a plain `fetch`, so nothing on the editor is read again when it lands: the ask writes
// nothing.
//
// while the ask is out the press is busy, held with `aria-disabled` so the focus stays on it, and
// the box stays open to typing. the words that land fill the box in place, and the box reads "AI
// suggestion" with Undo beside it until the operator types in it or the block is saved; Undo puts
// back what the box held before the first fill, and hands the focus to the press, since it takes
// itself away. a second ask over a fill keeps that first state for Undo. nothing is saved here: the
// filled words go with the sheet's Done like typed ones.
//
// words that could not be written are said under the box, in the field's polite region (`status`):
// the route's own sentence for an answer of `ok: false`, its `error` for a 4xx, and a line of this
// module's for a request that never came back with either. the region also tells a reader alone
// that the box was filled. a new ask clears what it said.

const DIDNT_GO_THROUGH = 'That didn’t go through. Try again.';

/** the suggest route for the page `pageId`. */
export const suggestUrl = (pageId: string) => `/admin/pages/${pageId}/suggest`;

/** the box an ask is for: the route, the block's id or `page`, and the box's name as it posts. */
export type SuggestAsk = { readonly url: string; readonly block: string; readonly field: string };

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

async function askFor(ask: SuggestAsk, current: string, signal: AbortSignal): Promise<Answer> {
	const body = new FormData();
	body.set('block', ask.block);
	body.set('field', ask.field);
	body.set('current', current);
	try {
		const response = await fetch(ask.url, { method: 'POST', body, signal });
		const read: unknown = await response.json();
		if (typeof read === 'object' && read !== null) {
			const { ok, text, error } = read as Record<string, unknown>;
			if (typeof ok === 'boolean' && typeof text === 'string') return { ok, text } as Answer;
			if (typeof error === 'string') return { ok: false, text: error };
		}
	} catch {
		// a request that never answered, or answered with no body this route writes.
	}
	return { ok: false, text: DIDNT_GO_THROUGH };
}

/**
 * the press, its word and its Undo for one box, and what the box's region says. `saved` is the
 * block's last save that landed, whose arrival clears the mark; `edited` is the box's own change
 * handler, called for the operator's typing and never for a fill.
 */
function useSuggest<S>(
	ask: SuggestAsk,
	box: SuggestBox<S>,
	saved: unknown
): SuggestParts & { readonly edited: () => void } {
	const [asking, setAsking] = useState(false);
	const [marked, setMarked] = useState(false);
	const [said, setSaid] = useState('');
	const before = useRef<{ readonly kept: S } | null>(null);
	const latest = useRef(box);
	latest.current = box;
	const press = useRef<HTMLButtonElement>(null);
	const out = useRef<AbortController | null>(null);
	useEffect(() => () => out.current?.abort(), []);

	useEffect(() => {
		if (saved === null || saved === undefined) return;
		before.current = null;
		setMarked(false);
	}, [saved]);

	const write = async () => {
		setAsking(true);
		setSaid('');
		const controller = new AbortController();
		out.current = controller;
		const answer = await askFor(ask, latest.current.read(), controller.signal);
		if (controller.signal.aborted) return;
		if (answer.ok) {
			before.current ??= { kept: latest.current.keep() };
			latest.current.fill(answer.text);
		} else {
			setSaid(answer.text);
		}
		setMarked(before.current !== null);
		setAsking(false);
	};

	const undo = () => {
		if (before.current !== null) latest.current.put(before.current.kept);
		before.current = null;
		setMarked(false);
		press.current?.focus();
	};

	const shown = marked && !asking;
	return {
		labelAside: (
			<>
				{shown ? <StatusWord>AI suggestion</StatusWord> : null}
				{shown ? (
					<Button type="button" variant="quiet" size="sm" mark="undo-2" onClick={undo}>
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
					aria-disabled={asking || undefined}
					onClick={() => {
						if (!asking) void write();
					}}
				/>
			</>
		),
		status: said,
		statusSaid: shown ? 'AI suggestion' : undefined,
		edited: () => {
			before.current = null;
			setMarked(false);
		}
	};
}

type SuggestedFieldProps = {
	readonly ask: SuggestAsk;
	/** the block's last save that landed. */
	readonly saved?: unknown;
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
export function SuggestedField({ ask, saved, ...field }: SuggestedFieldProps) {
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
		saved
	);
	return <Field {...field} {...drawn} onChange={edited} />;
}

/** a box holding its value in the caller's state — a name, a photo's description — the AI can write. */
export function useSuggestedValue(
	ask: SuggestAsk,
	value: string,
	setValue: (next: string) => void,
	saved?: unknown
): SuggestParts & { readonly edited: () => void } {
	return useSuggest<string>(
		ask,
		{ read: () => value, keep: () => value, fill: setValue, put: setValue },
		saved
	);
}

type SuggestedRichTextProps = Omit<
	RichTextEditorProps,
	'labelAside' | 'status' | 'statusSaid' | 'ref' | 'onChange'
> & {
	readonly ask: SuggestAsk;
	readonly saved?: unknown;
};

/** a rich-text box the AI can write, its paragraphs made the box's document by `richTextOf`. */
export function SuggestedRichText({ ask, saved, ...box }: SuggestedRichTextProps) {
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
		saved
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
