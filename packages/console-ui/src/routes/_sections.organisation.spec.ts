import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { DataRouter } from 'react-router';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgWrite } from '../api/types';

// the organisation page's save, through a router: what the screen draws on the render the answer
// lands in. that render is the one the seam's focus move runs on (../lib/use-console-form.ts), so a
// box still closed there is a refusal the operator is left in front of with focus nowhere. the
// client is replaced so the answer is whichever one the case sets, and the layout's reading is a
// count.

const binary = vi.hoisted(() => ({
	shellReads: 0,
	statusReads: 0,
	built: true,
	answer: null as unknown
}));

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	saveOrgProfile: async () => binary.answer,
	nonprofitsStatus: async () => {
		binary.statusReads += 1;
		return { built: binary.built };
	}
}));

const { ORG_INTENT, orgBoxes } = await import('../lib/org-fields');
const { ORG_FORM } = await import('../lib/org-form');
const sections = await import('./_sections');
const organisation = await import('./_sections.organisation');

const PAGE = '/organisation';
const PAGE_ID = 'organisation';

const STORED = orgBoxes({ legal_name: 'Riverbank Trust', country: 'US' });

const REFUSED: OrgWrite = {
	kind: 'refused',
	message: 'The profile was not saved.',
	fix: null,
	errors: { legal_name: 'Add the name the organisation is registered under.' },
	unread: 0
};

const SAVED: OrgWrite = { kind: 'saved', org: { ...STORED, legal_name: 'Riverbank Trust Inc' } };

beforeEach(() => {
	binary.shellReads = 0;
	binary.statusReads = 0;
	binary.built = true;
	binary.answer = REFUSED;
});

/**
 * the page under a root and the sections layout, as the console mounts it: `matches[1]` is the
 * layout. the layout's reading is the one a save re-reads, so its `shouldRevalidate` is the module's.
 */
async function open() {
	const router = createMemoryRouter(
		[
			{
				children: [
					{
						loader: () => {
							binary.shellReads += 1;
							return { reading: { stored: STORED } };
						},
						shouldRevalidate: sections.shouldRevalidate,
						children: [
							{
								id: PAGE_ID,
								path: PAGE,
								loader: organisation.clientLoader,
								action: organisation.clientAction as never,
								shouldRevalidate: organisation.shouldRevalidate,
								Component: UNSAFE_withComponentProps(organisation.default as never)
							}
						]
					}
				]
			}
		],
		{ initialEntries: [PAGE] }
	);
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	return router;
}

type Landed = { readonly navigation: string; readonly page: string };

/** the save made as the fold makes it, and the screen drawn on the render its answer arrives in. */
async function saved(router: DataRouter): Promise<Landed> {
	let landed: Landed | null = null;
	const off = router.subscribe((state) => {
		if (landed !== null || state.actionData?.[PAGE_ID] === undefined) return;
		landed = {
			navigation: state.navigation.state,
			page: renderToString(createElement(RouterProvider, { router }))
		};
	});
	try {
		const posted = new FormData();
		posted.set('intent', ORG_INTENT);
		await router.navigate(PAGE, { formMethod: 'post', formData: posted, preventScrollReset: true });
		await vi.waitFor(() => expect(router.state.navigation.state).toBe('idle'));
	} finally {
		off();
	}
	if (landed === null) throw new Error('the answer never landed');
	return landed;
}

/** one opening tag, found by an attribute only it carries. */
function tag(page: string, name: string, carrying: string): string {
	const found = page.match(new RegExp(`<${name}\\b[^>]*${carrying}[^>]*>`));
	if (found === null) throw new Error(`no <${name}> carrying ${carrying}`);
	return found[0];
}

const legalName = (page: string) => tag(page, 'input', `id="${ORG_FORM.id}-legal_name"`);
const saveButton = (page: string) => tag(page, 'button', `value="${ORG_INTENT}"`);

describe('the organisation page, on the render a refused save lands in', () => {
	it('leaves the refused box open to type in and the button off Saving', async () => {
		const router = await open();
		try {
			const { page } = await saved(router);

			expect(legalName(page)).not.toMatch(/\sdisabled=/);
			expect(saveButton(page)).not.toContain('aria-busy');
		} finally {
			router.dispose();
		}
	});

	it('reads nothing again, because nothing was written', async () => {
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation } = await saved(router);

			expect(navigation).toBe('idle');
			expect(binary.shellReads).toBe(before);
		} finally {
			router.dispose();
		}
	});
});

describe('the organisation page, on the render a landed save arrives in', () => {
	it('reads the deployment again and holds the boxes closed while it does', async () => {
		binary.answer = SAVED;
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation, page } = await saved(router);

			expect(navigation).toBe('loading');
			expect(legalName(page)).toMatch(/\sdisabled=/);
			expect(binary.shellReads).toBe(before + 1);
		} finally {
			router.dispose();
		}
	});
});

describe('whether the page can ask the IRS list', () => {
	it('is read once for the visit, and not again after a save lands', async () => {
		binary.answer = SAVED;
		const router = await open();
		try {
			await saved(router);

			expect(binary.statusReads).toBe(1);
		} finally {
			router.dispose();
		}
	});

	it('draws the plain form where the console was built with no address for the list', async () => {
		binary.built = false;
		const router = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain(`id="${ORG_FORM.id}-legal_name"`);
			expect(page).not.toContain('Find your organisation');
		} finally {
			router.dispose();
		}
	});

	it('offers the find press where it was', async () => {
		const router = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain('Find your organisation');
		} finally {
			router.dispose();
		}
	});
});
