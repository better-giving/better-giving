import type {
	NavigateFunction,
	NavigateOptions,
	ShouldRevalidateFunctionArgs,
	To
} from 'react-router';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
	CLOSE_PARAM,
	consoleRereads,
	leaveDialog,
	OPENED_HERE,
	opensOrDropsDialog
} from './dialog-params';

/** a link press between two addresses on this one page, which is every navigation but a submission. */
const pressed = (from: string, to: string): ShouldRevalidateFunctionArgs => ({
	currentUrl: new URL(from, 'http://127.0.0.1:5322'),
	currentParams: {},
	nextUrl: new URL(to, 'http://127.0.0.1:5322'),
	nextParams: {},
	defaultShouldRevalidate: true
});

/** resolves once the router has finished every navigation and read it has under way. */
const waitIdle = (router: ReturnType<typeof createMemoryRouter>) =>
	new Promise<void>((resolve) => {
		const idle = () => router.state.initialized && router.state.navigation.state === 'idle';
		if (idle()) return resolve();
		const stop = router.subscribe(() => {
			if (!idle()) return;
			stop();
			resolve();
		});
	});

describe('a navigation that does nothing but open or drop a dialog', () => {
	it('reads the close confirm opening', () => {
		expect(opensOrDropsDialog(pressed('/', '/?close'))).toBe(true);
	});

	it('reads the close confirm being left', () => {
		expect(opensOrDropsDialog(pressed('/?close', '/'))).toBe(true);
	});

	it('reads the close confirm opening over a section page, and being left', () => {
		expect(opensOrDropsDialog(pressed('/sites', '/sites?close'))).toBe(true);
		expect(opensOrDropsDialog(pressed('/sites?close', '/sites'))).toBe(true);
	});

	it('reads `?account` as no dialog', () => {
		expect(opensOrDropsDialog(pressed('/sites', '/sites?account'))).toBe(false);
	});
});

/**
 * the answer the router hands the page after a press, which carries the submission whichever
 * address it lands on: the router carries a submission through any redirect it followed.
 */
const posted = (from: string, to: string, answer?: unknown): ShouldRevalidateFunctionArgs => ({
	...pressed(from, to),
	formMethod: 'POST',
	formAction: from,
	formEncType: 'application/x-www-form-urlencoded',
	formData: new FormData(),
	...(answer === undefined ? {} : { actionResult: answer })
});

describe("a navigation carrying a press's answer", () => {
	it('is never one of them, however the dialog parameter moved', () => {
		expect(opensOrDropsDialog(posted('/?close', '/'))).toBe(false);
		expect(opensOrDropsDialog(posted('/?close', '/?close', { closing: true }))).toBe(false);
	});
});

describe('every other navigation', () => {
	it('is not one of them when the path is a different one', () => {
		expect(opensOrDropsDialog(pressed('/', '/somewhere-else'))).toBe(false);
		expect(opensOrDropsDialog(pressed('/?close', '/somewhere-else?close'))).toBe(false);
	});

	it('is not one of them when the address differs in anything besides those parameters', () => {
		expect(opensOrDropsDialog(pressed('/?fold=mail', '/?fold=payments'))).toBe(false);
		expect(opensOrDropsDialog(pressed('/?close', '/?close&fold=mail'))).toBe(false);
	});

	it('is one of them when what else the address carries is unchanged', () => {
		expect(opensOrDropsDialog(pressed('/?fold=mail', '/?fold=mail&close'))).toBe(true);
	});
});

