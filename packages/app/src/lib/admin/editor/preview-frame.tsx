import { useEffect, useRef } from 'react';
import { BLOCK_MESSAGE, type BlockMessage } from '../../page/preview-message';

// the page's draft, framed across the whole editor.
//
// the page inside is the preview route's own document, and it is inert there: no tab stop and no
// press of its own. what it does do is post the id of a block that was clicked, and this host is
// what listens. a message is taken only from this frame's own window, only from this deployment's
// own origin, and only in the one shape the preview posts — anything else on the channel is some
// other page's and is not read.
//
// the frame is the preview's one tab stop, which an iframe is without a `tabIndex`, and `title`
// names it. tabbed to, the keyboard lands in the framed document, whose arrows and Page Down scroll
// the draft. nothing inside is a stop of its own ($lib/donate/page-view.tsx's `usePreviewReport`),
// so the next Tab leaves the frame. the keyboard's way to a block is the Settings sheet's block
// list (./settings-sheet.tsx).

function isBlockMessage(data: unknown): data is BlockMessage {
	if (typeof data !== 'object' || data === null) return false;
	const { type, id } = data as Record<string, unknown>;
	return type === BLOCK_MESSAGE && typeof id === 'string' && id !== '';
}

type PreviewFrameProps = {
	/** the preview route's address for this page's draft. */
	readonly src: string;
	/** the frame's name for a screen reader — "Preview of Winter coat drive". */
	readonly title: string;
	/** a block in the preview was clicked. */
	readonly onBlockClick: (id: string) => void;
};

export function PreviewFrame({ src, title, onBlockClick }: PreviewFrameProps) {
	const frame = useRef<HTMLIFrameElement>(null);
	// held in a ref so a caller handing a new function every render does not re-subscribe.
	const handler = useRef(onBlockClick);
	handler.current = onBlockClick;

	useEffect(() => {
		const listen = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (frame.current === null || event.source !== frame.current.contentWindow) return;
			if (!isBlockMessage(event.data)) return;
			handler.current(event.data.id);
		};
		window.addEventListener('message', listen);
		return () => window.removeEventListener('message', listen);
	}, []);

	return <iframe ref={frame} className="adm-editor__frame" src={src} title={title} />;
}
