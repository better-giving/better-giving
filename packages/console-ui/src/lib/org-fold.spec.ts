import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import type { SocialPlatform } from '@better-giving/operator/console/org';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { NonprofitLookup, NonprofitSearch, OrgWrite } from '../api/types';
import { takesLogo } from './logo-crop';
import {
	LOGO_FILE,
	ORG_INTENT,
	ORG_LOGO_INTENT,
	ORG_LOGO_REMOVE_INTENT,
	type OrgPressKind,
	type StoredOrg,
	storedProfile
} from './org-fields';
import { OrgFold } from './org-fold';

// the Organisation fold as drawn, around the IRS list. ../../vite.config.ts pins `node` and there
// is no dom, so what is read here is the first draw: what each form would post is read off the
// controls it draws. when the list is asked and what an answer fills are ./ein-lookup.spec.ts's,
// what a press in the finder asks is ./org-search.spec.ts's, reaching the boxes and where focus
// goes once a number is locked in are ./fold-boxes.spec.ts's, and the finder's states are
// ./org-finder.spec.ts's.

const STORED = storedProfile({
	legal_name: 'Riverside Community Food Bank',
	tax_id: '12-3456789',
	address_line1: '400 Mill Road',
	city: 'Riverside',
	region: 'CA',
	country: 'United States'
});

function drawn(
	stored: StoredOrg,
	lookups = true,
	write: OrgWrite | null = null,
	press: OrgPressKind | null = null,
	writing: { readonly busy?: boolean; readonly logoPending?: boolean } = {}
) {
	const lookUp = vi.fn(
		async (): Promise<NonprofitLookup> => ({
			state: 'unavailable',
			organisation: {
				ein: '',
				name: '',
				address_line1: '',
				city: '',
				region: '',
				postal_code: '',
				deductible: false,
				revokedOn: '',
				website: '',
				mission: ''
			}
		})
	);
	const search = vi.fn(
		async (): Promise<NonprofitSearch> => ({ state: 'unavailable', matches: [] })
	);
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(OrgFold, {
					stored,
					write,
					press,
					busy: writing.busy ?? false,
					pending: false,
					logoPending: writing.logoPending ?? false,
					lookups,
					lookUp,
					search
				})
		}
	]);
	const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
	return { markup, lookUp, search };
}

/** the EIN box's own tag. */
const einBox = (markup: string): string => {
	const tag = markup.match(/<input[^>]*name="tax_id"[^>]*>/)?.[0];
	expect(tag).toBeDefined();
	return tag as string;
};

describe('the Organisation details fold', () => {
	it('asks the list nothing when it is drawn holding a stored EIN', () => {
		const { lookUp, search } = drawn(STORED);

		expect(lookUp).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
	});

	it('takes the EIN on a number pad, ahead of the name it fills', () => {
		const { markup } = drawn(STORED);

		expect(einBox(markup)).toContain('inputMode="numeric"');
		expect(markup.indexOf('name="tax_id"')).toBeLessThan(markup.indexOf('name="legal_name"'));
	});

	it('stands the region the list’s note is said in under the EIN box, empty, before it speaks', () => {
		const { markup } = drawn(STORED);

		expect(markup).toContain(
			'<p class="adm-field__needed" id="org-tax_id-status" role="status"></p>'
		);
		expect(einBox(markup)).not.toContain('aria-describedby');
	});

	it('opens on the finder alone for a fresh set-up: no box, no link, no logo and no Save', () => {
		const { markup } = drawn(storedProfile({}));

		expect(markup).toMatch(/^<search id="org-find"><form/);
		expect(markup).toContain('>Name or EIN</label>');
		expect(markup).not.toContain('name="tax_id"');
		expect(markup).not.toContain('social_links');
		expect(markup).not.toContain('adm-logo');
		expect(markup).not.toContain('Save details');
		expect(markup).not.toContain('Pick a different organisation');
	});

	it('asks the list nothing as the finder is drawn', () => {
		const { lookUp, search } = drawn(storedProfile({}));

		expect(lookUp).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
	});

	it('opens on the finder whatever notification address is stored', () => {
		const { markup } = drawn(storedProfile({ notification_email: 'alerts@example.org' }));

		expect(markup).toMatch(/^<search id="org-find">/);
		expect(markup).not.toContain('Save details');
	});

	it('opens on the whole form, and no finder, where any of the identity is stored', () => {
		const { markup } = drawn(storedProfile({ city: 'Riverside' }));

		expect(markup).not.toContain('id="org-find"');
		expect(markup).toContain('name="tax_id"');
		expect(markup).toContain('Save details');
		expect(markup).toContain('adm-logo');
	});

	it('offers the finder from a quiet press beside Save, shut until it is pressed', () => {
		const { markup } = drawn(STORED);
		const press =
			markup.match(/<button[^>]*>(?:(?!<\/button>).)*Pick a different organisation/s)?.[0] ?? '';

		expect(press).toContain('type="button"');
		expect(press).toContain('adm-btn--quiet');
		expect(press).toContain('aria-expanded="false"');
		expect(markup).not.toContain('id="org-find"');
		expect(markup).not.toContain('Find your organisation');
	});

	describe('on a console built with no address for the IRS list', () => {
		it('draws no press that opens the finder', () => {
			expect(drawn(STORED, false).markup).not.toContain('Pick a different organisation');
		});

		it('still opens a fresh set-up on the finder alone, and asks nothing as it is drawn', () => {
			const { markup, lookUp, search } = drawn(storedProfile({}), false);

			expect(markup).toMatch(/^<search id="org-find">/);
			expect(markup).not.toContain('name="tax_id"');
			expect(lookUp).not.toHaveBeenCalled();
			expect(search).not.toHaveBeenCalled();
		});

		it('stands no region for a note the list will never give', () => {
			expect(drawn(STORED, false).markup).not.toContain('id="org-tax_id-status"');
		});

		it('still spells the EIN as it is typed, on a number pad', () => {
			expect(einBox(drawn(STORED, false).markup)).toContain('inputMode="numeric"');
		});
	});
});

