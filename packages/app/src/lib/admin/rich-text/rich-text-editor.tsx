import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { MarkName } from '@better-giving/operator/components/status/Mark';
import {
	type Editor,
	EditorContent,
	type JSONContent,
	useEditor,
	useEditorState
} from '@tiptap/react';
import {
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';
import { parseRichText, type RichTextDocument } from '$lib/rich-text/document';
import { RichText } from '$lib/rich-text/render';
import { linkRefusal, normaliseAddress, RICH_TEXT_EXTENSIONS } from './extensions';

/* a rich-text box in an ordinary form: bold, italic, the two lists and links, and nothing else.

   what it posts is the document, as JSON, in a hidden input under `name` — the rule's parsed value
   ($lib/rich-text/document.ts), and the editor's own JSON only where the rule refuses it (a
   document past `TEXT_MAX`), so the action's parse says why. the input carries a value from the
   first server render on, the blank document when nothing is written, so the box always arrives
   (CLAUDE.md → Forms).

   the presses are one toolbar and one tab stop: the arrow keys, Home and End move along it. a
   press made from the keyboard keeps the focus on the toolbar so a second can follow; a press
   made with a pointer never takes the focus out of the words. each press that is a mark or a list
   says whether the words at the caret carry it.

   a link is made at an address row under the words, opened by the Link press: the address is
   typed by a person, repaired where that is unambiguous (./extensions.ts's `normaliseAddress`),
   and refused at the row with the rule's own reason otherwise. Enter applies it and Escape leaves
   the row without posting anything — the row sits inside the caller's form and must not submit
   it. going back into the words closes the row. */

export type RichTextEditorProps = {
	/** the form field the document posts under. */
	name: string;
	label: string;
	/** marks the label as a box that may be left blank. */
	optional?: boolean;
	defaultValue?: RichTextDocument;
	/** each change the rule accepts, as the parsed document. */
	onChange?: (doc: RichTextDocument) => void;
	/** ids of the caller's own sentences about the box, such as a hint. */
	describedBy?: string;
	/** the refusal the action answered with, drawn in the field's own error row and marking the
	 *  box refused. */
	error?: ReactNode;
	/** the editable's id, so a caller can move the focus onto it once a refusal arrives. it is on
	 *  the page from the editor's first client render; the server render has no editable to carry it. */
	id?: string;
};

const BLANK: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

type PressId = 'bold' | 'italic' | 'bulletList' | 'orderedList' | 'link';
type Press = { id: PressId; label: string; mark: MarkName };

const GROUPS: readonly (readonly [Press, ...Press[]])[] = [
	[
		{ id: 'bold', label: 'Bold', mark: 'bold' },
		{ id: 'italic', label: 'Italic', mark: 'italic' }
	],
	[
		{ id: 'bulletList', label: 'Bulleted list', mark: 'list' },
		{ id: 'orderedList', label: 'Numbered list', mark: 'list-ordered' }
	],
	[{ id: 'link', label: 'Link', mark: 'link' }]
];
const PRESSES = GROUPS.flat();

type LinkRow = {
	address: string;
	/** the caret is in a link already, so Apply changes its address and Remove is offered. */
	existing: boolean;
	refusal: string | null;
	/** Apply has been pressed once, so the address is re-checked as it is corrected. */
	tried: boolean;
};

function serialise(editor: Editor) {
	const json = editor.getJSON();
	const parsed = parseRichText(json);
	return parsed.ok
		? { doc: parsed.doc, value: JSON.stringify(parsed.doc) }
		: { doc: null, value: JSON.stringify(json) };
}

function refusalOf(typed: string) {
	const href = normaliseAddress(typed);
	return href === '' ? 'required' : linkRefusal(href);
}

function contentAttributes(
	id: string | undefined,
	labelId: string,
	describedBy: string | undefined,
	refused: boolean
) {
	return {
		class: 'adm-rte__content',
		role: 'textbox',
		'aria-multiline': 'true',
		'aria-labelledby': labelId,
		...(id === undefined ? {} : { id }),
		...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
		...(refused ? { 'aria-invalid': 'true' } : {})
	};
}

export function RichTextEditor({
	name,
	label,
	optional,
	defaultValue,
	onChange,
	describedBy,
	error,
	id
}: RichTextEditorProps) {
	const own = useId();
	const labelId = `${own}-label`;
	const errorId = `${own}-err`;
	const rowId = `${own}-link`;
	const addressId = `${own}-address`;
	const refused = Boolean(error);
	const described =
		[describedBy, refused ? errorId : undefined].filter(Boolean).join(' ') || undefined;
	const initial = defaultValue ?? BLANK;

	const [value, setValue] = useState(() => JSON.stringify(initial));
	const [row, setRow] = useState<LinkRow | null>(null);
	const [rover, setRover] = useState(0);
	const presses = useRef<(HTMLButtonElement | null)[]>([]);

	// built after hydration: until then the words stand in the same box as plain elements.
	const editor = useEditor({
		extensions: RICH_TEXT_EXTENSIONS,
		// the rule's type is a narrowing of tiptap's; only an optional key's `| undefined` differs.
		content: initial as JSONContent,
		immediatelyRender: false,
		editorProps: { attributes: contentAttributes(id, labelId, described, refused) }
	});

	const active = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor === null
				? null
				: {
						bold: editor.isActive('bold'),
						italic: editor.isActive('italic'),
						bulletList: editor.isActive('bulletList'),
						orderedList: editor.isActive('orderedList'),
						link: editor.isActive('link')
					}
	});

	useEffect(() => {
		editor?.setOptions({
			editorProps: { attributes: contentAttributes(id, labelId, described, refused) }
		});
	}, [editor, id, labelId, described, refused]);

	useEffect(() => {
		if (editor === null) return;
		const update = () => {
			const next = serialise(editor);
			setValue(next.value);
			if (next.doc !== null) onChange?.(next.doc);
		};
		const close = () => setRow(null);
		editor.on('update', update);
		editor.on('focus', close);
		return () => {
			editor.off('update', update);
			editor.off('focus', close);
		};
	}, [editor, onChange]);

	const rowOpen = row !== null;
	useEffect(() => {
		if (rowOpen) document.getElementById(addressId)?.focus();
	}, [rowOpen, addressId]);

	const openRow = () => {
		if (editor === null) return;
		if (row !== null) {
			document.getElementById(addressId)?.focus();
			return;
		}
		const href: unknown = editor.getAttributes('link').href;
		const existing = typeof href === 'string';
		setRow({ address: existing ? href : '', existing, refusal: null, tried: false });
	};

	const press = (pressed: PressId) => {
		if (editor === null) return;
		const chain = editor.chain();
		if (pressed === 'bold') chain.toggleBold().run();
		else if (pressed === 'italic') chain.toggleItalic().run();
		else if (pressed === 'bulletList') chain.toggleBulletList().run();
		else if (pressed === 'orderedList') chain.toggleOrderedList().run();
		else openRow();
	};

	const apply = () => {
		if (editor === null || row === null) return;
		const refusal = refusalOf(row.address);
		if (refusal !== null) {
			setRow({ ...row, refusal, tried: true });
			document.getElementById(addressId)?.focus();
			return;
		}
		const href = normaliseAddress(row.address);
		const chain = editor.chain().focus();
		if (row.existing || !editor.state.selection.empty) {
			chain.extendMarkRange('link').setLink({ href }).run();
		} else {
			chain
				.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
				.run();
		}
		setRow(null);
	};

	const remove = () => {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run();
		setRow(null);
	};

	const leaveRow = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			apply();
		} else if (event.key === 'Escape') {
			// the row closes and nothing around it does: a sheet this box stands in closes on Escape too.
			event.preventDefault();
			event.stopPropagation();
			setRow(null);
			editor?.commands.focus();
		}
	};

	const rove = (event: KeyboardEvent<HTMLDivElement>) => {
		const last = PRESSES.length - 1;
		const next =
			event.key === 'ArrowRight'
				? rover === last
					? 0
					: rover + 1
				: event.key === 'ArrowLeft'
					? rover === 0
						? last
						: rover - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: null;
		if (next === null) return;
		event.preventDefault();
		setRover(next);
		presses.current[next]?.focus();
	};

	return (
		<div className="adm-field">
			<span className="adm-field__label" id={labelId}>
				{label}
				{optional ? <span className="adm-field__optional"> (optional)</span> : null}
			</span>
			<div className="adm-rte">
				<div
					className="adm-rte__bar"
					role="toolbar"
					aria-label={`${label} formatting`}
					onKeyDown={rove}
				>
					{GROUPS.map((group, groupIndex) => (
						<Fragment key={group[0].id}>
							{groupIndex === 0 ? null : <span className="adm-rte__sep" aria-hidden="true" />}
							{group.map((each) => {
								const at = PRESSES.indexOf(each);
								return (
									<Button
										key={each.id}
										ref={(button: HTMLButtonElement | null) => {
											presses.current[at] = button;
										}}
										type="button"
										variant="quiet"
										size="sm"
										mark={each.mark}
										aria-label={each.label}
										aria-pressed={active?.[each.id] ?? false}
										aria-controls={each.id === 'link' && row !== null ? rowId : undefined}
										tabIndex={at === rover ? 0 : -1}
										onFocus={() => setRover(at)}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => press(each.id)}
									/>
								);
							})}
						</Fragment>
					))}
				</div>
				{editor === null ? (
					<div className="adm-rte__content">
						<RichText doc={initial} />
					</div>
				) : (
					<EditorContent editor={editor} />
				)}
				{row === null ? null : (
					<div className="adm-rte__link" id={rowId}>
						<Field
							id={addressId}
							label="Link address"
							value={row.address}
							error={row.refusal}
							inputMode="url"
							autoCapitalize="none"
							autoComplete="off"
							spellCheck={false}
							onChange={(event) => {
								const address = event.currentTarget.value;
								setRow({ ...row, address, refusal: row.tried ? refusalOf(address) : null });
							}}
							onKeyDown={leaveRow}
							beside={
								<>
									{row.existing ? (
										<Button type="button" size="sm" onClick={remove}>
											Remove link
										</Button>
									) : null}
									<Button type="button" size="sm" variant="primary" onClick={apply}>
										Apply
									</Button>
								</>
							}
						/>
					</div>
				)}
			</div>
			{refused ? <FieldMessage id={errorId}>{error}</FieldMessage> : null}
			<input type="hidden" name={name} value={value} />
		</div>
	);
}
