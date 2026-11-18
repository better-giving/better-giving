import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { ErrorState } from './error-state';

// a failed answer's state, mounted: whichever code it carries, its title takes focus as it is
// drawn, since a boundary draws it only where a navigation landed on the failure and focus would
// otherwise stay on the link that was pressed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(status: number) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const pressed = document.createElement('a');
	pressed.href = '/admin/donations/gift-1';
	document.body.appendChild(pressed);
	pressed.focus();
	const root = createRoot(host);
	const draw = (code: number, message: string, arrival: string) =>
		act(() => root.render(<ErrorState status={code} message={message} arrival={arrival} />));
	draw(status, '', 'first');
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
		pressed.remove();
	});
	return { host, draw };
}

describe('ErrorState', () => {
	it.each([
		[404, 'No such page'],
		[403, 'This request was refused'],
		[500, 'This deployment could not answer']
	])('focuses the %s’s title as it is drawn', (status, title) => {
		mount(status);
		const active = document.activeElement;
		expect(active?.tagName).toBe('H1');
		expect(active?.textContent).toBe(title);
	});

	it.each([404, 403, 500])(
		'marks the %s as the operator page state, so adm.css centres it and keeps its title ringless',
		(status) => {
			const { host } = mount(status);
			expect(host.firstElementChild?.classList.contains('adm-pagestate')).toBe(true);
			expect(host.querySelector('h1')?.classList.contains('adm-pagestate__title')).toBe(true);
		}
	);

	/** focus moved off the drawn state, as a press on the page does before the next navigation. */
	function pressElsewhere() {
		const other = document.createElement('button');
		document.body.appendChild(other);
		onTestFinished(() => other.remove());
		other.focus();
	}

	it('focuses the refusal’s title again when a second refusal replaces the first', () => {
		const { host, draw } = mount(403);
		pressElsewhere();
		draw(409, 'That gift was already refunded.', 'second');
		expect(document.activeElement).toBe(host.querySelector('h1'));
	});

	it.each([404, 403, 500])(
		'focuses the %s’s title again when another arrival lands on the same failure',
		(status) => {
			const { host, draw } = mount(status);
			pressElsewhere();
			draw(status, '', 'second');
			expect(document.activeElement).toBe(host.querySelector('h1'));
		}
	);

	it('leaves focus where it is when the same arrival draws again', () => {
		const { draw } = mount(404);
		pressElsewhere();
		const pressed = document.activeElement;
		draw(404, '', 'first');
		expect(document.activeElement).toBe(pressed);
	});
});
