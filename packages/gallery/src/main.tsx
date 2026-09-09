import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

/*
 * the component gallery: a dev-only page whose whole job is rendering @better-giving/operator's
 * components and their states so a builder can save a file and see it. it is never deployed and
 * never built — ./package.json declares no `build` script, and the root package.json's `build` and
 * `deploy` scripts filter to @better-giving/app alone.
 *
 * registration is the file existing. `import.meta.glob` below reads every module under
 * src/previews/*.tsx, eagerly, and renders its default export under the filename as the label.
 * there is no list of previews kept anywhere else — a config list is a second place to update, and
 * it is the half that gets forgotten: a component ships and is missing from the one surface a
 * builder opens to find out what exists. under the glob, adding a preview is one file and removing
 * one is a delete.
 *
 * the page wears two classes and writes no css: this package defines none of its own (./app.css
 * says so), so both come out of packages/operator/src/styles/adm.css and are what every operator
 * screen already stands in. `.adm-main` is the page's gutter, and it is load-bearing rather than
 * decoration — with no gutter a full-width specimen sits flush against the viewport edge, which is
 * a width no screen puts it at and a state the specimen is then wrong about. `.adm-section` on each
 * preview is the rule between one component's specimens and the next's, without which a page of
 * thirty-three runs together and a reader cannot tell whose state they are looking at.
 */

const previews = import.meta.glob<{ default: () => ReactNode }>('./previews/*.tsx', {
	eager: true
});

function App() {
	const entries = Object.entries(previews).sort(([a], [b]) => a.localeCompare(b));
	return (
		<main className="adm-main">
			<h1>component gallery</h1>
			{entries.map(([path, mod]) => {
				const label = path.replace('./previews/', '').replace(/\.tsx$/, '');
				const Preview = mod.default;
				return (
					<section className="adm-section" key={path}>
						<h2>{label}</h2>
						<Preview />
					</section>
				);
			})}
		</main>
	);
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(<App />);
