import type { Editor } from '@tiptap/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, onTestFinished } from 'vitest';
import { useFocusOnRefusal } from '$lib/admin/editor/done-sheet';
import { LIST_DEPTH_MAX, parseRichText, type RichTextDocument } from '$lib/rich-text/document';
import { RichTextEditor, type RichTextEditorProps } from './rich-text-editor';

// what the editor posts and how its presses behave, never how it looks: every press leaves a
// document the rich-text rule accepts in the hidden input, a link address the rule refuses is
// refused at the address row, and the toolbar is one tab stop walked by the arrow keys. the look is
// the design's and is read on a screen.
//
// typing is stood in for by the editor's own commands, reached through the element tiptap hangs it
// on: happy-dom has no input pipeline for a contenteditable, and what is asserted is what the
// presses and the form see, not how keystrokes become text.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(props: Partial<RichTextEditorProps> = {}) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	const rerender = async (next: Partial<RichTextEditorProps>) => {
		await act(async () => {
			root.render(<RichTextEditor name="mission" label="Mission" {...next} />);
		});
	};
	await rerender(props);
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	const content = one<HTMLElement & { editor?: Editor }>(host, '[role="textbox"]');
	const editor = content.editor;
	if (editor === undefined) throw new Error('the editor never mounted on its content element');
	return { host, editor, content, rerender };
}

function one<T extends Element>(host: HTMLElement, selector: string): T {
	const found = host.querySelector<T>(selector);
	if (found === null) throw new Error(`nothing on the page matches ${selector}`);
	return found;
}

const pressNamed = (host: HTMLElement, name: string) =>
	one<HTMLButtonElement>(host, `[role="toolbar"] button[aria-label="${name}"]`);

/** what the form would post under the box's name, run through the rule. */
function posted(host: HTMLElement): RichTextDocument {
	const input = one<HTMLInputElement>(host, 'input[type="hidden"][name="mission"]');
	const parsed = parseRichText(JSON.parse(input.value));
	if (!parsed.ok) throw new Error(`the rule refused what the box posts: ${parsed.message}`);
	return parsed.doc;
}

async function write(editor: Editor, text: string) {
	await act(async () => {
		editor.chain().focus().insertContent(text).selectAll().run();
	});
}

async function press(button: HTMLButtonElement) {
	await act(async () => {
		button.click();
	});
}

