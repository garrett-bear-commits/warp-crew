// ADR-013: a feature may import another feature's `contract` entry point (types, schemas,
// event kinds) but never its `server` or `client` implementation.
//
// Plain JS (no build step) so eslint.config.js can import it directly.

const FEATURE_DIR_RE = /[\\/]packages[\\/]server[\\/]src[\\/]features[\\/]([^\\/]+)[\\/]/;

/** @param {string} filename */
function featureOf(filename) {
  const m = FEATURE_DIR_RE.exec(filename);
  return m ? m[1] : null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const featureBoundaryRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'features import only other features’ contract entry points, never their server/client implementation',
    },
    schema: [],
    messages: {
      crossFeature:
        'Feature "{{from}}" imports "{{to}}" implementation ({{spec}}). Only "../{{to}}/contract" is allowed (ADR-013).',
    },
  },
  create(context) {
    const filename = context.filename;
    const from = featureOf(filename);
    if (!from) return {};
    return {
      ImportDeclaration(node) {
        const spec = String(node.source.value);
        // relative import into a sibling feature dir: ../<feature>/<entry>
        const rel = /^\.\.\/([^/]+)\/(.+)$/.exec(spec);
        // absolute import through the package exports: @foundation/server/features/<f>/<entry>
        const abs = /^@foundation\/server\/features\/([^/]+)\/(.+)$/.exec(spec);
        const m = rel ?? abs;
        if (!m) return;
        const [, to, entry] = m;
        if (to === from) return;
        const base = entry.replace(/\.(ts|js)$/, '');
        if (base === 'contract' || base === 'contract/index') return;
        context.report({ node, messageId: 'crossFeature', data: { from, to, spec } });
      },
    };
  },
};
