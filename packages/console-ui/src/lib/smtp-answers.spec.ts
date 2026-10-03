import { describe, expect, it } from 'vitest';
import type { TestSend, VarsWritten } from '../api/types';
import { MAIL_GROUP, SIGN_IN_GROUP } from './secret-groups';
import type { GroupReport } from './secret-group-form';
import { type AnswerTo, type MailAnswers, NO_ANSWERS, keepAnswers } from './smtp-answers';

// a page's answers, one kept per block: a press in one block lands over the other's answer and must
// leave it standing (../routes/_sections.smtp.tsx, ../routes/_sections.password.tsx). this package
// has no DOM pool (../../vite.config.ts), so what is held here is the reading the page keeps, not
// what it draws.

const REFUSED: GroupReport = { group: MAIL_GROUP, errors: { SMTP_HOST: 'required' } };
const STORED: GroupReport = { group: MAIL_GROUP, written: { kind: 'set' } };
const SENT: TestSend = {
	kind: 'reported',
	report: { outcome: 'sent', detail: null, to: 'ops@riverbank.example' }
};

/** each answer in turn, as the page's action hands them over. */
const after = (...answers: AnswerTo<MailAnswers>[]) =>
	answers.reduce((kept, answer) => keepAnswers(kept, answer), NO_ANSWERS);

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

describe('the password page, keeping one answer per press', () => {
	const NONE: { secrets: GroupReport | null; freed: VarsWritten | null } = {
		secrets: null,
		freed: null
	};
	const REFUSED_PASSWORD: GroupReport = {
		group: SIGN_IN_GROUP,
		errors: { ADMIN_PASSWORD: 'Use at least 12 characters.' }
	};
	const FREED: VarsWritten = { kind: 'nothing' };

	it('still hands the fold a credentials refusal after a freed answer lands over it', () => {
		const kept = [{ secrets: REFUSED_PASSWORD }, { freed: FREED }].reduce(
			(held: typeof NONE, answer: AnswerTo<typeof NONE>) => keepAnswers(held, answer),
			NONE
		);

		expect(kept).toEqual({ secrets: REFUSED_PASSWORD, freed: FREED });
	});
});
