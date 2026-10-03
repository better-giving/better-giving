import { describe, expect, it } from 'vitest';
import { putsAway } from './secret-group-form';

// what shutting the fold a group stands in does to it. ../../vite.config.ts pins one node pool and no
// dom, so the `toggle` listener is held at the decision it makes rather than at the event.

describe('a group whose fold is shut', () => {
	it('is put back at rest when nothing of its own is being written', () => {
		expect(putsAway(false, false)).toBe(true);
	});

	it('is left as it stands while its own write is in flight', () => {
		// the answer is still to land on these boxes: emptied under it, a refusal names a box whose
		// contents are gone, and the group it reopens stands inside a fold that is shut.
		expect(putsAway(false, true)).toBe(false);
	});

	it('is left alone by the fold opening', () => {
		expect(putsAway(true, false)).toBe(false);
		expect(putsAway(true, true)).toBe(false);
	});
});
