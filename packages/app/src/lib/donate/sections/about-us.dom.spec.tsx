import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { AboutUs } from './about-us';

// About us, mounted over plain text: a blank line is a new paragraph,
// a single line break a break inside one, and a statement the organisation has not written is left
// out — both, and nothing is drawn.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const MISSION =
	'No family on the north side goes without food or warmth.\n\nWe stock two pantries and a coat bank.';
const VISION = 'A north side where every neighbor\nhas what they need.';

const paragraphs = (host: HTMLElement) => [...host.querySelectorAll('p')].map((p) => p.textContent);

describe('about us', () => {
	it('draws a paragraph for each run of text a blank line ends', () => {
		const host = mount(<AboutUs mission={MISSION} vision={null} />);
		expect(paragraphs(host)).toEqual([
			'No family on the north side goes without food or warmth.',
			'We stock two pantries and a coat bank.'
		]);
	});

	it('keeps a single line break as a break inside its paragraph', () => {
		const host = mount(<AboutUs mission={null} vision={VISION} />);
		const [only, ...rest] = host.querySelectorAll('p');
		expect(rest).toHaveLength(0);
		expect(only?.querySelectorAll('br')).toHaveLength(1);
		expect(only?.textContent).toBe('A north side where every neighborhas what they need.');
	});

	it('reads markup in the words as words', () => {
		const host = mount(<AboutUs mission="<b>Warm</b> & fed" vision={null} />);
		expect(host.querySelector('b')).toBeNull();
		expect(paragraphs(host)).toEqual(['<b>Warm</b> & fed']);
	});

	it('leaves out a vision the organisation has not written', () => {
		const host = mount(<AboutUs mission={MISSION} vision={null} />);
		expect(host.textContent).not.toContain('Our vision');
		expect(host.textContent).not.toContain('A north side');
	});

	it('draws nothing with neither a mission nor a vision', () => {
		const host = mount(<AboutUs mission={null} vision={null} />);
		expect(host.childNodes).toHaveLength(0);
	});
});

describe('about us, both written', () => {
	it('sets the mission as the statement and the vision beneath it', () => {
		const host = mount(<AboutUs mission={MISSION} vision={VISION} />);
		expect(host.querySelector('.page-about-statement')?.textContent).toContain('No family');
		expect(host.querySelector('.page-about-beneath')?.textContent).toContain('A north side');
	});
});
