import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import matter from 'gray-matter'
import { marked } from 'marked'
import type { Plugin } from 'vite'

const moduleId = 'virtual:blog'
const resolvedId = '\0' + moduleId

export function readArticles(directory: string) {
  const slugs = new Set<string>()
  return readdirSync(directory).filter(name => name.endsWith('.md') && name !== 'README.md' && !name.startsWith('_')).flatMap(name => {
    const { data, content } = matter(readFileSync(resolve(directory, name), 'utf8'))
    if (data.draft !== undefined && typeof data.draft !== 'boolean') throw new Error(`${name}: draft must be true or false`)
    if (data.draft === true) return []
    for (const field of ['title', 'slug', 'description']) {
      if (typeof data[field] !== 'string' || !data[field].trim()) throw new Error(`${name}: missing ${field}`)
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) throw new Error(`${name}: invalid slug`)
    if (slugs.has(data.slug)) throw new Error(`${name}: duplicate slug ${data.slug}`)
    slugs.add(data.slug)
    const date = data.publishedAt instanceof Date ? data.publishedAt.toISOString().slice(0, 10) : data.publishedAt
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`${name}: publishedAt must be a valid YYYY-MM-DD date`)
    if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.every((tag: unknown) => typeof tag === 'string'))) throw new Error(`${name}: tags must be a list of strings`)
    if (data.cover !== undefined && (typeof data.cover !== 'string' || !/^\/images\/blog\/[a-zA-Z0-9/_\-.]+$/.test(data.cover) || data.cover.includes('..'))) throw new Error(`${name}: cover must be under /images/blog/`)
    if (!content.trim()) throw new Error(`${name}: article body is empty`)
    return [{ title: data.title as string, slug: data.slug as string, description: data.description as string, publishedAt: date, tags: (data.tags ?? []) as string[], cover: (data.cover ?? '') as string, html: marked.parse(content, { async: false }) }]
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug))
}

export function blogPlugin(): Plugin {
  let directory: string
  return {
    name: 'grailab-blog',
    configResolved(config) { directory = resolve(config.root, 'content/blog') },
    resolveId(id) { if (id === moduleId) return resolvedId },
    load(id) {
      if (id !== resolvedId) return
      for (const name of readdirSync(directory)) this.addWatchFile(resolve(directory, name).replace(/\\/g, '/'))
      return `export default ${JSON.stringify(readArticles(directory))}`
    },
    configureServer(server) {
      server.watcher.add(directory)
      server.watcher.on('all', (_event, path) => {
        if (!path.replace(/\\/g, '/').startsWith(directory.replace(/\\/g, '/') + '/')) return
        const module = server.moduleGraph.getModuleById(resolvedId)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
