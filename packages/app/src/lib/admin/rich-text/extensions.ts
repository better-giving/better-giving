import { LIST_DEPTH_MAX, parseRichText } from '$lib/rich-text/document';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { history, redo, undo } from '@tiptap/pm/history';
import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';

// the editor's schema is the rich-text rule's, node for node and mark for mark
// ($lib/rich-text/document.ts): whatever the schema cannot hold in pasted HTML — a heading, an
// image, an underline — is dropped by tiptap's own parse, its words kept as a paragraph's, so what
// the editor emits is a document the rule accepts. the schema is wider than the rule in three
// places: a link's address and how deep lists nest are closed here, and the length of the words
// (`TEXT_MAX`) is left to the action's parse, which refuses it with the rule's reason.

/** the rule's own refusal of an address as a link's href, or null where it would keep it. */
export function linkRefusal(href: string): string | null {
	const probe = parseRichText({
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }]
			}
		]
	});
	return probe.ok ? null : probe.message;
}

/**
 * what an operator typed as an address, repaired where the repair is unambiguous: the whitespace
 * around it goes, and an address with no scheme at all is taken as https.
 */
export function normaliseAddress(typed: string): string {
	const trimmed = typed.trim();
	if (trimmed === '' || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

function listDepth(node: Node): number {
	let deepest = 0;
	node.forEach((child) => {
		const own = child.type.name === 'bulletList' || child.type.name === 'orderedList' ? 1 : 0;
		deepest = Math.max(deepest, own + listDepth(child));
	});
	return deepest;
}

// tiptap's list item sinks under Tab and a paste can carry any depth; a change that would nest past
// the rule's bound is not applied.
const ListDepth = Extension.create({
	name: 'listDepth',
	addProseMirrorPlugins() {
		return [
			new Plugin({
				filterTransaction: (tr) => !tr.docChanged || listDepth(tr.doc) <= LIST_DEPTH_MAX
			})
		];
	}
});

// undo and redo, from prosemirror's own history plugin: a contenteditable prosemirror owns never
// reaches the browser's undo stack.
const History = Extension.create({
	name: 'history',
	addProseMirrorPlugins() {
		return [history()];
	},
	addKeyboardShortcuts() {
		const run = (command: typeof undo) => () =>
			command(this.editor.state, this.editor.view.dispatch);
		return { 'Mod-z': run(undo), 'Shift-Mod-z': run(redo), 'Mod-y': run(redo) };
	}
});

export const RICH_TEXT_EXTENSIONS = [
	Document,
	Paragraph,
	Text,
	Bold,
	Italic,
	BulletList,
	OrderedList,
	ListItem,
	// a link is made at the toolbar's address field and nowhere else: nothing typed or pasted turns
	// into one, and a press on one in the editor puts the caret in it rather than leaving the page.
	Link.configure({
		autolink: false,
		linkOnPaste: false,
		openOnClick: false,
		protocols: ['http', 'https'],
		isAllowedUri: (url) => linkRefusal(url) === null
	}),
	ListDepth,
	History
];
