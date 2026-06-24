import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/host-cli.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
})