async function typeAddress(host: HTMLElement, words: string) {
	const input = one<HTMLInputElement>(host, '.adm-rte__link input');
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	await act(async () => {
		setter?.call(input, words);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	return input;
}

async function key(target: HTMLElement, name: string) {
	await act(async () => {
		target.dispatchEvent(
			new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
		);
	});
}

const firstRun = (doc: RichTextDocument) => {
	const block = doc.content[0];
	return block?.type === 'paragraph' ? block.content?.[0] : undefined;
};

describe('what the box posts', () => {
	it('posts the blank document from the server render on, before anything is written', async () => {
		const html = renderToString(<RichTextEditor name="mission" label="Mission" />);
		const holder = document.createElement('div');
		holder.innerHTML = html;
		expect(posted(holder)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });

		const { host } = await mount();
		expect(posted(host)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
	});

	it('posts the document it was seeded with until it is changed', async () => {
		const seeded: RichTextDocument = {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Warm coats' }] }]
		};
		const { host } = await mount({ defaultValue: seeded });
		expect(posted(host)).toEqual(seeded);
	});

	it.each([
		['Bold', (doc: RichTextDocument) => firstRun(doc)?.marks, [{ type: 'bold' }]],
		['Italic', (doc: RichTextDocument) => firstRun(doc)?.marks, [{ type: 'italic' }]],
		['Bulleted list', (doc: RichTextDocument) => doc.content[0]?.type, 'bulletList'],
		['Numbered list', (doc: RichTextDocument) => doc.content[0]?.type, 'orderedList']
	] as const)(
		'%s leaves a document the rule accepts, carrying it',
		async (name, read, expected) => {
			const { host, editor } = await mount();
			await write(editor, 'Warm coats for every child');
			await press(pressNamed(host, name));
			expect(read(posted(host))).toEqual(expected);
			expect(pressNamed(host, name).getAttribute('aria-pressed')).toBe('true');
		}
	);

	it('reports each change the rule accepts to onChange, as the parsed document', async () => {
		const seen: RichTextDocument[] = [];
		const { host, editor } = await mount({ onChange: (doc) => seen.push(doc) });
		await write(editor, 'Warm coats');
		await press(pressNamed(host, 'Bold'));
		expect(seen.at(-1)).toEqual(posted(host));
		expect(firstRun(seen.at(-1) as RichTextDocument)?.marks).toEqual([{ type: 'bold' }]);
	});

	it('keeps only what the rule holds when HTML arrives, as a paste does', async () => {
		const { host, editor } = await mount();
		await act(async () => {
			editor.commands.insertContent(
				'<h1>Our year</h1><p><u>Warm</u> <a href="javascript:alert(1)">coats</a> <img src="x.png"><a href="mailto:a@b.org">mail</a></p>'
			);
		});
		const doc = posted(host);
		expect(doc.content.every((block) => block.type === 'paragraph')).toBe(true);
		expect(JSON.stringify(doc)).not.toMatch(/"link"|heading|image|underline/);
	});

	it(`nests lists no deeper than ${LIST_DEPTH_MAX}, whatever sinks them`, async () => {
		const { host, editor } = await mount();
		await act(async () => {
			editor.chain().focus().toggleBulletList().insertContent('Coats').run();
		});
		for (let level = 0; level < LIST_DEPTH_MAX + 2; level++) {
			await act(async () => {
				editor.chain().splitListItem('listItem').insertContent('deeper').run();
				editor.commands.sinkListItem('listItem');
			});
		}
		const deepest = (blocks: RichTextDocument['content'], depth: number): number =>
			Math.max(
				depth,
				...blocks.flatMap((block) =>
					block.type === 'paragraph'
						? []
						: block.content.map((item) => deepest(item.content as typeof blocks, depth + 1))
				)
			);
		expect(deepest(posted(host).content, 0)).toBe(LIST_DEPTH_MAX);
	});
});

describe('making a link', () => {
	it('links the selected words to the address typed, and returns to the words', async () => {
		const { host, editor, content } = await mount();
		await write(editor, 'Read our annual report');
		await press(pressNamed(host, 'Link'));
		const address = await typeAddress(host, 'https://riverbanktrust.org/annual-report');
		expect(document.activeElement).toBe(address);
		await press(one<HTMLButtonElement>(host, '.adm-rte__link button.adm-btn--primary'));
		expect(firstRun(posted(host))?.marks).toEqual([
			{ type: 'link', attrs: { href: 'https://riverbanktrust.org/annual-report' } }
		]);
		expect(host.querySelector('.adm-rte__link')).toBeNull();
		expect(document.activeElement).toBe(content);
	});

	it('says Link opens its row, and toggles nothing', async () => {
		const { host, editor } = await mount();
		await write(editor, 'Read our annual report');
		const link = pressNamed(host, 'Link');
		expect(link.hasAttribute('aria-pressed')).toBe(false);
		expect(link.getAttribute('aria-expanded')).toBe('false');

		await press(link);

		const row = one<HTMLElement>(host, '.adm-rte__link');
		expect(link.getAttribute('aria-expanded')).toBe('true');
		expect(link.getAttribute('aria-controls')).toBe(row.id);
		expect(link.hasAttribute('aria-pressed')).toBe(false);
	});

	it('takes an address typed without its scheme as https', async () => {
		const { host, editor } = await mount();
		await write(editor, 'annual report');
		await press(pressNamed(host, 'Link'));
		const address = await typeAddress(host, '  riverbanktrust.org/report ');
		await key(address, 'Enter');
		expect(firstRun(posted(host))?.marks).toEqual([
			{ type: 'link', attrs: { href: 'https://riverbanktrust.org/report' } }
		]);
	});

	it('refuses a javascript: address at the row, with the rule’s reason, and links nothing', async () => {
		const { host, editor } = await mount();
		await write(editor, 'click me');
		await press(pressNamed(host, 'Link'));
		const address = await typeAddress(host, 'javascript:alert(document.cookie)');
		await press(one<HTMLButtonElement>(host, '.adm-rte__link button.adm-btn--primary'));

		expect(address.getAttribute('aria-invalid')).toBe('true');
		const message = one<HTMLElement>(host, `#${CSS.escape(address.id)}-err`);
		expect(message.textContent).toContain('a link goes to an http or https address');
		expect(document.activeElement).toBe(address);
		expect(firstRun(posted(host))?.marks).toBeUndefined();

		await typeAddress(host, 'https://riverbanktrust.org');
		expect(host.querySelector(`#${CSS.escape(address.id)}-err`)).toBeNull();
	});

	it('offers Remove link on a link, and removing it leaves the words unlinked', async () => {
		const href = 'https://riverbanktrust.org';
		const { host, editor } = await mount({
			defaultValue: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'our site', marks: [{ type: 'link', attrs: { href } }] }
						]
					}
				]
			}
		});
		await act(async () => {
			editor.chain().focus().setTextSelection(3).run();
		});
		await press(pressNamed(host, 'Link'));
		expect(one<HTMLInputElement>(host, '.adm-rte__link input').value).toBe(href);
		const remove = [...host.querySelectorAll<HTMLButtonElement>('.adm-rte__link button')].find(
			(button) => button.textContent === 'Remove link'
		);
		if (remove === undefined) throw new Error('no Remove link on a link');
		await press(remove);
		expect(firstRun(posted(host))).toEqual({ type: 'text', text: 'our site' });
	});

	it('leaves the row on Escape without the keypress reaching anything around it', async () => {
		const { host, editor, content } = await mount();
		await write(editor, 'annual report');
		await press(pressNamed(host, 'Link'));
		const address = await typeAddress(host, 'https://riverbanktrust.org');
		let heard = false;
		const listen = () => {
			heard = true;
		};
		document.addEventListener('keydown', listen);
		onTestFinished(() => document.removeEventListener('keydown', listen));
		await key(address, 'Escape');
		expect(heard).toBe(false);
		expect(host.querySelector('.adm-rte__link')).toBeNull();
		expect(document.activeElement).toBe(content);
		expect(firstRun(posted(host))?.marks).toBeUndefined();
	});
});

