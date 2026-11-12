import { describe, expect, it } from 'vitest';
import { type ProfileContent, profileShape } from './profile-shape';

// node pool, no database: the Donation page's shape is a pure function of what its profile holds.
// every row of the build spec's worked cases, then the measures' edges.

const NOTHING: ProfileContent = {
	mission: null,
	vision: null,
	videos: [],
	messages: { total: 0 }
};

const video = (n: number) => ({ videoId: `video-${n}` });
const videos = (count: number) => Array.from({ length: count }, (_, n) => video(n));
/** a mission and a vision that read 332 characters joined by one blank line: 200 + 2 + 130. */
const MISSION_AND_VISION = { mission: 'm'.repeat(200), vision: 'v'.repeat(130) };

describe('the layout /donate is drawn in, by the worked cases', () => {
	it.each([
		['Demo, nothing written', {}, 0, 0, 'card', false],
		['Mission of 200 characters, nothing else', { mission: 'm'.repeat(200) }, 200, 0, 'card', true],
		[
			'Mission and vision (332), one video',
			{ ...MISSION_AND_VISION, videos: videos(1) },
			332,
			1,
			'letter',
			true
		],
		['No mission, 3 approved messages', { messages: { total: 3 } }, 0, 1, 'letter', false],
		['No mission, 48 approved messages', { messages: { total: 48 } }, 0, 1, 'letter', false],
		[
			'Mission of 400 characters, nothing else',
			{ mission: 'm'.repeat(400) },
			400,
			0,
			'letter',
			true
		],
		['Three videos, no messages', { videos: videos(3) }, 0, 3, 'letter', false],
		[
			'Three videos and one approved message',
			{ videos: videos(3), messages: { total: 1 } },
			0,
			4,
			'feature',
			false
		],
		[
			'Banner, mission and vision (332), four videos, 48 messages',
			{ ...MISSION_AND_VISION, videos: videos(4), messages: { total: 48 } },
			332,
			5,
			'feature',
			true
		],
		['Four videos, no messages', { videos: videos(4) }, 0, 4, 'feature', false]
	] as const)('%s', (_, holds, storyLength, extras, layout, aboutUs) => {
		expect(profileShape({ ...NOTHING, ...holds })).toEqual({
			layout,
			storyLength,
			extras,
			aboutUs
		});
	});
});

describe('a mission or vision that is empty after trimming', () => {
	it.each([
		['whitespace for a mission', { mission: ' \n\t ' }],
		['whitespace for both', { mission: '  ', vision: '\n' }],
		['an empty string for a vision', { vision: '' }]
	])('is not written: %s draws no About us and no story', (_, written) => {
		expect(profileShape({ ...NOTHING, ...written })).toEqual({
			layout: 'card',
			storyLength: 0,
			extras: 0,
			aboutUs: false
		});
	});

	it('still counts the other one when only one is blank', () => {
		expect(profileShape({ ...NOTHING, mission: '   ', vision: 'v'.repeat(10) })).toMatchObject({
			storyLength: 10,
			aboutUs: true
		});
	});
});

describe('the measures', () => {
	it('counts the mission and the vision trimmed, joined by one blank line', () => {
		expect(profileShape({ ...NOTHING, mission: '  abc \n', vision: '\n de ' }).storyLength).toBe(
			'abc\n\nde'.length
		);
	});

	it('counts either one alone with no blank line, and holds a vision alone to the card at 320', () => {
		expect(profileShape({ ...NOTHING, vision: 'v'.repeat(320) }).layout).toBe('card');
		expect(profileShape({ ...NOTHING, vision: 'v'.repeat(321) })).toMatchObject({
			storyLength: 321,
			layout: 'letter',
			aboutUs: true
		});
	});

	it('holds the card to 320 characters and turns to the letter at 321', () => {
		expect(profileShape({ ...NOTHING, mission: 'm'.repeat(320) }).layout).toBe('card');
		expect(profileShape({ ...NOTHING, mission: 'm'.repeat(321) }).layout).toBe('letter');
	});

	it('counts messages as one extra whatever their total, so Show more never moves the layout', () => {
		const at = (total: number) =>
			profileShape({ ...NOTHING, videos: videos(2), messages: { total } });
		expect(at(6)).toEqual(at(48));
		expect(at(1).extras).toBe(3);
	});
});

describe('the measures, edge by edge', () => {
	it('keeps the whitespace inside a text and trims only its ends', () => {
		const at = (inside: string) =>
			profileShape({ ...NOTHING, mission: `  ${inside}  ` }).storyLength;
		expect(at('one  two\nthree')).toBe('one  two\nthree'.length);
	});

	it('counts the whitespace inside a text toward the 320 that holds the card', () => {
		const mission = `${'m'.repeat(159)}\n\n${'m'.repeat(159)}`;
		expect(mission).toHaveLength(320);
		expect(profileShape({ ...NOTHING, mission }).layout).toBe('card');
		expect(profileShape({ ...NOTHING, mission: `${mission}\n` + 'm' }).layout).toBe('letter');
	});

	it('turns to the feature at the fourth extra: three videos and a message, never three alone', () => {
		const at = (count: number, total: number) =>
			profileShape({ ...NOTHING, videos: videos(count), messages: { total } });
		expect(at(3, 0)).toMatchObject({ extras: 3, layout: 'letter' });
		expect(at(3, 1)).toMatchObject({ extras: 4, layout: 'feature' });
		expect(at(4, 0)).toMatchObject({ extras: 4, layout: 'feature' });
	});
});
