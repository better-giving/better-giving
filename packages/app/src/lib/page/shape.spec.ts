import { describe, expect, it } from 'vitest';
import type { Page } from './catalog';
import { defaultCampaign } from './defaults';
import { campaignShape, FEATURE_EXTRAS, STORY_THRESHOLD, thresholdLayout } from './shape';

// node pool, no database: the shape is a pure function of the page and the organisation.

const PHOTO = '0b8a2f9e-2c4f-4f7a-9f55-0f2d6c3a9e11';
const LOGO = '6f1c0d2a-7e3b-4c5d-8a9f-1b2c3d4e5f60';
const noLogo = { logoImageId: null };

function story(length: number): Page['story'] {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(length) }] }]
	};
}

function campaign(content: Partial<Page> = {}): Page {
	return { ...defaultCampaign(), ...content };
}

const tier = { amountMinor: 2500, buys: 'a week of meals' };
const question = { question: 'Is it deductible?', answer: story(10) as NonNullable<Page['story']> };
const photo = { imageId: PHOTO, alt: null };

describe('the layout two measures pick', () => {
	it('is 320 characters of story and 4 extras', () => {
		expect([STORY_THRESHOLD, FEATURE_EXTRAS]).toEqual([320, 4]);
	});

	it.each([
		[319, 'card'],
		[320, 'card'],
		[321, 'letter']
	] as const)('draws a %i-character story with no extras as the %s', (length, layout) => {
		expect(campaignShape(campaign({ story: story(length) }), noLogo)).toMatchObject({
			layout,
			storyLength: length,
			extras: 0
		});
	});

	// storyLength is the plain text's, so a break between paragraphs and a list marker each count.
	const paragraph = (length: number) => ({
		type: 'paragraph' as const,
		content: [{ type: 'text' as const, text: 'x'.repeat(length) }]
	});

	it.each([
		[159, 320, 'card'],
		[160, 322, 'letter']
	] as const)(
		'counts the break between two %i-character paragraphs, so the story is %i and draws as the %s',
		(each, total, layout) => {
			const two = { type: 'doc' as const, content: [paragraph(each), paragraph(each)] };
			expect(campaignShape(campaign({ story: two }), noLogo)).toMatchObject({
				layout,
				storyLength: total
			});
		}
	);

	it('counts a list item’s marker, so a 319-character bullet draws as the letter', () => {
		const list = {
			type: 'doc' as const,
			content: [
				{
					type: 'bulletList' as const,
					content: [
						{
							type: 'listItem' as const,
							content: [paragraph(319)] as [ReturnType<typeof paragraph>]
						}
					]
				}
			]
		};
		expect(campaignShape(campaign({ story: list }), noLogo)).toMatchObject({
			layout: 'letter',
			storyLength: 321
		});
	});

	it.each([
		[0, 'card'],
		[1, 'letter'],
		[3, 'letter'],
		[4, 'feature']
	] as const)('draws a short story with %i extras as the %s', (extras, layout) => {
		expect(thresholdLayout(100, extras)).toBe(layout);
	});

	it('draws four extras as the feature whatever the story’s length', () => {
		expect(thresholdLayout(0, 4)).toBe('feature');
		expect(thresholdLayout(5000, 4)).toBe('feature');
	});

	it('draws a long story with three extras as the letter', () => {
		expect(thresholdLayout(900, 3)).toBe('letter');
	});

	it('counts tiers, questions and the photos beside the cover as extras, and not the cover', () => {
		const shape = campaignShape(
			campaign({ hero: photo, tiers: [tier], faq: [question], photos: [photo, photo] }),
			noLogo
		);
		expect(shape).toMatchObject({ extras: 4, layout: 'feature' });
	});

	it('starts a fresh campaign as the card', () => {
		expect(campaignShape(defaultCampaign(), noLogo).layout).toBe('card');
	});

	it('counts the story’s words, never its markup', () => {
		const page = campaign({
			story: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [{ type: 'text', text: 'abc', marks: [{ type: 'bold' }] }]
					},
					{ type: 'paragraph' }
				]
			}
		});
		expect(campaignShape(page, noLogo).storyLength).toBe(3);
	});
});

describe('the cover', () => {
	it('is the campaign’s own photo where it has one', () => {
		expect(
			campaignShape(campaign({ hero: { imageId: PHOTO, alt: 'Volunteers' } }), {
				logoImageId: LOGO
			}).cover
		).toEqual({ source: 'photo', imageId: PHOTO, alt: 'Volunteers' });
	});

	it('falls back to the organisation’s logo', () => {
		expect(campaignShape(campaign(), { logoImageId: LOGO }).cover).toEqual({
			source: 'logo',
			imageId: LOGO
		});
	});

	it('is none where there is neither', () => {
		expect(campaignShape(campaign(), noLogo).cover).toBeNull();
	});
});

describe('the sections the shape turns on', () => {
	it('draws no goal bar without a goal', () => {
		expect(campaignShape(campaign(), noLogo).goalBar).toBe(false);
	});

	it('draws the goal bar where a goal is set', () => {
		expect(campaignShape(campaign({ goalMinor: 4_000_000 }), noLogo).goalBar).toBe(true);
	});

	it('closes the feature on About us only where the organisation has a mission', () => {
		const feature = campaign({ tiers: [tier, tier, tier, tier] });
		expect(campaignShape(feature, { logoImageId: null, hasMission: true }).aboutUs).toBe(true);
		expect(campaignShape(feature, { logoImageId: null, hasMission: false }).aboutUs).toBe(false);
		expect(campaignShape(campaign(), { logoImageId: null, hasMission: true }).aboutUs).toBe(false);
	});
});
