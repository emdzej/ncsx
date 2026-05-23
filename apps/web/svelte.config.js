import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Force runes mode globally — same rationale as inpax-web's svelte.config.js.
    runes: true,
  },
};
