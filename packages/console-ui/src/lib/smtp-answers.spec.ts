import { describe, expect, it } from 'vitest';
import type { TestSend } from '../api/types';
import { MAIL_GROUP } from './secret-groups';
import type { GroupReport } from './secret-group-form';
import { NO_ANSWERS, keepAnswers } from './smtp-answers';

// the mail page's answers, one kept per block: a press in one block lands over the other's answer
// and must leave it standing (../routes/_sections.smtp.tsx). this package has no DOM pool
// (../../vite.config.ts), so what is held here is the reading the page keeps, not what it draws.

const REFUSED: GroupReport = { group: MAIL_GROUP, errors: { SMTP_HOST: 'required' } };
const STORED: GroupReport = { group: MAIL_GROUP, written: { kind: 'set' } };
const SENT: TestSend = {
	kind: 'reported',
	report: { outcome: 'sent', detail: null, to: 'ops@riverbank.example' }
};

/** each answer in turn, as the page's action hands them over. */
const after = (...answers: Parameters<typeof keepAnswers>[1][]) =>
	answers.reduce(keepAnswers, NO_ANSWERS);

describe('the mail page, keeping one answer per block', () => {
	it('still hands the fold a credentials refusal after a test send lands over it', () => {
		expect(after({ secrets: REFUSED }, { test: SENT }).secrets).toBe(REFUSED);
	});

	it('still reads a landed credentials write as landed after a test send, so Saved holds', () => {
		const { secrets } = after({ secrets: STORED }, { test: SENT });
		expect(secrets !== null && 'written' in secrets ? secrets.written.kind : null).toBe('set');
	});

	it('lets a new credentials answer replace the one it kept', () => {
		expect(after({ secrets: REFUSED }, { secrets: STORED }).secrets).toBe(STORED);
	});

	it('keeps the test send answer after a credentials answer lands over it', () => {
		expect(after({ test: SENT }, { secrets: REFUSED }).test).toBe(SENT);
	});
});
