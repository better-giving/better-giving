import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// the guard on the words a staff alert may use: CLAUDE.md → Product surface, "UI strings say what a
// fundraiser says". an alert is read by whoever runs the fundraising, not by whoever set the app
// up, so the words below — each a name for this app's machinery — never reach one.
//
// a sender is every module under `src/` holding a call to `alert` (../email/alert.ts), however it
// was imported — by a relative path, through `$lib/`, or by ./delivery.ts's re-export — because the
// call is found by what its callee resolves to rather than by how the import is spelt. every
// argument after `deps` is read, and so is whatever it names: a constant, a local and what is
// assigned or pushed onto it later, a destructured binding's initializer, a function's returns, an
// import from another module, and a parameter — as the call being read passed it, or, where it
// holds the alert's input or a string, as every call passes it. a parameter holding a record such
// as `deps` or a settlement is data and is not followed, and neither is a method's body.
//
// a fact's label is read and its value is not. most values are an id, a figure, or what a
// processor or the database answered; the reasons the app writes into one itself (`unpostable` in
// ./entries.ts, `recognitionOf` in ./settle.ts) are held to these words by review alone.
//
// out of its reach, and so unguarded: mail sent with `mailOperator` and no `alert` call
// (../webhooks/paused-mail.ts), and the template that wraps it in packages/emails
// (src/templates/destination-paused.tsx).

const SRC = resolve(import.meta.dirname, '../../..');
const SERVER = resolve(import.meta.dirname, '..');
const ALERT = join(SERVER, 'email/alert.ts');

const BANNED: readonly RegExp[] = [
	/deployment/,
	/journal entr/,
	/backlog/,
	/posted to the books/,
	/commitment/,
	// a processor's webhook delivery, in both numbers; an email that was "delivered" is plain words.
	/deliver(?:y|ies)/
];

function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(path, out);
		else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) out.push(path);
	}
	return out;
}

type Sentence = { readonly at: string; readonly text: string };

/** a parameter's argument at one call, and the parameters that call's own function was given. */
type Bound = { readonly node: ts.Expression; readonly env: Env };
type Env = ReadonlyMap<ts.ParameterDeclaration, Bound>;
const NONE: Env = new Map();