/** the profile as a deployment holding the widened organisation reports it. */
const WIDENED = storedProfile({
	...STORED,
	notification_email: 'alerts@riverside.org',
	mission: 'Food for every family in Riverside County.',
	vision: 'No family in Riverside goes hungry.',
	brand_colour: '#2f6b3a',
	social_links: [
		{ platform: 'facebook', href: 'https://www.facebook.com/riversidefoodbank' },
		{ platform: 'instagram', href: 'https://www.instagram.com/riversidefoodbank' }
	],
	logo: { id: 'img_1', url: 'https://give.riverside.org/images/img_1' }
});

/** one form's markup, from its opening tag to its close, found by its id. */
const formNamed = (markup: string, id: string): string => {
	const found = markup.match(new RegExp(`<form[^>]*id="${id}"[^>]*>(?:(?!</form>).)*</form>`, 's'));
	expect(found).not.toBeNull();
	return (found as RegExpMatchArray)[0];
};

/** every control a form's markup would post, as `name=value`, in document order. */
const posted = (form: string): string[] =>
	[...form.matchAll(/<(input|textarea)\b([^>]*)>(?:([^<]*)<\/textarea>)?/g)].flatMap((tag) => {
		const attributes = tag[2] ?? '';
		const name = attributes.match(/\bname="([^"]*)"/)?.[1];
		if (name === undefined || /\bdisabled=""/.test(attributes)) return [];
		const value =
			tag[1] === 'textarea' ? (tag[3] ?? '') : (attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? '');
		return [`${name}=${value.replaceAll('&amp;', '&')}`];
	});

