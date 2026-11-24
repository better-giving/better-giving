import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { ProgramPagesLine } from './pages-line';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('says every active program has a public page, with nothing to dismiss', () => {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<ProgramPagesLine />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});

	expect(root.textContent).toBe(
		'Each active program has a public page that shows its name, photo and description.'
	);
	expect(root.querySelector('button, form')).toBeNull();
});
