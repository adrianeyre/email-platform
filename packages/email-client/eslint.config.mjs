import { defineConfig } from "eslint/config";
import rootConfig from "../../eslint.config.mjs";

/** The repository's rules, with this package's own build output ignored and its own tsconfig used for types. */
export default defineConfig({ ignores: ["dist"] }, rootConfig, {
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ["*.mjs", "*.ts"],
        defaultProject: "tsconfig.json",
      },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