describe('the Organisation fold’s save', () => {
	const profile = () => posted(formNamed(drawn(WIDENED).markup, 'org'));

	it('posts every stored link at the address the deployment stored, in order', () => {
		expect(profile().filter((entry) => entry.startsWith('social_links'))).toEqual([
			'social_links[0]=https://www.facebook.com/riversidefoodbank',
			'social_links[1]=https://www.instagram.com/riversidefoodbank'
		]);
	});

	it('posts the mission, the vision and the brand colour at what is stored', () => {
		expect(profile()).toEqual(
			expect.arrayContaining([
				'mission=Food for every family in Riverside County.',
				'vision=No family in Riverside goes hungry.',
				'brand_colour=#2f6b3a'
			])
		);
	});

	it('carries the notification address it does not draw', () => {
		expect(profile()).toContain('notification_email=alerts@riverside.org');
	});

	it('posts no photo and no logo intent, which are the logo’s own press', () => {
		expect(profile().some((entry) => entry.startsWith(`${LOGO_FILE}=`))).toBe(false);
		expect(profile()).not.toContain(`intent=${ORG_LOGO_INTENT}`);
	});

	// the step between groups is wider than the one between two fields (the squint test,
	// packages/operator/src/styles/squint.spec.ts), so the profile reads as its groups.
	it('stands the profile in its groups: identity, story, look, links, and the press', () => {
		const form = formNamed(drawn(WIDENED).markup, 'org');

		expect(form).toMatch(/^<form[^>]*class="adm-groups"/);
		const order = [
			'name="tax_id"',
			'name="mission"',
			'name="brand_colour"',
			'social_links[0]',
			`value="${ORG_INTENT}"`
		];
		const at = order.map((mark) => form.indexOf(mark));
		expect(at.every((place) => place !== -1)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	it('draws the mission and the vision as paragraphs', () => {
		const { markup } = drawn(WIDENED);

		expect(markup).toMatch(/<textarea[^>]*name="mission"/);
		expect(markup).toMatch(/<textarea[^>]*name="vision"/);
	});

	it('describes the brand colour box by the hint stating its format', () => {
		const { markup } = drawn(WIDENED);
		const colourBox = markup.match(/<input[^>]*name="brand_colour"[^>]*>/)?.[0];

		expect(markup).toContain(
			'id="org-brand_colour-hint">A # and six hex digits, like #1f6feb.</p>'
		);
		expect(colourBox).toMatch(/aria-describedby="[^"]*org-brand_colour-hint/);
	});

	it('describes the colour well as empty to a reader where no colour is stored', () => {
		const well = (markup: string) => markup.match(/<input[^>]*type="color"[^>]*>/)?.[0] ?? '';
		const empty = drawn(STORED).markup;
		const set = drawn(WIDENED).markup;

		expect(well(empty)).toContain('aria-describedby="org-brand_colour-empty"');
		expect(empty).toContain(
			'<span id="org-brand_colour-empty" class="adm-vh">No colour set</span>'
		);
		expect(well(set)).not.toContain('aria-describedby');
		expect(set).not.toContain('No colour set');
	});

	/** a network's mark as the operator's own part draws it: its `<img>`, without the preload react
	    puts in front of an image drawn at the root. */
	const markOf = (platform: SocialPlatform) =>
		renderToStaticMarkup(createElement(BrandMark, { platform, className: 'adm-brand-mark' })).match(
			/<img[^>]*>/
		)?.[0] ?? '<no mark>';

	/** the box a link row draws, the mark at its start and the words drawn inside the slot after
	    it, by the row's position. */
	const linkRow = (markup: string, at: number) => {
		const row = markup.match(
			new RegExp(
				`<div class="adm-leadwrap"><span class="adm-leadwrap__lead" aria-hidden="true">(.*?)(<span hidden=""[^>]*>[^<]*</span>)?</span><input[^>]*name="social_links\\[${at}\\]"[^>]*>`,
				's'
			)
		);
		expect(row).not.toBeNull();
		return {
			slot: row?.[1] ?? '',
			said: row?.[2] ?? '',
			box: row?.[0].match(/<input[^>]*>/)?.[0] ?? ''
		};
	};

	it('stands the mark of the network each link’s address is read as inside its box', () => {
		const { markup } = drawn(WIDENED);
		const [facebook, instagram] = [linkRow(markup, 0), linkRow(markup, 1)];

		expect(facebook.slot).toContain(markOf('facebook'));
		expect(instagram.slot).toContain(markOf('instagram'));
	});

	// the mark says the platform on the screen, so the name is drawn hidden inside the slot that is
	// out of the tree, and the box is described by it: a description reads hidden words it names.
	it('names the platform to a reader alone, and describes the box by it', () => {
		const { markup } = drawn(WIDENED);
		const { slot, said, box } = linkRow(markup, 0);

		expect(said).toBe('<span hidden="" id="org-social_links[0]-lead">Facebook</span>');
		expect(slot).not.toContain('Facebook');
		expect(box).toMatch(/aria-describedby="[^"]*org-social_links\[0\]-lead/);
	});

	it('stands the globe in a box whose address no network is read from, and names no platform', () => {
		const { markup } = drawn(
			storedProfile({
				...WIDENED,
				social_links: [{ platform: 'facebook', href: 'https://riverside.org/news' }]
			})
		);
		const { slot, said, box } = linkRow(markup, 0);

		expect(slot).toContain('lucide-globe');
		expect(slot).not.toContain('adm-brand-mark');
		expect(said).toBe('');
		expect(box).not.toContain('org-social_links[0]-lead');
	});
});

describe('the logo’s presses', () => {
	it('sends a chosen photo as multipart, under the logo intent and the file box', () => {
		const upload = formNamed(drawn(WIDENED).markup, 'org-logo-upload');

		// server markup keeps react's spelling of the attribute; html reads it case-blind.
		expect(upload).toMatch(/^<form[^>]*enctype="multipart\/form-data"/i);
		expect(upload).toMatch(/^<form[^>]*method="post"/);
		expect(upload).toMatch(new RegExp(`<input[^>]*type="file"[^>]*name="${LOGO_FILE}"`));
		expect(posted(upload)).toEqual([`intent=${ORG_LOGO_INTENT}`, `${LOGO_FILE}=`]);
	});

	it('offers in the file chooser only the types the crop takes', () => {
		const box = formNamed(drawn(WIDENED).markup, 'org-logo-upload').match(
			/<input[^>]*type="file"[^>]*>/
		)?.[0];
		const offered = box?.match(/\baccept="([^"]*)"/)?.[1]?.split(',') ?? [];

		expect(offered.length).toBeGreaterThan(0);
		expect(offered.filter((type) => !takesLogo(new File([], 'logo', { type })))).toEqual([]);
	});

	it('takes the logo off through a form of its own, which posts its intent and no photo', () => {
		const { markup } = drawn(WIDENED);
		const press = markup.match(/<button[^>]*aria-label="Remove the logo"[^>]*>/)?.[0];
		const remove = formNamed(markup, 'org-logo-remove');

		expect(press).toContain('form="org-logo-remove"');
		expect(press).toContain('name="intent"');
		expect(press).toContain(`value="${ORG_LOGO_REMOVE_INTENT}"`);
		expect(press).toContain('type="submit"');
		expect(posted(remove)).toEqual([]);
	});

	/** the square the logo is drawn in, which is the press that chooses one. */
	const square = (markup: string): string => {
		const found = markup.match(
			/<button[^>]*class="adm-logo__square"[^>]*>(?:(?!<\/button>).)*<\/button>/s
		);
		expect(found).not.toBeNull();
		return found?.[0] ?? '';
	};

	it('draws the stored logo as the square that replaces it, named for that', () => {
		const shown = square(drawn(WIDENED).markup);

		expect(shown).toMatch(/^<button type="button"/);
		expect(shown).toContain('src="https://give.riverside.org/images/img_1"');
		expect(shown).toContain('<span class="adm-vh">Replace logo</span>');
	});

	it('stands the crop and the removal on the square’s corner, each a mark named for what it does', () => {
		const { markup } = drawn(WIDENED);
		const corner = markup.match(/<div class="adm-logo__presses">(?:(?!<\/div>).)*<\/div>/s)?.[0];
		const crop = corner?.match(/<button[^>]*aria-label="Crop the logo"[^>]*>/)?.[0];

		expect(crop).toContain('type="button"');
		expect(crop).not.toContain('form=');
		expect(corner).toContain('aria-label="Remove the logo"');
		expect(corner).toContain('lucide-crop');
		expect(corner).toContain('lucide-trash-2');
		// no row of presses under the square.
		expect(formNamed(markup, 'org-logo-upload')).not.toContain('adm-actions');
	});

	// a press taken off the page while it holds focus drops a reader to the document; closed by
	// `aria-disabled` it stays focusable, and its own click handler turns a second press away.
	it('keeps Remove on the page, focusable and closed, while a removal is pending', () => {
		const { markup } = drawn(WIDENED, true, null, null, { busy: true, logoPending: true });
		const press = markup.match(/<button[^>]*aria-label="Remove the logo"[^>]*>/)?.[0];

		expect(press).toContain('aria-disabled="true"');
		expect(press).not.toMatch(/\bdisabled=""/);
		expect(press).toContain('form="org-logo-remove"');
	});

	it('offers to add one in the empty square, and no press beside it, where none is stored', () => {
		const { markup } = drawn(STORED);
		const shown = square(markup);

		expect(shown).toContain('lucide-image-up');
		expect(shown).toContain('<span>Add logo</span>');
		expect(markup).not.toContain('adm-logo__presses');
		expect(markup).not.toContain('Remove the logo');
		expect(markup).not.toContain('Crop the logo');
	});

	it('reads Saving on the square while a logo press is out, and keeps it focusable', () => {
		const shown = square(
			drawn(WIDENED, true, null, null, { busy: true, logoPending: true }).markup
		);

		expect(shown).toContain('aria-busy="true"');
		expect(shown).toContain('aria-disabled="true"');
		expect(shown).not.toMatch(/\bdisabled=""/);
		expect(shown).toContain('<span>Saving</span>');
	});

	// the sheet draws the logo's solid edge off this, so a logo held under a saving press keeps it
	// while the word stands where the art was.
	it('says the square holds a logo, drawn or saving, and holds none where none is stored', () => {
		const held = (markup: string) =>
			square(markup).match(/^<button[^>]*\bdata-logo="([^"]*)"/)?.[1];

		expect(held(drawn(WIDENED).markup)).toBe('shown');
		expect(held(drawn(WIDENED, true, null, null, { busy: true, logoPending: true }).markup)).toBe(
			'saving'
		);
		expect(held(drawn(STORED).markup)).toBe(undefined);
	});

	it('draws no crop before an image is chosen', () => {
		expect(drawn(WIDENED).markup).not.toContain('<dialog');
	});
});

