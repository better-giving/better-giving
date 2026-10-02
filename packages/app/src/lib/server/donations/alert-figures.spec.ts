import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on how a money figure reads in a staff alert: `alertMoney` in ./delivery.ts, the way
// ./settled-notice.ts writes it, and never a bare count of minor units with a currency tacked on.
// the workers specs pin the alerts a fixture reaches; this catches the ones none does.
//
// it reads text, so it catches a currency followed by the suffix and not a figure spelled raw some
// other way. a problem sentence that names its figures in minor units (settle.ts's
// lines-against-settled refusal, worded to match `problemWith` in ./record.ts) names no currency,
// and is left alone.

const ALERTING = ['reverse.ts', 'settle.ts', 'collect.ts'];

describe('staff alert figures', () => {
	it.each(ALERTING)('%s writes no figure as minor units', (file) => {
		const source = readFileSync(resolve(import.meta.dirname, file), 'utf8');

		expect(source).not.toMatch(/[cC]urrency(?:\s*\?\?\s*'')?\}\s*\(minor units\)/);
	});
});
