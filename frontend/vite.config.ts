import { createConnection } from 'node:net'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const apiGatewayTarget = process.env.VITE_API_GATEWAY_TARGET ?? 'https://127.0.0.1'

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (available: boolean) => {
      socket.destroy()
      resolve(available)
    }

    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export default defineConfig(async () => {
  const [marketDataAvailable, backtestAvailable] = await Promise.all([
    isPortAvailable(8081),
    isPortAvailable(8082),
  ])

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api/market': {
          target: marketDataAvailable ? 'http://127.0.0.1:8081' : apiGatewayTarget,
          secure: false,
        },
        '/api/backtests': {
          target: backtestAvailable ? 'http://127.0.0.1:8082' : apiGatewayTarget,
          secure: false,
        },
        '/api/configs': {
          target: backtestAvailable ? 'http://127.0.0.1:8082' : apiGatewayTarget,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
    },
  }
})