describe('the toolbar', () => {
	it('names every press and the box, and is one tab stop', async () => {
		const { host, content } = await mount();
		const toolbar = one<HTMLElement>(host, '[role="toolbar"]');
		expect(toolbar.getAttribute('aria-label')).toBe('Mission formatting');
		const buttons = [...toolbar.querySelectorAll('button')];
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Bold',
			'Italic',
			'Bulleted list',
			'Numbered list',
			'Link'
		]);
		expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
		const label = one<HTMLElement>(
			host,
			`#${CSS.escape(content.getAttribute('aria-labelledby') ?? '')}`
		);
		expect(label.textContent).toBe('Mission');
	});

	it('moves along the presses with the arrow keys, Home and End, wrapping at the ends', async () => {
		const { host } = await mount();
		const bold = pressNamed(host, 'Bold');
		act(() => bold.focus());
		await key(bold, 'ArrowRight');
		expect(document.activeElement).toBe(pressNamed(host, 'Italic'));
		await key(pressNamed(host, 'Italic'), 'End');
		expect(document.activeElement).toBe(pressNamed(host, 'Link'));
		await key(pressNamed(host, 'Link'), 'ArrowRight');
		expect(document.activeElement).toBe(bold);
		await key(bold, 'ArrowLeft');
		expect(document.activeElement).toBe(pressNamed(host, 'Link'));
		expect(pressNamed(host, 'Link').tabIndex).toBe(0);
		expect(bold.tabIndex).toBe(-1);
		await key(pressNamed(host, 'Link'), 'Home');
		expect(document.activeElement).toBe(bold);
	});

	it('keeps the focus on a press made from the keyboard, so a second can follow', async () => {
		const { host, editor } = await mount();
		await write(editor, 'Warm coats');
		const bold = pressNamed(host, 'Bold');
		act(() => bold.focus());
		await press(bold);
		expect(document.activeElement).toBe(bold);
		await key(bold, 'ArrowRight');
		await press(pressNamed(host, 'Italic'));
		expect(firstRun(posted(host))?.marks).toEqual([{ type: 'bold' }, { type: 'italic' }]);
	});

	it('describes the box by the ids the caller hands it', async () => {
		const { content } = await mount({ describedBy: 'mission-hint mission-err' });
		expect(content.getAttribute('aria-describedby')).toBe('mission-hint mission-err');
	});
});

describe('a refusal from the action', () => {
	const refusal = 'Write the mission in a sentence or two.';

	it('is drawn in the field’s own error row, describing the box and marking it refused', async () => {
		const { host, content } = await mount({ describedBy: 'mission-hint', error: refusal });
		const row = one<HTMLElement>(host, '.adm-field > .adm-field__error');
		expect(row.textContent).toBe(refusal);
		expect(content.getAttribute('aria-describedby')).toBe(`mission-hint ${row.id}`);
		expect(content.getAttribute('aria-invalid')).toBe('true');
	});

	it('arrives on a box already drawn, and leaves it with the refusal', async () => {
		const { host, content, rerender } = await mount();
		expect(host.querySelector('.adm-field__error')).toBeNull();
		expect(content.hasAttribute('aria-invalid')).toBe(false);

		await rerender({ error: refusal });
		const row = one<HTMLElement>(host, '.adm-field > .adm-field__error');
		expect(content.getAttribute('aria-describedby')).toBe(row.id);
		expect(content.getAttribute('aria-invalid')).toBe('true');

		await rerender({});
		expect(host.querySelector('.adm-field__error')).toBeNull();
		expect(content.hasAttribute('aria-describedby')).toBe(false);
		expect(content.hasAttribute('aria-invalid')).toBe(false);
	});

	it('puts the caller’s id on the editable, where useFocusOnRefusal finds it', async () => {
		function Refusable({ error }: { error?: string }) {
			useFocusOnRefusal(error, 'story-mission');
			return (
				<RichTextEditor name="mission" label="Mission" id="story-mission" error={error ?? null} />
			);
		}
		const host = document.createElement('div');
		document.body.appendChild(host);
		const root = createRoot(host);
		onTestFinished(() => {
			act(() => root.unmount());
			host.remove();
		});
		await act(async () => {
			root.render(<Refusable />);
		});
		const content = one<HTMLElement>(host, '[role="textbox"]');
		expect(content.id).toBe('story-mission');
		expect(document.activeElement).not.toBe(content);

		await act(async () => {
			root.render(<Refusable error={refusal} />);
		});
		expect(document.activeElement).toBe(content);
	});
});
