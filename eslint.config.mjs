// ESLint flat config (ARC-013 / QA-018).
//
// This project previously had no linter (`make lint` was a `tsc --noEmit`
// alias). This establishes ESLint using the Next.js + TypeScript ruleset.
// `make lint` runs this; `make checkall` (test + build) is unaffected, so the
// gate cannot break on lint findings.
//
// The React Compiler rule `react-hooks/set-state-in-effect` is softened to
// `warn` for the initial rollout: it fires on legacy setState-in-effect
// patterns in the two large client components (`app/page.tsx`,
// `app/radio/RadioStationClient.tsx`) that the deferred QA-009 component split
// will address. Everything else stays at the next/core-web-vitals severity.

import nextConfig from "eslint-config-next";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".next/",
      "node_modules/",
      "vendor/",
      "output/",
      ".worktrees/",
      ".claude/worktrees/",
      "coverage/",
      "apps/pardora-ios/",
    ],
  },
  ...nextConfig,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
