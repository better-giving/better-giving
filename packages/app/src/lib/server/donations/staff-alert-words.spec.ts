import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// the guard on the words a staff alert may use: CLAUDE.md → Product surface, "UI strings say what a
// fundraiser says". an alert is read by whoever runs the fundraising, not by whoever set the app
// up, so the words below — each a name for this app's machinery — never reach one.
//
// a sender is every module under `src/lib/server/` that imports `alert` (../email/alert.ts, or its
// re-export in ./delivery.ts). in each, the `headline`, `body` and `action` of every object literal
// are read, and so is whatever those three name: a constant, a local, a function's returns, and an
// import from another module — `missingFeeCorrection` in ./entries.ts is reached that way. facts
// are not read: a fact's value is an id, a figure, or what a processor or the database answered.
//
// it reads source, so a sentence assembled from a value it cannot follow — a parameter, or a `let`
// filled in later — goes unread; what it defends against is the old vocabulary written back in.

const SERVER = resolve(import.meta.dirname, '..');

const BANNED = [
	'deployment',
	'journal entr',
	'backlog',
	'posted to the books',
	'commitment',
	'delivery'
] as const;

const ALERT_PARTS = new Set(['headline', 'body', 'action']);

function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

function serverFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) serverFiles(path, out);
		else if (entry.name.endsWith('.ts') && !isTest(entry.name)) out.push(path);
	}
	return out;
}

function parse(path: string): ts.SourceFile {
	return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** imports `alert` from ../email/alert.ts or from ./delivery.ts. */
function importsAlert(file: ts.SourceFile): boolean {
	return file.statements.some((statement) => {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			return false;
		}
		const from = resolve(dirname(file.fileName), statement.moduleSpecifier.text);
		if (from !== join(SERVER, 'email/alert') && from !== join(SERVER, 'donations/delivery')) {
			return false;
		}
		const bindings = statement.importClause?.namedBindings;
		return (
			bindings !== undefined &&
			ts.isNamedImports(bindings) &&
			bindings.elements.some((e) => !e.isTypeOnly && e.name.text === 'alert')
		);
	});
}

type Sentence = { readonly at: string; readonly text: string };

/**
 * every alert sentence the senders write, as text with each placeholder dropped. a program over
 * `src/lib/server/` alone, so a relative import resolves and a package's does not.
 */
function alertSentences(): { senders: string[]; sentences: Sentence[] } {
	const sources = new Map(serverFiles(SERVER).map((path) => [path, parse(path)]));
	const senders = [...sources.values()].filter(importsAlert).map((file) => file.fileName);
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noLib: true,
		types: []
	};
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (name) => sources.get(resolve(name));
	host.fileExists = (name) => sources.has(resolve(name));
	const program = ts.createProgram(senders, options, host);
	const checker = program.getTypeChecker();

	const sentences: Sentence[] = [];
	for (const sender of senders) {
		const file = program.getSourceFile(sender);
		if (file === undefined) continue;
		const visit = (node: ts.Node): void => {
			if (
				ts.isPropertyAssignment(node) &&
				ts.isIdentifier(node.name) &&
				ALERT_PARTS.has(node.name.text)
			) {
				const { line } = file.getLineAndCharacterOfPosition(node.getStart());
				sentences.push({
					at: `${relative(SERVER, sender)}:${line + 1} ${node.name.text}`,
					text: textOf(checker, node.initializer, new Set())
				});
			}
			ts.forEachChild(node, visit);
		};
		visit(file);
	}
	return { senders, sentences };
}

/** the literal text an expression can produce, following what it names. */
function textOf(checker: ts.TypeChecker, node: ts.Node, seen: Set<ts.Node>): string {
	if (seen.has(node)) return '';
	seen.add(node);
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		return (
			node.head.text +
			node.templateSpans
				.map((span) => textOf(checker, span.expression, seen) + span.literal.text)
				.join('')
		);
	}
	if (ts.isIdentifier(node)) {
		let symbol = checker.getSymbolAtLocation(node);
		if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
			symbol = checker.getAliasedSymbol(symbol);
		}
		return (symbol?.declarations ?? []).map((d) => declared(checker, d, seen)).join(' ');
	}
	const parts: string[] = [];
	ts.forEachChild(node, (child) => {
		parts.push(textOf(checker, child, seen));
	});
	return parts.join('');
}

/** what a constant, a local or a function's returns hold. */
function declared(
	checker: ts.TypeChecker,
	declaration: ts.Declaration,
	seen: Set<ts.Node>
): string {
	if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
		return textOf(checker, declaration.initializer, seen);
	}
	if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) {
		const returns: string[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isReturnStatement(node) && node.expression !== undefined) {
				returns.push(textOf(checker, node.expression, seen));
			} else if (!ts.isFunctionLike(node)) {
				ts.forEachChild(node, visit);
			}
		};
		ts.forEachChild(declaration.body, visit);
		return returns.join(' ');
	}
	return '';
}

describe('staff alerts', () => {
	const { senders, sentences } = alertSentences();

	it('reads every sender, and follows a sentence into the module it is imported from', () => {
		expect(senders.map((path) => relative(SERVER, path)).sort()).toEqual([
			'accounting/deliver.ts',
			'donations/collect.ts',
			'donations/crypto-pending.ts',
			'donations/grant-requested.ts',
			'donations/quote.ts',
			'donations/receipt.ts',
			'donations/refund-notice.ts',
			'donations/reverse.ts',
			'donations/settle.ts',
			'donations/settled-notice.ts',
			'donations/tribute-notice.ts'
		]);
		// a phrase written only in ./entries.ts's missingFeeCorrection.
		expect(
			sentences.some(
				(s) =>
					s.at.startsWith('donations/settle.ts') &&
					s.text.includes('dated the day the payment settled')
			)
		).toBe(true);
	});

	it.each(BANNED)('never say %s', (word) => {
		const said = sentences
			.filter((s) => s.text.toLowerCase().includes(word))
			.map((s) => `${s.at}: ${s.text}`);
		expect(said).toEqual([]);
	});
});
