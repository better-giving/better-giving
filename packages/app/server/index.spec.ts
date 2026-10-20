import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the server entry as an operator runs it, refusing to start: a child process with an environment
// of the case's own and no database, so nothing here ever listens.

const ENTRY = resolve(import.meta.dirname, 'index.ts');

function start(env: Record<string, string>) {
	const child = spawnSync(process.execPath, [ENTRY], {
		env: { PATH: process.env.PATH ?? '', ...env },
		encoding: 'utf8',
		timeout: 30_000
	});
	return { status: child.status, lines: child.stderr.trim().split('\n') };
}

describe('the server entry, started without what it needs', () => {
	it('exits non-zero naming each missing value on a line of its own', () => {
		const { status, lines } = start({});

		expect(status).toBe(1);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/^ADMIN_PASSWORD /);
		expect(lines[1]).toMatch(/^BETTER_AUTH_SECRET /);
	});

	it('names only what is missing, and never a value that is set', () => {
		const { status, lines } = start({
			ADMIN_PASSWORD: 'correct-horse-battery',
			BETTER_AUTH_SECRET: ' '
		});

		expect(status).toBe(1);
		expect(lines).toEqual([expect.stringMatching(/^BETTER_AUTH_SECRET /)]);
		expect(lines.join('\n')).not.toContain('correct-horse-battery');
	});

	it('goes on past both, to the database, where both are set', () => {
		const { status, lines } = start({ ADMIN_PASSWORD: 'a', BETTER_AUTH_SECRET: 'b' });

		expect(status).toBe(1);
		expect(lines.join('\n')).toContain('DATABASE_URL');
		expect(lines.join('\n')).not.toMatch(/ADMIN_PASSWORD|BETTER_AUTH_SECRET/);
	});
});
