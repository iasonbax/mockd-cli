import { configDefaults, defineConfig } from "vitest/config";

// The include is wide on purpose: every spec under src/ runs, so a spec in the wrong place is
// named by src/tests/structure.spec.js instead of being skipped quietly. Worktrees of coding
// agents under .claude/ hold copies of the whole tree and must not be counted.
export default defineConfig({
  test: {
    include: ["src/**/*.spec.js"],
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
