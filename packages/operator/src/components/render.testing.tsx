import { type ComponentType, act } from 'react';
import { createRoot } from 'react-dom/client';
import { onTestFinished } from 'vitest';

// the one way a part in this package is put in front of an assertion. a spec names the part and the
// props a caller would pass it, and reads the markup back off the element it gets — never off a
// handle this module made up, which is a claim about this module rather than about the part.
//
// it runs in the dom pool only (../../vitest.config.ts): react has to have a document to mount
// into, and this leaf has none of its own outside a test pool.
//
// the `.testing` suffix matches no pool's include glob, so this is a module specs import rather
// than a file of tests of its own.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** a mount a spec can hand the props a caller would pass next, and the element it drew into. */
export type Mounted<P extends object> = {
	readonly root: HTMLElement;
	/** the same mount, redrawn with these props. */
	readonly again: (props: P) => void;
};

/**
 * mounts `part` with `props` and keeps the mount, so a spec may hand it the props a caller would
 * pass it next and read what changed.
 *
 * a part whose behaviour is what it does *when* a prop changes cannot be read off one render:
 * ./controls/SaveButton.jsx says a save out loud on the run its state turns `done`, and a second
 * mount is a different button reporting its first save rather than the same one reporting again.
 *
 * the mount is torn down when the case that made it ends, so a spec states nothing about cleanup
 * and two cases never read each other's document.
 */
export function mount<P extends object>(part: ComponentType<P>, props: P): Mounted<P> {
	const root = document.createElement('div');
	document.body.append(root);
	const mounted = createRoot(root);

	const Part = part;
	// `act` is what makes a draw finished by the time the call returns rather than scheduled, so a
	// spec may read the markup on the next line — the effects a prop change runs included.
	const again = (next: P): void => act(() => mounted.render(<Part {...next} />));
	again(props);

	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});

	return { root, again };
}

/**
 * mounts `part` with `props` and hands back the element it rendered into, for the case that reads
 * one render and never changes a prop — which is most of them.
 */
export function render<P extends object>(part: ComponentType<P>, props: P): HTMLElement {
	return mount(part, props).root;
}
