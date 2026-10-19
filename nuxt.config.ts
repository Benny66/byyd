// https://nuxt.com/docs/api/configuration/nuxt-config
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { TOTAL_MINUTES } from './app/data/training'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-19',

  // 预渲染整站：`nuxt generate` 会输出纯静态文件
  ssr: true,

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: `备孕每日训练 · ${TOTAL_MINUTES} 分钟`,
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover'
        },
        { name: 'theme-color', content: '#0b0d12' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'format-detection', content: 'telephone=no' },
        {
          name: 'description',
          content:
            '备孕每日训练：12 个动作循环 2 轮，每 4 个动作休息 1 分钟，每个动作前 5 秒准备倒计时，配提示音与语音引导。'
        }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  },

  nitro: {
    // 静态站点：构建时预渲染为纯 HTML + 资源，不需要 Node 运行时
    preset: 'static',
    // 本地开发时把 /api 代理到 Go 服务（生产环境由同一个二进制同源提供）
    devProxy: {
      '/api': {
        target: 'http://127.0.0.1:8787/api',
        changeOrigin: true
      }
    },
    prerender: {
      routes: ['/'],
      crawlLinks: true,
      failOnError: true
    }
  },

  typescript: {
    strict: true,
    typeCheck: false
  },

  hooks: {
    /**
     * Nitro 拷贝客户端静态资源时用 fs.cp 逐个文件写入，不会创建父目录。
     * 在部分受限文件系统（容器 / 沙箱）里这会直接 ENOENT，这里在 Nitro 构建前把目录建好。
     * 这些目录本来也由 Nitro 创建，提前创建对正常构建没有副作用。
     */
    'nitro:init'(nitro) {
      const publicDir = nitro.options.output.publicDir
      const hooks = nitro.hooks as unknown as {
        hook: (name: string, handler: () => void) => void
      }
      hooks.hook('build:before', () => {
        mkdirSync(join(publicDir, '_nuxt', 'builds', 'meta'), { recursive: true })
      })
    }
  }
})
