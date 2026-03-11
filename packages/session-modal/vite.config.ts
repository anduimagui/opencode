import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3011,
  },
  build: {
    target: "esnext",
  },
})
