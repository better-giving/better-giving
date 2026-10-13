import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { type PressBoxes, useDraftPresses } from './draft-presses';

// the presses one part makes while another of its presses is in flight, against a stubbed editor
// route whose action holds each write until the case lets it land and moves the page's version as
// it does, and whose loader reads that version back as the editor's does.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** the page's version as the stubbed draft holds it. */
let version: number;
/** every body posted, as box and value pairs, in the order it arrived. */
let posted: [string, string][][];
/** each write waits here until the case lets it land. */
let held: (() => void)[];

beforeEach(() => {
	version = 3;
	posted = [];
	held = [];
});

/** the presses a case makes, each a button named for its form, and after a colon for which of a form's. */
type Presses = Record<string, PressBoxes>;

function part(presses: Presses) {
	function Part() {
		const { version: at } = useLoaderData<{ version: number }>();
		const draft = useDraftPresses(at);
		return (
			<>
				{Object.entries(presses).map(([name, boxes]) => (
					<button
						key={name}
						type="button"
						onClick={() => draft.press(name.split(':')[0] ?? name, boxes)}
					>
						{name}
					</button>
				))}
			</>
		);
	}
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			Component: Part,
			HydrateFallback: () => null,
			loader: () => ({ version }),
			action: async ({ request }) => {
				posted.push([...(await request.formData())].map(([box, value]) => [box, String(value)]));
				await new Promise<void>((land) => held.push(land));
				version += 1;
				return { saved: 'block' };
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<Stub initialEntries={['/admin/donation-page']} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function press(root: HTMLElement, name: string) {
	const button = [...root.querySelectorAll('button')].find((one) => one.textContent === name);
	if (button === undefined) throw new Error(`no ${name}`);
	await act(async () => button.click());
	await settle();
}

/** the write in flight lands, and whatever waited for it is sent. */
async function land() {
	await act(async () => held.shift()?.());
	await settle();
	await settle();
}

describe('presses made while one is in flight', () => {
	it('send each form’s in turn, in the order they were made, each at the version the one before moved the page to', async () => {
		const root = part({
			layout: [['layout', 'wide']],
			corners: [['corners', 'round']],
			share: [
				['channels', 'email'],
				['channels', 'x']
			]
		});
		await settle();
		await press(root, 'layout');
		await press(root, 'corners');
		await press(root, 'share');
		expect(posted).toHaveLength(1);

		await land();
		await land();
		await land();

		expect(posted).toEqual([
			[
				[WHICH_FORM, 'layout'],
				[RECORD_VERSION, '3'],
				['layout', 'wide']
			],
			[
				[WHICH_FORM, 'corners'],
				[RECORD_VERSION, '4'],
				['corners', 'round']
			],
			[
				[WHICH_FORM, 'share'],
				[RECORD_VERSION, '5'],
				['channels', 'email'],
				['channels', 'x']
			]
		]);
	});

	it('send only the later of two on the same form', async () => {
		const root = part({
			layout: [['layout', 'wide']],
			'corners:square': [['corners', 'square']],
			'corners:round': [['corners', 'round']]
		});
		await settle();
		await press(root, 'layout');
		await press(root, 'corners:square');
		await press(root, 'corners:round');

		await land();
		await land();

		expect(posted.map((body) => body.slice(2))).toEqual([
			[['layout', 'wide']],
			[['corners', 'round']]
		]);
		expect(held).toHaveLength(0);
	});
});
