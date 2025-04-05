//https://nitro.unjs.io/config
export default defineNitroConfig({
  srcDir: "src",
  compatibilityDate: "2025-04-01",
  openAPI: {
    meta: {
      title: "Memory API",
      description: "API for Memory",
    },
  },
  experimental: {
    openAPI: true,
  },
});