describe('a refusal keyed to a part that is not a box', () => {
	const refused = (errors: Record<string, string>): OrgWrite => ({
		kind: 'refused',
		message: 'The profile was not saved.',
		fix: null,
		errors,
		unread: 0
	});

	it('draws the logo’s sentence under the logo and points its press at it', () => {
		const { markup } = drawn(
			WIDENED,
			true,
			refused({ logo: 'That file isn’t an image. Choose a PNG, JPEG or WebP.' }),
			'logo'
		);
		const upload = formNamed(markup, 'org-logo-upload');

		expect(upload).toContain('id="org-logo-err"');
		expect(upload).toContain('That file isn’t an image.');
		expect(upload).toMatch(/<button[^>]*aria-describedby="org-logo-err"/);
		expect(formNamed(markup, 'org')).not.toContain('That file isn’t an image.');
	});

	it('draws the links’ sentence at the group, describing every row', () => {
		const sentence =
			'https://myspace.com/riverside is not a Facebook, Instagram, YouTube, LinkedIn, TikTok or X address.';
		const { markup } = drawn(WIDENED, true, refused({ social_links: sentence }), 'profile');

		expect(markup).toContain('id="org-social_links-err"');
		expect(markup).toContain('https://myspace.com/riverside is not a Facebook');
		const row = markup.match(/<input[^>]*name="social_links\[0\]"[^>]*>/)?.[0];
		expect(row).toMatch(/aria-describedby="[^"]*org-social_links-err/);
	});
});