/** every alert sentence a tree of `path → source` writes, each placeholder read as what it holds. */
function alertSentences(tree: ReadonlyMap<string, string>): {
	senders: string[];
	sentences: Sentence[];
} {
	const sources = new Map(
		[...tree].map(([path, text]) => [
			path,
			ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
		])
	);
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		paths: { '$lib/*': [join(SRC, 'lib/*')] },
		jsx: ts.JsxEmit.ReactJSX,
		noLib: true,
		types: []
	};
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (name) => sources.get(resolve(name));
	host.fileExists = (name) => sources.has(resolve(name));
	const program = ts.createProgram([...sources.keys()], options, host);
	const checker = program.getTypeChecker();
	const files = [...sources.keys()].flatMap((path) => program.getSourceFile(path) ?? []);

	const resolved = (node: ts.Node): ts.Symbol | undefined => {
		const symbol = checker.getSymbolAtLocation(node);
		return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
			? checker.getAliasedSymbol(symbol)
			: symbol;
	};
	const calleeName = (call: ts.CallExpression): ts.Node =>
		ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;

	const calls = new Map<ts.Symbol, ts.CallExpression[]>();
	for (const file of files) {
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const callee = resolved(calleeName(node));
				const known = callee === undefined ? undefined : calls.get(callee);
				if (known !== undefined) known.push(node);
				else if (callee !== undefined) calls.set(callee, [node]);
			}
			ts.forEachChild(node, visit);
		};
		visit(file);
	}
	const alertSymbol = [...calls.keys()].find((symbol) =>
		(symbol.declarations ?? []).some(
			(d) =>
				ts.isFunctionDeclaration(d) &&
				d.name?.text === 'alert' &&
				d.getSourceFile().fileName === ALERT
		)
	);
	const alertCalls = alertSymbol === undefined ? [] : (calls.get(alertSymbol) ?? []);

	const at = (node: ts.Node, what: string): string => {
		const file = node.getSourceFile();
		const { line } = file.getLineAndCharacterOfPosition(node.getStart());
		return `${relative(SERVER, file.fileName)}:${line + 1} ${what}`;
	};

	/** the function a parameter belongs to, by the symbol its calls name it with. */
	const functionOf = (parameter: ts.ParameterDeclaration): ts.Symbol | undefined => {
		const fn = parameter.parent;
		if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) return resolved(fn.name);
		if (
			(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
			ts.isVariableDeclaration(fn.parent) &&
			ts.isIdentifier(fn.parent.name)
		) {
			return resolved(fn.parent.name);
		}
		return undefined;
	};

	/** what each call of a parameter's function passes it, read in the caller's own context. */
	const passed = (parameter: ts.ParameterDeclaration): Bound[] => {
		const fn = functionOf(parameter);
		if (fn === undefined || parameter.dotDotDotToken !== undefined) return [];
		const index = (parameter.parent as ts.SignatureDeclaration).parameters.indexOf(parameter);
		return (calls.get(fn) ?? []).flatMap((call) => {
			const arg = call.arguments[index];
			return arg === undefined ? [] : [{ node: arg, env: NONE }];
		});
	};

	const read = (node: ts.Node, env: Env, seen: Set<ts.Node>, depth = 0): string => {
		if (depth > 60) return '';
		const next = (child: ts.Node) => read(child, env, seen, depth + 1);

		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
		if (ts.isTemplateExpression(node)) {
			return (
				node.head.text +
				node.templateSpans.map((span) => next(span.expression) + span.literal.text).join('')
			);
		}
		if (ts.isBinaryExpression(node)) {
			switch (node.operatorToken.kind) {
				case ts.SyntaxKind.PlusToken:
					return next(node.left) + next(node.right);
				case ts.SyntaxKind.QuestionQuestionToken:
				case ts.SyntaxKind.BarBarToken:
				case ts.SyntaxKind.AmpersandAmpersandToken:
					return `${next(node.left)} ${next(node.right)}`;
				default:
					// a comparison or an arithmetic answers with a boolean or a number.
					return '';
			}
		}
		// the test picks between the two and is never said itself; nor is a key or a negation.
		if (ts.isConditionalExpression(node)) return `${next(node.whenTrue)} ${next(node.whenFalse)}`;
		if (ts.isElementAccessExpression(node)) return next(node.expression);
		if (ts.isPrefixUnaryExpression(node) || ts.isTypeOfExpression(node)) return '';
		if (ts.isObjectLiteralExpression(node)) {
			return node.properties.map((property) => readProperty(property, env, seen, depth)).join(' ');
		}
		if (ts.isFunctionLike(node)) return returnsOf(node, env, seen, depth);
		if (ts.isCallExpression(node)) {
			const declarations = resolved(calleeName(node))?.declarations ?? [];
			const callee = declarations.map(functionBody).find((fn) => fn !== undefined);
			if (callee !== undefined) {
				const bound = new Map<ts.ParameterDeclaration, Bound>();
				callee.parameters.forEach((parameter, i) => {
					const arg = node.arguments[i];
					if (arg !== undefined) bound.set(parameter, { node: arg, env });
				});
				return returnsOf(callee, bound, seen, depth);
			}
			// a method or a port's signature answers with data rather than words.
			if (declarations.length > 0) return '';
			// a callee no file declares, such as an array's `join`: what it is called on and with is
			// all there is to read.
			return [node.expression, ...node.arguments].map((child) => next(child)).join(' ');
		}
		if (ts.isPropertyAccessExpression(node)) {
			const member = resolved(node.name)?.declarations ?? [];
			const held = member.filter(
				(d) => ts.isPropertyAssignment(d) || ts.isShorthandPropertyAssignment(d)
			);
			return held.length > 0
				? held
						.map((d) => readProperty(d as ts.ObjectLiteralElementLike, NONE, seen, depth))
						.join(' ')
				: next(node.expression);
		}
		if (ts.isIdentifier(node)) {
			const symbol = resolved(node);
			return (symbol?.declarations ?? []).map((d) => declared(d, env, seen, depth)).join(' ');
		}
		const parts: string[] = [];
		ts.forEachChild(node, (child) => {
			parts.push(next(child));
		});
		return parts.join(' ');
	};

	/** a property's words, never a fact's value and never a method's body. */
	const readProperty = (
		property: ts.ObjectLiteralElementLike,
		env: Env,
		seen: Set<ts.Node>,
		depth: number
	): string => {
		if (ts.isSpreadAssignment(property)) return read(property.expression, env, seen, depth + 1);
		const name = property.name;
		if (
			name !== undefined &&
			(ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
			name.text === 'value'
		) {
			return '';
		}
		if (ts.isShorthandPropertyAssignment(property)) {
			const symbol = checker.getShorthandAssignmentValueSymbol(property);
			return (symbol?.declarations ?? []).map((d) => declared(d, env, seen, depth)).join(' ');
		}
		if (ts.isPropertyAssignment(property) && !ts.isFunctionLike(property.initializer)) {
			return read(property.initializer, env, seen, depth + 1);
		}
		return '';
	};

	/** what a function hands back, its parameters read through `env`. */
	const returnsOf = (
		fn: ts.SignatureDeclaration,
		env: Env,
		seen: Set<ts.Node>,
		depth: number
	): string => {
		const body = (fn as ts.FunctionLikeDeclaration).body;
		if (body === undefined) return '';
		if (!ts.isBlock(body)) return read(body, env, seen, depth + 1);
		const returns: string[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isReturnStatement(node) && node.expression !== undefined) {
				returns.push(read(node.expression, env, seen, depth + 1));
			} else if (!ts.isFunctionLike(node)) {
				ts.forEachChild(node, visit);
			}
		};
		ts.forEachChild(body, visit);
		return returns.join(' ');
	};

	/** what a constant, a local, a destructured binding, a parameter or a function holds. */
	const declared = (d: ts.Declaration, env: Env, seen: Set<ts.Node>, depth: number): string => {
		if (ts.isParameter(d)) {
			const bound = env.get(d);
			if (bound !== undefined) return read(bound.node, bound.env, seen, depth + 1);
			// a record such as `deps` or a settlement is data, and every caller's would be read.
			if (seen.has(d) || !wordsOnly(d.type)) return '';
			seen.add(d);
			return [
				...(d.initializer === undefined ? [] : [read(d.initializer, NONE, seen, depth + 1)]),
				...passed(d).map((call) => read(call.node, call.env, seen, depth + 1))
			].join(' ');
		}
		if (seen.has(d)) return '';
		seen.add(d);
		if (ts.isBindingElement(d)) {
			let holder: ts.Node = d.parent;
			while (
				ts.isObjectBindingPattern(holder) ||
				ts.isArrayBindingPattern(holder) ||
				ts.isBindingElement(holder)
			) {
				holder = holder.parent;
			}
			return ts.isVariableDeclaration(holder) || ts.isParameter(holder)
				? declared(holder, env, seen, depth)
				: '';
		}
		if (ts.isVariableDeclaration(d)) {
			const later = ts.isIdentifier(d.name) ? laterWrites(d.name) : [];
			// a local reads the parameters of the call it is inside as that call bound them.
			return [d.initializer, ...later]
				.flatMap((node) => (node === undefined ? [] : [read(node, env, seen, depth + 1)]))
				.join(' ');
		}
		if (ts.isFunctionDeclaration(d)) return returnsOf(d, NONE, seen, depth);
		if (ts.isPropertyAssignment(d) || ts.isShorthandPropertyAssignment(d)) {
			return readProperty(d, NONE, seen, depth);
		}
		return '';
	};

	/** what is assigned to a local after its declaration, or pushed onto it. */
	const laterWrites = (name: ts.Identifier): ts.Expression[] => {
		const symbol = resolved(name);
		const written: ts.Expression[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isIdentifier(node) && node !== name && resolved(node) === symbol) {
				const parent = node.parent;
				if (
					ts.isBinaryExpression(parent) &&
					parent.left === node &&
					parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
					parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
				) {
					written.push(parent.right);
				} else if (
					ts.isPropertyAccessExpression(parent) &&
					parent.expression === node &&
					['push', 'unshift'].includes(parent.name.text) &&
					ts.isCallExpression(parent.parent)
				) {
					written.push(...parent.parent.arguments);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(name.getSourceFile());
		return written;
	};

	/** one sentence per property where an alert's input is written out, else one for the whole. */
	const sentencesOf = (node: ts.Expression, seen: Set<ts.Node>): Sentence[] => {
		if (ts.isObjectLiteralExpression(node)) {
			return node.properties.map((property) => ({
				at: at(property, property.name?.getText() ?? '...'),
				text: readProperty(property, NONE, new Set(seen), 0)
			}));
		}
		if (ts.isIdentifier(node)) {
			const parameter = resolved(node)?.declarations?.find(ts.isParameter);
			if (parameter !== undefined && !seen.has(parameter)) {
				const through = new Set(seen).add(parameter);
				return passed(parameter).flatMap((call) => sentencesOf(call.node, through));
			}
		}
		return [{ at: at(node, 'input'), text: read(node, NONE, new Set(seen)) }];
	};

	return {
		senders: [...new Set(alertCalls.map((call) => call.getSourceFile().fileName))],
		sentences: alertCalls.flatMap((call) =>
			call.arguments.slice(1).flatMap((arg) => sentencesOf(arg, new Set()))
		)
	};
}

/** a parameter that can only hold words: a string, a literal, or a union of them. */
function wordsOnly(type: ts.TypeNode | undefined): boolean {
	if (type === undefined) return true;
	if (ts.isParenthesizedTypeNode(type)) return wordsOnly(type.type);
	if (ts.isUnionTypeNode(type)) return type.types.every(wordsOnly);
	return (
		type.kind === ts.SyntaxKind.StringKeyword ||
		ts.isLiteralTypeNode(type) ||
		ts.isTemplateLiteralTypeNode(type)
	);
}

/** the body a call's callee runs, where the callee is a function this program can see. */
function functionBody(d: ts.Declaration): ts.SignatureDeclaration | undefined {
	if (ts.isFunctionDeclaration(d)) return d;
	if (
		ts.isVariableDeclaration(d) &&
		d.initializer !== undefined &&
		(ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
	) {
		return d.initializer;
	}
	return undefined;
}

function said(sentences: readonly Sentence[]): string[] {
	return sentences.flatMap((s) =>
		BANNED.filter((word) => word.test(s.text.toLowerCase())).map(
			(word) => `${word.source} in ${s.at}: ${s.text}`
		)
	);
}

const SENDER = join(SERVER, 'donations/mutant.ts');
const STUB = 'export async function alert(deps: unknown, input: unknown): Promise<void> {}';
const IMPORT = "import { alert } from '../email/alert';";

/** a sender per shape a sentence can take, each saying a banned word in that shape alone. */
const MUTANTS: readonly [string, Record<string, string>][] = [
	[
		'a literal',
		{
			[SENDER]: `${IMPORT}
export const go = (deps: unknown) =>
	alert(deps, { headline: 'The deployment is down', body: '', facts: [], action: null });`
		}
	],
	[
		'a shorthand property',
		{
			[SENDER]: `${IMPORT}
const body = 'The deployment is down.';
export const go = (deps: unknown) => alert(deps, { headline: 'A gift', body, facts: [], action: null });`
		}
	],
	[
		'a quoted key',
		{
			[SENDER]: `${IMPORT}
export const go = (deps: unknown) =>
	alert(deps, { headline: 'A gift', 'body': 'The deployment is down.', facts: [], action: null });`
		}
	],
	[
		'a parameter',
		{
			[SENDER]: `${IMPORT}
async function tell(deps: unknown, text: string) {
	await alert(deps, { headline: text, body: '', facts: [], action: null });
}
export const go = (deps: unknown) => tell(deps, 'The deployment broke');`
		}
	],
	[
		'a parameter holding the whole input',
		{
			[SENDER]: `${IMPORT}
async function tellStaff(deps: unknown, input: unknown) {
	await alert(deps, input);
}
export const go = (deps: unknown) =>
	tellStaff(deps, { headline: 'A gift', body: 'The deployment broke.', facts: [], action: null });`
		}
	],
	[
		'a destructured local',
		{
			[SENDER]: `${IMPORT}
export function go(deps: unknown, lost: boolean) {
	const [what, action] = lost ? ['The deployment lost it.', null] : ['It was won.', 'Nothing to do.'];
	return alert(deps, { headline: 'A dispute', body: what, facts: [], action });
}`
		}
	],
	[
		'copy from a module that does not import alert',
		{
			[join(SERVER, 'donations/mutant-copy.ts')]: `export function copy() {
	return { headline: 'The deployment is down', body: '', facts: [], action: null };
}`,
			[SENDER]: `${IMPORT}
import { copy } from './mutant-copy';
export const go = (deps: unknown) => alert(deps, copy());`
		}
	],
	[
		'an import through the $lib alias',
		{
			[SENDER]: `import { alert } from '$lib/server/email/alert';
export const go = (deps: unknown) =>
	alert(deps, { headline: 'The deployment is down', body: '', facts: [], action: null });`
		}
	],
	[
		'an import through a re-export, renamed',
		{
			[join(SERVER, 'donations/delivery.ts')]: "export { alert } from '../email/alert';",
			[SENDER]: `import { alert as tell } from './delivery';
export const go = (deps: unknown) =>
	tell(deps, { headline: 'The deployment is down', body: '', facts: [], action: null });`
		}
	],
	[
		'a plural',
		{
			[SENDER]: `${IMPORT}
export const go = (deps: unknown) =>
	alert(deps, { headline: 'Some deliveries failed', body: '', facts: [], action: null });`
		}
	],
	[
		'a fact label',
		{
			[SENDER]: `${IMPORT}
export const go = (deps: unknown) =>
	alert(deps, {
		headline: 'A gift',
		body: '',
		facts: [{ label: 'Journal entry backlog', value: '3' }],
		action: null
	});`
		}
	],
	[
		'a sentence pushed on later',
		{
			[SENDER]: `${IMPORT}
export function go(deps: unknown) {
	const sentence = ['It came in.'];
	sentence.push('The deployment kept it.');
	return alert(deps, { headline: 'A gift', body: sentence.join(' '), facts: [], action: null });
}`
		}
	],
	[
		'a local assigned later',
		{
			[SENDER]: `${IMPORT}
export function go(deps: unknown, late: boolean) {
	let body = 'It came in.';
	if (late) body = 'The deployment was late.';
	return alert(deps, { headline: 'A gift', body, facts: [], action: null });
}`
		}
	]
];

describe('the reader', () => {
	const treeOf = (files: Record<string, string>) =>
		new Map([[ALERT, STUB], ...Object.entries(files)]);

	it.each(MUTANTS)('hears a banned word said in %s', (_, files) => {
		expect(said(alertSentences(treeOf(files)).sentences)).not.toEqual([]);
	});

	it('leaves a fact’s value unread', () => {
		const { sentences } = alertSentences(
			treeOf({
				[SENDER]: `${IMPORT}
export const go = (deps: unknown) =>
	alert(deps, {
		headline: 'A gift',
		body: '',
		facts: [{ label: 'Reason', value: 'The deployment answered 500.' }],
		action: null
	});`
			})
		);

		expect(said(sentences)).toEqual([]);
		expect(sentences.map((s) => s.text).join(' ')).toContain('Reason');
	});
});

describe('staff alerts', () => {
	const { senders, sentences } = alertSentences(
		new Map(sourceFiles(SRC).map((path) => [path, readFileSync(path, 'utf8')]))
	);

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

	it.each(BANNED)('never says %s', (word) => {
		expect(said(sentences).filter((hit) => hit.startsWith(`${word.source} in`))).toEqual([]);
	});
});
