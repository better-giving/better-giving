import { describe, expect, it } from 'vitest';
import { main, pairs } from './deploy-vars.js';

/**
 * a spawn that records and never runs anything.
 *
 * what it is called with is the whole of this script's contract with the outside world, and it is
 * also the one call a test may not let through: the real one deploys, applies migrations to a
 * remote database, and is the one-way door DEPLOY.md is written around.
 */
function spawnStub(status = 0) {
	const calls = [];
	const spawn = (command, args, options) => {
		calls.push({ command, args, options });
		return { status, error: undefined };
	};
	return { spawn, calls };
}

/** the script's own arguments, with the file and the deploy both stubbed out. */
function run(text, argv = ['.deploy.vars'], status = 0) {
	const { spawn, calls } = spawnStub(status);
	const said = [];
	const code = main(argv, {
		readFile: () => {
			if (text === null) throw new Error('ENOENT');
			return text;
		},
		spawn,
		say: (line) => said.push(line)
	});
	return { code, calls, said };
}

describe('reading the file a deployment is configured from', () => {
	it('takes a quoted value without its quotes', () => {
		expect(pairs('A=\'one\'\nB="two"\n', 'f')).toEqual([
			['A', 'one'],
			['B', 'two']
		]);
	});

	/**
	 * everything inside the quotes survives, which is why DEPLOY.md tells an operator to write them.
	 * a `#` in a password is a comment character and a space is a word break to anything reading a
	 * line as shell; here both are just the value.
	 */
	it('keeps a hash, a space and a backslash inside the quotes', () => {
		expect(pairs("SMTP_PASSWORD='a b#c\\\\d'\n", 'f')).toEqual([['SMTP_PASSWORD', 'a b#c\\\\d']]);
	});

	it('keeps a colon, which is what the flag splits on', () => {
		expect(pairs("BETTER_AUTH_URL='https://donate.example.org'\n", 'f')).toEqual([
			['BETTER_AUTH_URL', 'https://donate.example.org']
		]);
	});

	it('skips blank lines and comments', () => {
		expect(pairs('\n# a note\n\nA=one\n', 'f')).toEqual([['A', 'one']]);
	});

	/**
	 * the case this parse exists for. a line the parser cannot read is a value that would not reach
	 * the deployment, and a skip there is invisible: the deploy succeeds and one of the thirteen is
	 * quietly unset.
	 */
	it('refuses a line it cannot read, naming the line number', () => {
		expect(() => pairs('A=one\nnot a pair\n', 'f')).toThrow('f:2');
	});
});

describe('deploying the file', () => {
	it('appends one --var per line, in the order the file holds them', () => {
		const { code, calls } = run("A='one'\nB='two'\n");

		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe('pnpm');
		expect(calls[0].args).toEqual(['run', 'deploy', '--var', 'A:one', '--var', 'B:two']);
	});

	/**
	 * an argument list and no shell, which is what keeps a live key out of a shell's parsing as well
	 * as out of its history. `shell: true` here would put every value back through one.
	 */
	it('runs the deploy without a shell', () => {
		const { calls } = run("A='one'\n");

		expect(calls[0].options.shell).toBeUndefined();
	});

	it('passes anything after the file through to the deploy', () => {
		const { calls } = run("A='one'\n", ['.deploy.vars', '--dry-run']);

		expect(calls[0].args).toEqual(['run', 'deploy', '--var', 'A:one', '--dry-run']);
	});

	it('says which names it is deploying and none of their values', () => {
		const { said } = run("ADMIN_PASSWORD='a-real-one'\n");

		expect(said.join('\n')).toContain('ADMIN_PASSWORD');
		expect(said.join('\n')).not.toContain('a-real-one');
	});

	it('carries the deploy’s own exit code back', () => {
		expect(run("A='one'\n", ['.deploy.vars'], 2).code).toBe(2);
	});

	// each of these deploys nothing, which is the point: a run that cannot carry the values must not
	// be a run that carries some of them, or none of them, over a deployment that is holding them.
	it.each([
		{ what: 'no file argument', text: "A='one'\n", argv: [] },
		{ what: 'a file that is not there', text: null, argv: ['.deploy.vars'] },
		{ what: 'a file holding nothing', text: '# only a comment\n', argv: ['.deploy.vars'] },
		{ what: 'a line it cannot read', text: 'not a pair\n', argv: ['.deploy.vars'] }
	])('refuses to deploy at all on $what', ({ text, argv }) => {
		const { code, calls } = run(text, argv);

		expect(code).toBe(1);
		expect(calls).toEqual([]);
	});
});
