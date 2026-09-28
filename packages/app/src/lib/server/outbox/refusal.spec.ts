import { describe, expect, it } from 'vitest';
import { ERROR_BODY_CHARS, refusal } from './refusal';

// what `last_error` keeps of a receiver's refusal: its words are a stranger's text, of any size,
// and the status line is the part a failing body read must not take with it.

describe('refusal()', () => {
	it('keeps the status line and the head of the body', async () => {
		const response = new Response('  down for maintenance  ', {
			status: 503,
			statusText: 'Service Unavailable'
		});

		expect(await refusal(response)).toBe('503 Service Unavailable — down for maintenance');
	});

	it('keeps the status line alone when the body is empty', async () => {
		expect(await refusal(new Response(null, { status: 404, statusText: 'Not Found' }))).toBe(
			'404 Not Found'
		);
	});

	it('keeps no more than its bound of the body, and reads no further than it needs', async () => {
		let pulled = 0;
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
			}
		});

		const kept = await refusal(
			new Response(endless, { status: 500, statusText: 'Internal Server Error' })
		);

		expect(kept).toBe(`500 Internal Server Error — ${'x'.repeat(ERROR_BODY_CHARS)}`);
		expect(pulled).toBeLessThan(10);
	});

	it('keeps the status line when the body breaks off mid-read', async () => {
		let pulls = 0;
		const broken = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				if (pulls === 1) controller.enqueue(new TextEncoder().encode('partial'));
				else controller.error(new TypeError('Network connection lost.'));
			}
		});

		expect(await refusal(new Response(broken, { status: 502, statusText: 'Bad Gateway' }))).toBe(
			'502 Bad Gateway — partial'
		);
	});
});
