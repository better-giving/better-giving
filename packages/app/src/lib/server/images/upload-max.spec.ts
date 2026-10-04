import { IMAGE_UPLOAD_MAX } from '@better-giving/operator/images/resize';
import { expect, it } from 'vitest';
import { IMAGE_BYTES_MAX } from '../db/schema';

// the browser's resize is held to the database's cap here, where both can be imported: the resize
// lives in `packages/operator`, which imports nothing of this app's.

it('posts no more than the database will hold', () => {
	expect(IMAGE_UPLOAD_MAX).toBe(IMAGE_BYTES_MAX);
});
