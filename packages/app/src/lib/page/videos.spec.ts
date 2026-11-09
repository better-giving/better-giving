import { describe, expect, it } from 'vitest';
import { youTubeVideoId } from './videos';

// which pasted links the Videos card takes as one YouTube video, and the id it reads from each.

const ID = 'dQw4w9WgXcQ';

describe('youTubeVideoId()', () => {
	it.each([
		`https://www.youtube.com/watch?v=${ID}`,
		`https://youtube.com/watch?v=${ID}`,
		`https://m.youtube.com/watch?v=${ID}`,
		`http://www.youtube.com/watch?v=${ID}`,
		`https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
		`https://www.youtube.com/watch?v=${ID}&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG`,
		`https://youtu.be/${ID}`,
		`https://youtu.be/${ID}?si=abc&t=10`,
		`https://www.youtube.com/shorts/${ID}`,
		`https://youtube.com/shorts/${ID}?feature=share`,
		`https://www.youtube.com/embed/${ID}`,
		`https://m.youtube.com/embed/${ID}?start=3`,
		`  www.youtube.com/watch?v=${ID}  `,
		`youtu.be/${ID}`
	])('reads the video id from %s', (link) => {
		expect(youTubeVideoId(link)).toBe(ID);
	});

	it.each([
		['a playlist', 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'],
		['an embedded playlist', 'https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdm'],
		['a channel', 'https://www.youtube.com/channel/UC38IQsAvIsxxjztdMZQtwHA'],
		['a handle', 'https://www.youtube.com/@riverbanktrust'],
		['a legacy channel', 'https://www.youtube.com/c/RiverbankTrust'],
		['a user page', 'https://www.youtube.com/user/riverbank'],
		['the home page', 'https://www.youtube.com/'],
		['a watch page with no video', 'https://www.youtube.com/watch?list=PLx0sYbCqOb8TBPRdm'],
		['a short id', 'https://youtu.be/dQw4w9WgXc'],
		['a long id', `https://www.youtube.com/watch?v=${ID}x`],
		['an id with a stray character', 'https://www.youtube.com/shorts/dQw4w9WgX.Q'],
		['another host', `https://vimeo.com/${ID}`],
		['a look-alike host', `https://youtube.com.example/watch?v=${ID}`],
		['a subdomain we do not take', `https://music.youtube.com/watch?v=${ID}`],
		['another scheme', `ftp://www.youtube.com/watch?v=${ID}`],
		['a javascript link', `javascript:alert("youtube.com/watch?v=${ID}")`],
		['words', 'my video'],
		['nothing', '']
	])('takes %s as no video', (_, link) => {
		expect(youTubeVideoId(link)).toBeNull();
	});
});
