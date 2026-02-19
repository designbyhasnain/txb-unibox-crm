import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    rollupOptions: {
        input: {
          main: "index.html",
          login: "login.html",
          accounts: "accounts.html",
          campaigns: "campaigns.html",
          campaign: "campaign.html",
          unibox: "unibox.html",
          analytics: "analytics.html",
        },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
