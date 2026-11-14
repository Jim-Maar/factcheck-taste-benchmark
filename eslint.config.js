import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/* The layers copied from commonnotes.net keep their rules. From the bottom up:
 *   @cn/core      data access, types and scoring. No React components.
 *   @cn/ui        the design system. Knows nothing about notes.
 *   @cn/features  the pieces the website shows, built from the two below.
 * The website in src/web sits on top. */

/** Reaching another layer by a relative path hides the dependency, so the
 *  layers are only ever imported through their alias. */
const RELATIVE_LAYER_IMPORTS = [
  { regex: "^\\.\\.?/(.*/)?core/", message: "Import the core layer as @cn/core/..." },
  { regex: "^\\.\\.?/(.*/)?ui/", message: "Import the design system as @cn/ui/..." },
  { regex: "^\\.\\.?/(.*/)?features/", message: "Import shared features as @cn/features/..." },
];
/** Only the core layer talks to the database. */
const DATABASE_CLIENT = {
  group: ["@cn/core/supabase", "@supabase/supabase-js"],
  allowTypeImports: true,
  message: "Only @cn/core talks to Supabase. Call a function from @cn/core instead.",
};
const WEBSITE = { regex: "^\\.\\.?/(.*/)?web/", message: "Shared code must not import from the website." };

function layer(files, patterns) {
  return { files, rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...RELATIVE_LAYER_IMPORTS, ...patterns] }] } };
}

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Every autoFocus here moves focus into something the reader just
      // opened, such as a menu or the password box.
      "jsx-a11y/no-autofocus": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  layer(["src/core/**/*.{ts,tsx}"], [
    { group: ["@cn/ui/*", "@cn/features/*"], message: "The core layer sits below the design system and the features." },
    { group: ["react", "react-dom", "react-dom/*"], message: "The core layer holds no React code." },
    WEBSITE,
  ]),
  layer(["src/ui/**/*.{ts,tsx}"], [{ group: ["@cn/core/*", "@cn/features/*"], message: "The design system knows nothing about notes." }, DATABASE_CLIENT, WEBSITE]),
  layer(["src/features/**/*.{ts,tsx}"], [DATABASE_CLIENT, WEBSITE]),
  layer(["src/web/**/*.{ts,tsx}"], [DATABASE_CLIENT]),
);