describe('whether a console screen reads again', () => {
	it('does not after the close press, which the binary stops behind', () => {
		expect(consoleRereads(posted('/password', '/password', { closing: true }))).toBe(false);
	});

	it('does not over the close confirm opening on a section page', () => {
		expect(consoleRereads(pressed('/payments/stripe', '/payments/stripe?close'))).toBe(false);
	});

	it('does not over a site list the deployment turned down', () => {
		const refused = { kind: 'refused', message: 'Each site is an address.', fix: null };
		const blocked = { kind: 'blocked', message: 'Two forms list it.', fix: null, inUse: [] };

		expect(consoleRereads(posted('/sites', '/sites', { sites: { written: refused } }))).toBe(false);
		expect(consoleRereads(posted('/sites', '/sites', { sites: { written: blocked } }))).toBe(false);
	});

	it('does over a site list that was stored', () => {
		const written = { kind: 'saved', sites: ['https://riverbank.org'] };

		expect(consoleRereads(posted('/sites', '/sites', { sites: { written } }))).toBe(true);
	});

	it('does not over mail credentials refused before anything was sent', () => {
		const secrets = { group: 'mail', errors: { SMTP_HOST: 'Add the host.' } };

		expect(consoleRereads(posted('/smtp', '/smtp', { secrets }))).toBe(false);
	});

	it('does over mail credentials that were stored', () => {
		const secrets = { group: 'mail', written: { kind: 'set' } };

		expect(consoleRereads(posted('/smtp', '/smtp', { secrets }))).toBe(true);
	});

	it('does not over a test send to an address the binary turned down', () => {
		expect(consoleRereads(posted('/smtp', '/smtp', { test: { kind: 'bad-address' } }))).toBe(false);
	});

	it('leaves every other navigation to the router', () => {
		expect(consoleRereads(posted('/sites', '/sites', { sites: {} }))).toBe(true);
		expect(consoleRereads({ ...pressed('/sites', '/smtp'), defaultShouldRevalidate: false })).toBe(
			false
		);
	});
});

describe('the way out of a dialog', () => {
	/** the history an operator is holding, standing on its last entry. */
	const holding = (entries: string[]) =>
		createMemoryRouter([{ path: '*', Component: () => null }], {
			initialEntries: entries,
			initialIndex: entries.length - 1
		});

	/** what the dialog's way out does, over the page at `/p`. */
	const leave = (router: ReturnType<typeof holding>) =>
		leaveDialog(
			((to: To | number, options?: NavigateOptions) =>
				typeof to === 'number'
					? router.navigate(to)
					: router.navigate(to, options)) as NavigateFunction,
			router.state.location,
			'/p'
		);

	const at = (router: ReturnType<typeof holding>) =>
		`${router.state.location.pathname}${router.state.location.search}`;

	it('steps back over the entry its opener pushed, so Back after it leaves the page', async () => {
		const router = holding(['/a', '/p']);
		await router.navigate(`/p?${CLOSE_PARAM}`, { state: OPENED_HERE });

		await leave(router);
		expect(at(router)).toBe('/p');
		await router.navigate(-1);
		expect(at(router)).toBe('/a');
	});

	it('takes the place of an address that arrived carrying the dialog, so Back after it leaves too', async () => {
		const router = holding(['/a', `/p?${CLOSE_PARAM}`]);

		await leave(router);
		expect(at(router)).toBe('/p');
		await router.navigate(-1);
		expect(at(router)).toBe('/a');
	});
});

describe('what the router re-reads under consoleRereads', () => {
	/** a page whose loader counts its reads, standing at `at`, with its first read landed. */
	const reading = async (at: string) => {
		let reads = 0;
		const router = createMemoryRouter(
			[
				{
					path: '*',
					loader: () => ++reads,
					action: () => ({ written: true }),
					shouldRevalidate: consoleRereads,
					Component: () => null
				}
			],
			{ initialEntries: [at] }
		);
		await waitIdle(router);
		return { router, reads: () => reads };
	};

	it("re-reads on the page's own revalidate", async () => {
		const page = await reading('/quickbooks');

		await page.router.revalidate();
		expect(page.reads()).toBe(2);
	});

	it('does not re-read over a link that only opens or drops a dialog', async () => {
		const page = await reading('/sites');

		await page.router.navigate(`/sites?${CLOSE_PARAM}`);
		await page.router.navigate('/sites');
		await page.router.navigate(`/sites?${CLOSE_PARAM}`);
		expect(page.reads()).toBe(1);
	});

	it('re-reads over a link to a different page', async () => {
		const page = await reading('/sites');

		await page.router.navigate('/smtp');
		expect(page.reads()).toBe(2);
	});

	it('re-reads over a press, even one posted at a dialog address', async () => {
		const page = await reading('/sites');

		await page.router.navigate(`/sites?${CLOSE_PARAM}`, {
			formMethod: 'post',
			formData: new FormData()
		});
		expect(page.reads()).toBe(2);
	});
});
