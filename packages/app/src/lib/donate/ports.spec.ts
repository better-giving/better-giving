import type { PaymentSurface } from '@better-giving/form/embed/stripe';
import { describe, expect, it, vi } from 'vitest';
import { deploymentPorts } from './ports';

// the pledge id this page's card mints, pinned to `pledgeUuid` in packages/form/src/embed/runtime.ts:
// the same bytes make the same id, so the two renderers send one shape of `pledgeId`.

/** the pledge ports, over a surface nothing here reaches. */
const pledges = () => deploymentPorts({} as PaymentSurface).pledges;

/** an http page's `crypto`, which keeps `getRandomValues` alone (MDN, Crypto.getRandomValues). */
function insecureCrypto(fill: (bytes: Uint8Array) => void = (bytes) => bytes.fill(0xff)): void {
	vi.stubGlobal('crypto', {
		getRandomValues: <T extends ArrayBufferView>(bytes: T): T => {
			fill(bytes as unknown as Uint8Array);
			return bytes;
		}
	});
}

describe('the pledge id', () => {
	it('is minted on an http page, where `crypto.randomUUID` is not offered', () => {
		insecureCrypto();

		expect(pledges()?.id()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
	});

	it('sets the version and variant bits as the element’s does, over the bytes it drew', () => {
		insecureCrypto((bytes) => {
			for (let at = 0; at < bytes.length; at += 1) bytes[at] = at;
		});

		expect(pledges()?.id()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
	});

	it('is a fresh version 4 UUID on every mint', () => {
		const ports = pledges();
		const first = ports?.id();

		expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(ports?.id()).not.toBe(first);
	});
});
