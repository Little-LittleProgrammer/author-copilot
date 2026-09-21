import { nodeConfig, reactConfig } from "@author-copilot/config-eslint";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  { ignores: ["coverage/**", "out/**", "release/**"] },
  ...nodeConfig,
  ...reactConfig,
];

export default config;
