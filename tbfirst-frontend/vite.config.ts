import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 生图走 phase1/phase2，上游 Gemini 稳定在 60s+，网关侧放到 180s，
// 若 Vite dev proxy 没显式放开 timeout / proxyTimeout，底层 http-proxy 在长请求或大 body
// 时会把 socket 关掉，表现为「浏览器请求挂掉但 gateway 看不到任何日志」——
// 就是 errorConclude #29 一直定位不到的根因之一（请求被 Vite 悄悄 drop，既没到 gateway 也没 502）。
const PROXY_TIMEOUT_MS = 200_000;

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 5173,
        proxy: {
          '/api': {
            target: 'http://localhost:8000',
            changeOrigin: true,
            timeout: PROXY_TIMEOUT_MS,
            proxyTimeout: PROXY_TIMEOUT_MS,
            // 把代理侧的 socket 错误打印到 Vite 控制台，避免「请求消失」这种无症状失败
            configure: (proxy) => {
              proxy.on('error', (err, req) => {
                // eslint-disable-next-line no-console
                console.error('[vite-proxy][/api] error:', req.method, req.url, '-', err.message);
              });
              proxy.on('proxyReq', (_proxyReq, req) => {
                if (req.method !== 'GET') {
                  // eslint-disable-next-line no-console
                  console.info('[vite-proxy][/api] →', req.method, req.url);
                }
              });
            },
          },
          '/static': {
            target: 'http://localhost:8000',
            changeOrigin: true,
            timeout: PROXY_TIMEOUT_MS,
            proxyTimeout: PROXY_TIMEOUT_MS,
          },
          // V5.XI-3.4：GCS 反代端点。dev 模式下若不代理，Vite SPA fallback 会返回
          // index.html 让浏览器误把 HTML 字节当成 PNG 保存到本地，导致下载图无法预览。
          '/img': {
            target: 'http://localhost:8000',
            changeOrigin: true,
            timeout: PROXY_TIMEOUT_MS,
            proxyTimeout: PROXY_TIMEOUT_MS,
          },
        },
      },
      plugins: [react(), tailwindcss()],
      // three / @react-three/fiber / drei are heavy; pre-bundle them so the first
      // /home visit in dev doesn't trigger a mid-session "new deps optimized" reload.
      optimizeDeps: {
        include: ['three', '@react-three/fiber', '@react-three/drei'],
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        // R3F's custom reconciler must share the app's single React instance, and
        // drei + app must share one `three` copy — dedupe guards against the
        // index.html import-map / transitive-dep footguns (see plan R1).
        dedupe: ['react', 'react-dom', 'three'],
      }
    };
});
