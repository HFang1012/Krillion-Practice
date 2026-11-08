/** Prefix a file from public/ so it works at the site root and on GitHub Pages. */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
