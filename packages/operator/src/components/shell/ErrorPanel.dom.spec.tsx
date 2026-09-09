import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { PanelRoute } from './AppShell.jsx';
import { ErrorPanel } from './ErrorPanel.jsx';

// the panel a route outside the shell is, and there is one of it.
//
// signing in and failing are the same centred panel. drawn twice they are two compositions that
// only look alike until one of them is changed, and nothing on any screen says the other did not
// follow — so the case below reads the wrapper off both and compares them rather than restating
// what either draws.
//
// the second thing held here is that this part names no surface's route table. it is a leaf both
// the dashboard and the console consume, and an address written into it is an address the other
// surface can only work around — which is what sent both surfaces off to hand-draw an
// error state of their own.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the chain of class names from the mount point down to what the panel was handed. */
function wrapper(root: HTMLElement): readonly string[] {
	const chain: string[] = [];
	let node = root.firstElementChild;
	while (node !== null && chain.length < 4) {
		chain.push(node.className);
		node = node.firstElementChild;
	}
	return chain;
}

describe('an error panel mounted into a document', () => {
	it('is the panel route, rather than a second thing shaped like it', () => {
		const failure = render(ErrorPanel, { code: '500', title: 'This deployment could not answer' });
		const signIn = render(PanelRoute, { children: <h1>Sign in</h1> });

		expect(wrapper(signIn).slice(0, 2)).toEqual(['adm-panelroute', 'adm-panel']);
		expect(wrapper(failure).slice(0, 2)).toEqual(wrapper(signIn).slice(0, 2));
	});

	it('offers no way out of its own, at either face', () => {
		const missing = render(ErrorPanel, { code: '404', title: 'No such page' });
		const failure = render(ErrorPanel, { code: '500', title: 'This deployment could not answer' });

		expect(missing.querySelectorAll('a, button')).toHaveLength(0);
		expect(failure.querySelectorAll('a, button')).toHaveLength(0);
	});

	it('sends the reader where the caller said, through the element the caller handed', () => {
		const root = render(ErrorPanel, {
			code: '404',
			title: 'No such page',
			wayOut: 'Go to forms',
			wayOutProps: { as: 'a', href: '/admin/forms' }
		});
		const out = root.querySelector('a');

		expect(out?.getAttribute('href')).toBe('/admin/forms');
		expect(out?.className).toBe('adm-btn adm-btn--primary');
		expect(out?.textContent).toBe('Go to forms');
	});

	it('draws the code, the heading and the sentence in that order', () => {
		const root = render(ErrorPanel, {
			code: '404',
			title: 'No such page',
			children: 'It may have moved.'
		});
		const panel = root.querySelector('.adm-panel');

		expect([...(panel?.children ?? [])].map((child) => child.tagName)).toEqual(['P', 'H1', 'P']);
		expect(panel?.querySelector('.adm-num')?.textContent).toBe('404');
	});
});

describe('the error panel as a module', () => {
	// two claims a rendered tree cannot make. the first is that the panel is reached rather than
	// redrawn: two wrappers carrying the same classes render identically and stay identical only
	// until one of them is changed. the second is that no address is written into a part both the
	// dashboard and the console mount — that one line is what sent both of them off to
	// hand-draw an error state of their own, and it left the repository's last `as="a"` on the
	// dashboard's 404 face taking the whole document with it.
	const source = readFileSync('src/components/shell/ErrorPanel.jsx', 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		' '
	);

	it('reads the part it is meant to be guarding', () => {
		expect(source).toContain('export function ErrorPanel');
	});

	it('mounts the panel route rather than drawing its wrapper again', () => {
		expect(source).toContain('<PanelRoute>');
		expect(source).not.toContain('adm-panelroute');
	});

	it('names no address on either surface', () => {
		expect(source).not.toMatch(/['"]\//);
	});
});
