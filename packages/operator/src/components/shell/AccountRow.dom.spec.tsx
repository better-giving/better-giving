import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { AccountBand, AccountRow } from './AccountRow.jsx';

// the account as the rail's foot and the narrow band draw it: a label at both faces, what each is
// read out as, and that neither says anything the other does not.
//
// the name a reader hears is taken off the document here the way a browser takes it for these two
// shapes: the band's is its logo's label, and the row's is its content — the logo's label, the
// whitespace and the name.

const ACCOUNT = {
	name: 'Riverside Shelter’s Account',
	brand: 'cloudflare',
	whose: 'Cloudflare account'
} as const;

/** the row's label read as its content is: an image's label, and every text node, in order. */
function contentName(element: Element): string {
	let said = '';
	const walk = (node: Node) => {
		if (node instanceof Element && node.getAttribute('role') === 'img') {
			said += node.getAttribute('aria-label') ?? '';
			return;
		}
		if (node.nodeType === Node.TEXT_NODE) said += node.textContent;
		for (const child of node.childNodes) walk(child);
	};
	walk(element);
	return said;
}

/** every element in `root` a reader could press or tab to. */
function controls(root: Element): Element[] {
	return [
		...root.querySelectorAll('a, button, [href], [tabindex], [role="button"], [role="link"]')
	];
}

describe('the account row in the rail’s foot', () => {
	it('is a label, logo and name together, and opens nothing', () => {
		const root = render(AccountRow, { ...ACCOUNT, out: null });
		const label = root.querySelector('.adm-footaccount__label');

		expect(label?.querySelector('.adm-brand--cloudflare')).not.toBeNull();
		expect(label?.querySelector('.adm-footaccount__name')?.textContent).toBe(ACCOUNT.name);
		expect(contentName(label as Element)).toBe('Cloudflare account Riverside Shelter’s Account');
		expect(controls(root)).toEqual([]);
	});

	it('keeps the way out it was handed at its far end, as its one press', () => {
		const root = render(AccountRow, {
			...ACCOUNT,
			out: <button type="button">Close console</button>
		});

		expect(root.querySelector('.adm-footaccount > :last-child')?.className).toBe(
			'adm-footaccount__out'
		);
		expect(root.querySelector('.adm-footaccount__out > button')?.textContent).toBe('Close console');
		expect(controls(root).map((found) => found.textContent)).toEqual(['Close console']);
	});

	it('carries no hint', () => {
		const root = render(AccountRow, { ...ACCOUNT, out: null });

		expect(root.querySelector('[title]')).toBeNull();
	});
});

describe('the account in the band', () => {
	it('is the logo alone, reading what the row reads, and opens nothing', () => {
		const band = render(AccountBand, ACCOUNT);
		const row = render(AccountRow, { ...ACCOUNT, out: null });
		const logo = band.querySelector('[role="img"]');

		expect(logo?.classList).toContain('adm-brand--cloudflare');
		expect(logo?.getAttribute('aria-label')).toBe(
			contentName(row.querySelector('.adm-footaccount__label') as Element)
		);
		expect(controls(band)).toEqual([]);
	});

	it('keeps its size beside the close, carrying no hint', () => {
		const logo = render(AccountBand, ACCOUNT).querySelector('[role="img"]');

		expect(logo?.classList).toContain('adm-signout');
		expect(logo?.hasAttribute('title')).toBe(false);
	});
});
