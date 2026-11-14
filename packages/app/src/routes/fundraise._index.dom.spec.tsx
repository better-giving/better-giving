import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished, vi } from 'vitest';
import StartRoute from './fundraise._index';

// the spam check the start route draws into the start form: the donation form's own widget, started
// on the config the loader hands over, its answer posted in the `challenge` box, and a fresh one
// asked for after every answer the action gives, since a token or payload clears one post. the
// widget itself is packages/form's, stubbed here to the three calls the route makes of it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const widget = vi.hoisted(() => ({
	configs: [] as unknown[],
	mounts: [] as unknown[],
	resets: 0,
	stops: 0,
	hand: null as null | ((token: string) => void)
}));

vi.mock('@better-giving/form/embed/challenge', () => ({
	createChallenge: (config: unknown, mount: unknown, onToken: (token: string) => void) => {
		widget.configs.push(config);
		widget.mounts.push(mount);
		widget.hand = onToken;
		return {
			reset: () => {
				widget.resets += 1;
			},
			stop: () => {
				widget.stops += 1;
			}
		};
	}
}));

const ORG = { name: 'Harbor Light', logo: null, brandColour: null };
const CHALLENGE = { altchaChallengeUrl: '/api/v1/forms/frm_donationpage/challenge' };

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

function screen(actionData: unknown, challenge: typeof CHALLENGE | null = CHALLENGE) {
	const Stub = createRoutesStub([
		{
			path: '/fundraise',
			Component: () =>
				createElement(StartRoute as never, {
					loaderData: { org: ORG, open: challenge !== null, challenge },
					actionData,
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/fundraise'] }));
}

const box = (root: HTMLElement) =>
	root.querySelector<HTMLInputElement>('input[type="hidden"][name="challenge"]');

it('starts the widget on the loader’s config and posts its answer in the challenge box', () => {
	widget.configs.length = 0;
	const root = screen(undefined);
	expect(widget.configs).toEqual([CHALLENGE]);
	expect(box(root)?.value).toBe('');
	act(() => widget.hand?.('solved-payload'));
	expect(box(root)?.value).toBe('solved-payload');
});

it('draws the widget in the registry’s spam slot, the answer box beside it', () => {
	widget.mounts.length = 0;
	const root = screen(undefined);
	const slot = root.querySelector('.ds-spam-slot');
	expect(widget.mounts).toEqual([slot?.querySelector(':scope > .ds-spam-widget')]);
	expect(box(root)?.parentElement).toBe(slot);
});

it('asks the widget for a fresh answer once the action has answered', () => {
	widget.resets = 0;
	const root = screen({ refused: 'challenge_failed', form: { id: 'supporter-start', result: {} } });
	expect(widget.resets).toBe(1);
	expect(box(root)?.value).toBe('');
});

it('draws no widget where fundraisers are off', () => {
	widget.configs.length = 0;
	const root = screen(undefined, null);
	expect(widget.configs).toEqual([]);
	expect(box(root)).toBeNull();
});
