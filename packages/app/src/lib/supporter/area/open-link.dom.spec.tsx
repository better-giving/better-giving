import { describe, expect, it } from 'vitest';
import { button, mountScreen, ORG, one, submit } from './area.testing';
import { OpenLink, type OpenLinkProps } from './open-link';

// the screen a mailed link opens on: one press that spends the link, named by what the link does.

const open = (props: Partial<OpenLinkProps> = {}) =>
	mountScreen(() => (
		<OpenLink org={ORG} purpose="sign_in" token="t0ken" opening={false} {...props} />
	));

describe('opening a mailed link', () => {
	it('names a sign-in link’s press Continue', () => {
		const { root } = open();
		expect(one(root, 'h1').textContent).toBe('Open your fundraiser');
		expect(button(root, 'Continue').type).toBe('submit');
	});

	it('names a confirm link’s press Publish my page', () => {
		const { root } = open({ purpose: 'confirm' });
		expect(one(root, 'h1').textContent).toBe('Publish your fundraiser');
		expect(button(root, 'Publish my page').type).toBe('submit');
	});

	it('posts the link’s token', async () => {
		const { root, posted } = open();
		await submit(one<HTMLFormElement>(root, 'main form'));
		expect(posted).toHaveLength(1);
		expect(posted[0]?.get('token')).toBe('t0ken');
	});

	it('posts once on a double press, before the router says the first is out', async () => {
		const { root, posted } = open({ purpose: 'confirm' });
		const form = one<HTMLFormElement>(root, 'main form');
		await submit(form);
		await submit(form);
		expect(posted).toHaveLength(1);
	});

	it('posts nothing on a press while the opening is out', async () => {
		const { root, posted } = open({ opening: true });
		await submit(one<HTMLFormElement>(root, 'main form'));
		expect(posted).toHaveLength(0);
	});

	it('holds the press while the opening is out', () => {
		const { root } = open({ opening: true });
		expect(button(root, 'Continue').getAttribute('aria-busy')).toBe('true');
	});
});
