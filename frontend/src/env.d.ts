/// <reference types="vite/client" />

declare module 'virtual:blog' {
  const articles: import('./blog/types').Article[]
  export default articles
}
