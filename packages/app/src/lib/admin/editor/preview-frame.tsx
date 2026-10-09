import { useEffect, useRef } from 'react';
import {
	BLOCK_MESSAGE,
	type BlockMessage,
	EDITING_MESSAGE,
	type EditingMessage,
	READY_MESSAGE
} from '../../page/preview-message';
import { useEditing } from './editor-shell';

// the page's draft, framed across the whole editor.
//
// the page inside is the preview route's own document, and it is inert there: no tab stop and no
// press of its own. what it does do is post the id of a block that was clicked, and this host is
// what listens. a message is taken only from this frame's own window, only from this deployment's
// own origin, and only in the shape the preview posts — anything else on the channel is some other
// page's and is not read.
//
// **a click opens a block only while Edit is on** (`useEditing` in ./editor-shell.tsx); with it off
// the preview is the page and a click in it is not handed on. the page is told each change, and
// told again when it says it is ready, so a frame reloaded under an Edit already on draws its
// blocks clickable from the start.
//
// the frame is the preview's one tab stop, which an iframe is without a `tabIndex`, and `title`
// names it. tabbed to, the keyboard lands in the framed document, whose arrows and Page Down scroll
// the draft. nothing inside is a stop of its own ($lib/donate/page-view.tsx's `usePreviewReport`),
// so the next Tab leaves the frame. the keyboard's way to a block is the Settings sheet's block
// list (./settings-sheet.tsx), which Settings opens while Edit is on.

function isMessage(data: unknown): data is { readonly type: unknown; readonly id?: unknown } {
	return typeof data === 'object' && data !== null;
}

function isBlockMessage(data: unknown): data is BlockMessage {
	return (
		isMessage(data) && data.type === BLOCK_MESSAGE && typeof data.id === 'string' && data.id !== ''
	);
}

/** tells the page in `frame` whether Edit is on. */
function tell(frame: HTMLIFrameElement | null, on: boolean) {
	const message: EditingMessage = { type: EDITING_MESSAGE, on };
	frame?.contentWindow?.postMessage(message, window.location.origin);
}

type PreviewFrameProps = {
	/** the preview route's address for this page's draft. */
	readonly src: string;
	/** the frame's name for a screen reader — "Preview of Winter coat drive". */
	readonly title: string;
	/** a block in the preview was clicked while Edit is on. */
	readonly onBlockClick: (id: string) => void;
};

export function PreviewFrame({ src, title, onBlockClick }: PreviewFrameProps) {
	const frame = useRef<HTMLIFrameElement>(null);
	const editing = useEditing().on;
	// held in refs so a caller handing a new function every render does not re-subscribe, and a
	// ready landing between two renders is answered with the Edit that stands.
	const handler = useRef(onBlockClick);
	handler.current = onBlockClick;
	const on = useRef(editing);
	on.current = editing;

	useEffect(() => {
		const listen = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (frame.current === null || event.source !== frame.current.contentWindow) return;
			if (isMessage(event.data) && event.data.type === READY_MESSAGE)
				tell(frame.current, on.current);
			else if (isBlockMessage(event.data) && on.current) handler.current(event.data.id);
		};
		window.addEventListener('message', listen);
		return () => window.removeEventListener('message', listen);
	}, []);

	// a frame mounting hears it from its ready; after that, from each change.
	const told = useRef(editing);
	useEffect(() => {
		if (told.current === editing) return;
		told.current = editing;
		tell(frame.current, editing);
	}, [editing]);

	return <iframe ref={frame} className="adm-editor__frame" src={src} title={title} />;
}
