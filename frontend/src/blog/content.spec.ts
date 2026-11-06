// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArticles } from '../../blog-plugin'

const directories: string[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'grailab-blog-')); directories.push(path); return path }
function post(slug = 'first-post', date = '2026-11-06', extra = '', body = '## Reading\n\nReal **Markdown** content.') {
  return `---\ntitle: Article title\nslug: ${slug}\ndescription: A useful summary\npublishedAt: "${date}"\n${extra}\n---\n\n${body}`
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
describe('published article contract', () => {
  it('returns empty content for an empty directory', () => { expect(readArticles(directory())).toEqual([]) })
  it('renders markdown and sorts newest articles first', () => {
    const dir = directory()
    writeFileSync(join(dir, 'old.md'), post('old', '2026-10-01'))
    writeFileSync(join(dir, 'new.md'), post('new'))
    const articles = readArticles(dir)
    expect(articles.map(item => item.slug)).toEqual(['new', 'old'])
    expect(articles[0]).toMatchObject({ title: 'Article title', description: 'A useful summary', publishedAt: '2026-11-06', tags: [], cover: '' })
    expect(articles[0].html).toContain('<strong>Markdown</strong>')
  })
  it('excludes draft bodies and authoring files from public output', () => {
    const dir = directory()
    writeFileSync(join(dir, 'draft.md'), post('private', '2026-11-06', 'draft: true', 'SECRET-DRAFT-CONTENT'))
    writeFileSync(join(dir, '_template.md'), 'not valid article metadata')
    writeFileSync(join(dir, 'README.md'), '# Author instructions')
    expect(JSON.stringify(readArticles(dir))).toBe('[]')
  })
  it.each([
    ['invalid-slug', post('../escape'), 'invalid slug'],
    ['impossible-date', post('first', '2026-02-30'), 'publishedAt must be a valid YYYY-MM-DD date'],
    ['missing-title', post().replace('title: Article title', ''), 'missing title'],
    ['invalid-tags', post('first', '2026-11-06', 'tags: not-a-list'), 'tags must be a list of strings'],
    ['invalid-draft', post('first', '2026-11-06', 'draft: "false"'), 'draft must be true or false'],
    ['invalid-cover', post('first', '2026-11-06', 'cover: https://example.com/image.png'), 'cover must be under /images/blog/'],
    ['empty-body', post('first', '2026-11-06', '', ''), 'article body is empty'],
  ])('rejects %s with a file-specific actionable error', (_name, content, message) => {
    const dir = directory()
    writeFileSync(join(dir, 'bad.md'), content)
    expect(() => readArticles(dir)).toThrow(`bad.md: ${message}`)
  })
  it('rejects duplicate public URLs', () => {
    const dir = directory()
    writeFileSync(join(dir, 'one.md'), post())
    writeFileSync(join(dir, 'two.md'), post())
    expect(() => readArticles(dir)).toThrow('two.md: duplicate slug first-post')
  })
})
