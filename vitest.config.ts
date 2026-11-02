import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import "./scripts/build-config.mjs"; // gen/config.json 생성 (src 가 import 한다)

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { NTFY_TOPIC: "test-topic" } },
    }),
  ],
});