describe('an answer, by the press it is to', () => {
	const saved: OrgWrite = { kind: 'saved', org: { ...WIDENED, logo: null } };
	const refusedName: OrgWrite = {
		kind: 'refused',
		message: null,
		fix: null,
		errors: { legal_name: 'Add the name the organisation is registered under.' },
		unread: 0
	};
	const saveButton = (markup: string) =>
		markup.match(/<button[^>]*value="org:save"[^>]*>(?:(?!<\/button>).)*<\/button>/s)?.[0] ?? '';

	// a profile answer that lands is what puts the boxes back to what is stored; a logo answer
	// reaching the profile form would do the same over whatever was typed and not yet saved.
	it('lands no profile save on a logo that landed, so the boxes stay as typed', () => {
		const { markup } = drawn(WIDENED, true, saved, 'logo');

		expect(saveButton(markup)).toContain('Save details');
		expect(saveButton(markup)).not.toContain('Saved');
	});

	it('lands the profile save on its own answer', () => {
		expect(saveButton(drawn(WIDENED, true, saved, 'profile').markup)).toContain('Saved');
	});

	it('marks no box over a refusal that answered the logo', () => {
		const { markup } = drawn(WIDENED, true, refusedName, 'logo');

		expect(markup).not.toContain('Add the name the organisation is registered under.');
	});

	it('marks the box over a refusal that answered the profile', () => {
		const { markup } = drawn(WIDENED, true, refusedName, 'profile');

		expect(markup).toContain('Add the name the organisation is registered under.');
	});
});
