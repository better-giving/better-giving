import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

// the editor, one for the Donation page and a campaign alike: a route of its own outside the rail,
// the publish bar across the top (./publish-bar.tsx), and under it the page's preview
// (./preview-frame.tsx) across the editor's whole width. what a bar press or a clicked block opens
// is a sheet, and a sheet or a confirm the route renders is handed in as `children`: each is a
// modal that lifts itself into the top layer, so where it stands in the tree decides nothing about
// where it paints.
//
// **Edit is the shell's**: off, the preview is the page and a click in it does nothing; on, every
// block in it is drawn as clickable and a click opens that block's sheet (./preview-frame.tsx), and
// the bar's press reads Done, which turns it off (./publish-bar.tsx). the bar and the frame both
// read it with `useEditing`, so a route mounting the two hands neither the state.

type EditorShellProps = {
	/** the publish bar. */
	readonly bar: ReactNode;
	/** the preview frame. */
	readonly preview: ReactNode;
	/** the sheet or confirm that is up, if one is. */
	readonly children?: ReactNode;
};

const Editing = createContext<{ readonly on: boolean; readonly turn: (on: boolean) => void }>({
	on: false,
	turn: () => {}
});

export function EditorShell({ bar, preview, children }: EditorShellProps) {
	const [editing, setEditing] = useState(false);
	const edit = useMemo(() => ({ on: editing, turn: setEditing }), [editing]);
	return (
		<Editing.Provider value={edit}>
			<div className="adm-editor">
				{bar}
				<div className="adm-editor__body">
					<main className="adm-editor__preview" aria-label="Preview">
						{preview}
					</main>
				</div>
				{children}
			</div>
		</Editing.Provider>
	);
}

/** whether Edit is on, and the way the bar's press turns it. */
export function useEditing(): { readonly on: boolean; readonly turn: (on: boolean) => void } {
	return useContext(Editing);
}
