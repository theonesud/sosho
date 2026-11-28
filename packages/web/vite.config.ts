import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const ENGINE_URL = "http://127.0.0.1:8123";
const API_PATHS = /^\/(nodes|workflows|validate|runs|schedules|health)(?:[/?]|$)/;

function engineProxy(): Record<string, ProxyOptions> {
  const token = process.env.SOSHO_ENGINE_API_TOKEN;
  if (!token) {
    console.warn("SOSHO_ENGINE_API_TOKEN is not set. Engine requests will return 401.");
  }
  const options: ProxyOptions = {
    target: ENGINE_URL,
    changeOrigin: true,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    configure: (proxy) => {
      proxy.on("proxyRes", (response) => {
        if (String(response.headers["content-type"]).startsWith("text/event-stream")) {
          response.headers["cache-control"] = "no-cache, no-transform";
          response.headers["x-accel-buffering"] = "no";
        }
      });
    },
  };
  return { [API_PATHS.source]: options };
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: engineProxy() },
});
