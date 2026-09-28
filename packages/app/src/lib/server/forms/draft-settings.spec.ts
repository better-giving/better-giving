import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { draftSettings } from '../../page/settings';
import type { PostableAccountId } from '../db/postable';
import type { FormRecord } from './form-input';

// a page's draft donation settings are what publish copies onto its owned form row, so the draft's
// keys and the row's are one list: every key a form record carries but its id, name and status.

type Copied = Omit<FormRecord, 'id' | 'name' | 'status'>;

describe('a page’s draft donation settings', () => {
	it('carry exactly the keys of a form record publish copies onto', () => {
		expectTypeOf<keyof z.infer<typeof draftSettings>>().toEqualTypeOf<keyof Copied>();
		const record: FormRecord = {
			id: 'frm_1',
			name: 'Spring appeal',
			status: 'live',
			revenueAccountId: '4110' as PostableAccountId,
			minMinor: 500,
			maxMinor: null,
			currency: 'USD',
			programMode: 'pinned',
			programId: 'prg_1',
			suggestedAmounts: [2500, 5000],
			allowedOrigins: ['https://example.org']
		};
		const { id: _id, name: _name, status: _status, ...copied } = record;
		expect(draftSettings.parse(copied)).toEqual(copied);
	});
});
