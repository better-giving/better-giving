import { useEffect, useRef } from 'react';

// the page's draft, framed across the whole editor.
//
// the page inside is the preview route's own document, and it is inert there: no tab stop and no
// press of its own. what it does do is post the id of a block that was clicked, and this host is
// what listens. a message is taken only from this frame's own window, only from this deployment's
// own origin, and only in the one shape the preview posts — anything else on the channel is some
// other page's and is not read.
//
// the frame itself is out of the tab order: the keyboard's way to a block is the Settings sheet's
// block list (./settings-sheet.tsx), and a tab stop on a document nothing inside can be operated in
// is one the reader has to walk past on every lap.

/** what the preview posts when a block is clicked. */
export const BLOCK_MESSAGE = 'bg-page-block';

type BlockMessage = { readonly type: typeof BLOCK_MESSAGE; readonly id: string };

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

	return <iframe ref={frame} className="adm-editor__frame" src={src} title={title} tabIndex={-1} />;
}
