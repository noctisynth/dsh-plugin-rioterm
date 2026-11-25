import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';

/** Build-time only. The host's classic script loader doesn't fetch a CSS sibling. */
export async function compileUiStyles(): Promise<string> {
  const from = resolve('src/styles/terminal.css');
  const input = await readFile(from, 'utf8');
  const result = await postcss([
    tailwind({ optimize: { minify: true } }),
  ]).process(input, { from });
  // Tailwind's prefix covers utility classes, not its internal @property names.
  const sheet = postcss.parse(result.css.replaceAll('--tw-', '--dsh-rio-tw-'));
  const scope = sheet.nodes.find(
    (node) => node.type === 'atrule' && node.name === 'scope',
  );
  if (scope?.type !== 'atrule') throw new Error('Missing Rio UI style scope.');
  // Tailwind can also emit :root/:host theme variables. Bind them to each Rio root instead.
  for (const node of [...sheet.nodes]) {
    if (
      node.type === 'rule' &&
      node.selectors.every((s) => s === ':root' || s === ':host')
    ) {
      node.selector = ':scope';
      scope.prepend(node);
    }
  }
  sheet.walkAtRules('layer', (layer) => {
    // Its legacy fallback initializes variables on `*`. Keep that rule inside our roots too.
    if (layer.parent === sheet && layer.params === 'properties') {
      scope.prepend(...(layer.nodes ?? []));
      layer.remove();
    }
  });
  // The guide button and pane carry utilities themselves. Explicitly include the
  // scope root without adding specificity or wrapping sidebar entries in extra DOM.
  scope.walkRules((rule) => {
    if (rule.selector.startsWith('.rio\\:')) {
      rule.selectors = rule.selectors.flatMap((selector) => [
        selector,
        `:where(:scope)${selector}`,
      ]);
    }
  });
  return sheet.toString();
}
