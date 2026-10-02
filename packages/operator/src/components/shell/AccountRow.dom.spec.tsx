import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { AccountBand, type AccountLinkProps, AccountRow } from './AccountRow.jsx';

// the account as the rail's foot and the narrow band draw it: what each face opens, what it is read
// out as, and that neither says anything the other does not.
//
// the name a reader hears is taken off the document here the way a browser takes it for these two
// shapes: the band's is its `aria-label`, and the row's is its content — the logo's label, the
// whitespace, the name and the word after it.

const ACCOUNT = {
	name: 'Riverside Shelter’s Account',
	brand: 'cloudflare',
	whose: 'Cloudflare account',
	href: '/sites?account'
} as const;

const PACED = 'Needs attention';

/** a surface's own link, standing in for the router link the console hands in. */
const Handed = ({ children, ...rest }: AccountLinkProps) => (
	<a {...rest} data-handed="yes">
		{children}
	</a>
);

/** the one link a face drew. */
function opener(root: HTMLElement): HTMLAnchorElement {
	const found = root.querySelectorAll('a');
	expect(found).toHaveLength(1);
	return found[0] as HTMLAnchorElement;
}

/** the row's link read as its content is: an image's label, and every text node, in order. */
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

describe('the account row in the rail’s foot', () => {
	it('is one link, logo and name together, opening the panel', () => {
		const root = render(AccountRow, { ...ACCOUNT, concern: null, out: null });
		const link = opener(root);

		expect(link.getAttribute('href')).toBe('/sites?account');
		expect(link.querySelector('.adm-brand')).not.toBeNull();
		expect(contentName(link)).toBe('Cloudflare account Riverside Shelter’s Account');
	});

	it('reads the concern after the name, and marks it', () => {
		const root = render(AccountRow, { ...ACCOUNT, concern: PACED, out: null });
		const link = opener(root);

		expect(contentName(link)).toBe(`Cloudflare account Riverside Shelter’s Account, ${PACED}`);
		expect(link.querySelector('.adm-accountmark')).not.toBeNull();
	});

	it('marks nothing where the account wants no look', () => {
		const root = render(AccountRow, { ...ACCOUNT, concern: null, out: null });

		expect(root.querySelector('.adm-accountmark')).toBeNull();
	});

	it('keeps the way out it was handed, outside the link', () => {
		const root = render(AccountRow, {
			...ACCOUNT,
			concern: null,
			out: <button type="button">Close console</button>
		});

		expect(root.querySelector('.adm-footaccount__out > button')?.textContent).toBe('Close console');
		expect(opener(root).querySelector('button')).toBeNull();
	});

	it('carries no hint for a reader to hear as its description', () => {
		const root = render(AccountRow, { ...ACCOUNT, concern: PACED, out: null });

		expect(opener(root).hasAttribute('title')).toBe(false);
	});

	it('is drawn as the link the surface handed in', () => {
		const root = render(AccountRow, { ...ACCOUNT, concern: null, out: null, link: Handed });
		const link = opener(root);

		expect(link.dataset.handed).toBe('yes');
		expect(link.className).toBe('adm-footaccount__open');
	});
});

describe('the account’s press in the band', () => {
	it('opens the same panel and says what the row says', () => {
		const marked = opener(render(AccountBand, { ...ACCOUNT, concern: PACED }));
		const row = opener(render(AccountRow, { ...ACCOUNT, concern: PACED, out: null }));

		expect(marked.getAttribute('href')).toBe('/sites?account');
		expect(marked.getAttribute('aria-label')).toBe(contentName(row));
		expect(marked.querySelector('.adm-accountmark')).not.toBeNull();
	});

	it('is the unmarked name where the account wants no look', () => {
		const plain = opener(render(AccountBand, { ...ACCOUNT, concern: null }));

		expect(plain.getAttribute('aria-label')).toBe('Cloudflare account Riverside Shelter’s Account');
		expect(plain.querySelector('.adm-accountmark')).toBeNull();
	});

	it('keeps its size beside the close, carrying no hint', () => {
		const press = opener(render(AccountBand, { ...ACCOUNT, concern: null, link: Handed }));

		expect(press.classList).toContain('adm-signout');
		expect(press.dataset.handed).toBe('yes');
		expect(press.hasAttribute('title')).toBe(false);
	});
});
