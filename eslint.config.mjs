import js from "@eslint/js";
import globals from "globals";

// A plain Node ESM package, no framework: the base rules plus the clean-code limits. They
// are the machine-checked half of AGENT.md, and every one is an error, never a warning.
// There is no list of exempt files: a file that breaks a limit is split, not listed.
export default [
  { ignores: ["node_modules/", "dist/", ".claude/"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      // 2025 for import attributes: package.json comes in as a module `with { type: "json" }`
      // (src/cli.js), so the bundled file carries its version.
      ecmaVersion: 2025,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
      "max-nested-callbacks": ["error", 3],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-param-reassign": "error",
      // A CLI writes to stdout: that is its output, not debugging noise.
      "no-console": "off",
    },
  },
  {
    files: ["**/tests/**"],
    rules: { "max-lines": "off", "max-nested-callbacks": "off", "max-params": "off" },
  },
];
