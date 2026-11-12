/**
 * Turns the checkable parts of a Krillion question ("second letter is L",
 * "starts with B", "five-letter name", "one word") into code, so answers are
 * verified exactly instead of trusting a language model with spelling.
 *
 * Dependency-free on purpose: scripts/build-lexicon.mjs imports this file too.
 */

export type Rule = { label: string; test: (answer: string) => boolean }

export type Parsed = {
  /** The question with every checkable rule removed ("Name a country"). */
  base: string
  /** Category noun phrase used to find related sheets ("country", "type of cheese"). */
  head: string | null
  rules: Rule[]
  /** True when nothing but the category is left, so rules + category fully describe the question. */
  pure: boolean
}

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10,
}
const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
}
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
/** Words a loose "with the letters X" pattern might grab that are not letter chunks. */
const NOT_A_CHUNK = /^(?:a|an|the|it|its|no|one|two|four|five|nine|in|on|of|to|is|as|at|or|and|by|for|than|from|into)$/i

/** Lowercase, accents folded, punctuation dropped, spaces kept. */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Just the letters the game counts: a leading "the" is ignored, as Krillion does. */
export function letters(answer: string): string {
  return fold(answer).replace(/^the /, '').replace(/[^a-z]/g, '')
}

function num(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token)
  return NUMBERS[token] ?? null
}

const Q = `["“”']?` // optional quote around a letter or chunk
const LETTER_WORD = `(?:the |an? )?(?:letters? )?`

type Matcher = { re: RegExp; build: (m: RegExpMatchArray) => Rule | Rule[] | null; replace?: string; subjectOnly?: boolean }

function nthRule(pos: number | 'last', letter: string): Rule {
  const l = letter.toLowerCase()
  const name = pos === 'last' ? 'last' : `${pos}${['th', 'st', 'nd', 'rd'][pos % 10 > 3 || [11, 12, 13].includes(pos % 100) ? 0 : pos % 10]}`
  return {
    label: `${name} letter is ${l.toUpperCase()}`,
    test: (answer) => {
      const s = letters(answer)
      return pos === 'last' ? s.endsWith(l) : s[pos - 1] === l
    },
  }
}

/** "B", "Ch", "boo", "A or C", "Los, Las, La or The", "two consonants", "a vowel". */
function optionList(raw: string): string[] {
  return raw
    .replace(/\(.*$/, '')
    .split(/\s*(?:,|\bor\b|\/)\s*/)
    .map((part) => part.replace(/["“”']/g, '').replace(/^(?:the )?(?:letters?|word) /, '').trim())
    .filter(Boolean)
}

function startsRule(raw: string): Rule | null {
  const text = raw.trim()
  if (/^two consonants/.test(text)) {
    return {
      label: 'starts with two consonants',
      test: (a) => {
        const s = letters(a)
        return s.length >= 2 && !VOWELS.has(s[0]) && !VOWELS.has(s[1])
      },
    }
  }
  if (/^an? vowel/.test(text)) return { label: 'starts with a vowel', test: (a) => VOWELS.has(letters(a)[0]) }
  if (/^an? consonant/.test(text)) return { label: 'starts with a consonant', test: (a) => !VOWELS.has(letters(a)[0] ?? 'a') }
  const wordMode = /^(?:the )?word /.test(text)
  const options = optionList(text).map((o) => o.toLowerCase())
  if (!options.length || options.some((o) => !/^[a-z ]{1,12}$/.test(o))) return null
  return {
    label: `starts with ${options.map((o) => o.toUpperCase()).join(' or ')}`,
    test: (answer) => {
      if (wordMode) {
        const first = fold(answer).split(' ')[0]
        return options.includes(first)
      }
      const s = letters(answer)
      return options.some((o) => s.startsWith(o.replace(/ /g, '')))
    },
  }
}

function endsRule(raw: string): Rule | null {
  if (/^an? vowel/.test(raw)) return { label: 'ends with a vowel', test: (a) => VOWELS.has(letters(a).slice(-1)) }
  const options = optionList(raw).map((o) => o.toLowerCase())
  if (!options.length || options.some((o) => !/^[a-z]{1,8}$/.test(o))) return null
  return {
    label: `ends with ${options.map((o) => o.toUpperCase()).join(' or ')}`,
    test: (a) => options.some((o) => letters(a).endsWith(o)),
  }
}

function containsRule(chunk: string): Rule {
  const c = chunk.toLowerCase()
  return { label: `contains ${c.toUpperCase()}`, test: (a) => letters(a).includes(c) }
}

function withoutRule(chunk: string): Rule {
  const c = chunk.toLowerCase()
  return { label: `no ${c.toUpperCase()}`, test: (a) => !letters(a).includes(c) }
}

function lengthRule(min: number, max: number): Rule {
  const label =
    min === max ? `${min} letters` : max >= 99 ? `${min}+ letters` : min <= 1 ? `${max} or fewer letters` : `${min}-${max} letters`
  return {
    label,
    test: (a) => {
      const n = letters(a).length
      return n >= min && n <= max
    },
  }
}

const N = `(\\d+|${Object.keys(NUMBERS).join('|')})`
const ORD = `(${Object.keys(ORDINALS).join('|')}|last)`

const MATCHERS: Matcher[] = [
  // "with an L in the second letter", "with L as the second letter", "L as its 2nd letter"
  {
    re: new RegExp(`(?:with |that has |having |has )?${LETTER_WORD}${Q}([a-z])${Q} (?:as|in|is|at|for) (?:the |its |their )?${ORD} letter(?: of (?:its|their|the) name)?`, 'i'),
    build: (m) => nthRule(m[2].toLowerCase() === 'last' ? 'last' : ORDINALS[m[2].toLowerCase()], m[1]),
  },
  // "whose second letter is O", "second letter: L", "where the third letter is A"
  {
    re: new RegExp(`(?:whose |where |with |that has |with a )?(?:the |its |their )?(?:name'?s? )?${ORD} letter (?:is |of (?:its|their|the) name is |being |=|:)?\\s*${LETTER_WORD}${Q}([a-z])${Q}(?![a-z])`, 'i'),
    build: (m) => nthRule(m[1].toLowerCase() === 'last' ? 'last' : ORDINALS[m[1].toLowerCase()], m[2]),
    subjectOnly: true,
  },
  // "that starts and ends with the same letter"
  {
    re: /(?:that |which |whose name )?(?:starts|begins) and ends with the same letter/i,
    build: () => ({ label: 'same first and last letter', test: (a) => { const s = letters(a); return s.length > 1 && s[0] === s[s.length - 1] } }),
  },
  // "whose name starts with A", "starting with the letters Ch", "that begins with “boo”"
  {
    re: /(?:that |which |who |whose (?:name |names )?|with a name that )?(?:starts?|starting|begins?|beginning) with (two consonants|an? vowel|an? consonant|(?:the (?:letters?|word) )?(?:["“]?[a-z]{1,12}["”]?)(?:(?:,|\s+or|\/)\s*["“]?[a-z]{1,12}["”]?)*)/i,
    build: (m) => startsRule(m[1]),
    subjectOnly: true,
  },
  // "whose name ends in the letter E", "ending with -ia"
  {
    re: /(?:that |which |whose (?:name |names )?)?(?:ends?|ending) (?:with|in) ((?:the (?:letters?) )?["“-]?[a-z]{1,8}["”]?(?:(?:,|\s+or|\/)\s*["“]?[a-z]{1,8}["”]?)*|an? vowel)/i,
    build: (m) => endsRule(m[1].replace(/^-/, '')),
    subjectOnly: true,
  },
  // "without the letter A in its name", "with no letter E", "that doesn't contain an S"
  {
    re: /(?:without|with no|that has no|having no|(?:that )?(?:doesn'?t|does not) (?:contain|have)) (?:the |an? )?(?:letter |letters )?["“]?([a-z]{1,4})["”]?(?![a-z])(?: in (?:its|their|the|it)(?:'?s)? ?(?:name)?)?/i,
    build: (m) => withoutRule(m[1]),
  },
  // "with 8 or more letters", "3+ letter", "at least 6 letters"
  {
    re: new RegExp(`(?:with |that has |of )?(?:at least |a minimum of )?${N}(?: or more|\\+) letters?(?: long)?|at least ${N} letters?(?: long)?`, 'i'),
    build: (m) => lengthRule(num(m[1] ?? m[2]) ?? 1, 99),
  },
  // "with 5 or fewer letters", "fewer than 6 letters"
  {
    re: new RegExp(`(?:with )?(?:${N} or (?:fewer|less) letters?|(?:fewer|less) than ${N} letters?)(?: long)?`, 'i'),
    build: (m) => (m[1] ? lengthRule(1, num(m[1]) ?? 99) : lengthRule(1, (num(m[2]) ?? 100) - 1)),
  },
  // "with a five-letter English name", "exactly four letters long", "(5 letters)"
  {
    re: new RegExp(`(?:with a |whose name is |that is |is )?(?:exactly )?${N}[- ]letters?(?: long)?(?: (?:english |)name)?`, 'i'),
    build: (m) => { const n = num(m[1]); return n ? lengthRule(n, n) : null },
  },
  // "with the letter H in its name", "with a Z in it", "containing “ck”", "that contains the letters ou"
  {
    re: /(?:with (?:the letters? |an? |the )|(?:that |which )?(?:contains?|containing|has|having) (?:the (?:letters? )?|an? |the letters? )?)["“]?([a-z]{1,4})["”]?(?![a-z]) ?(?:in (?:its|their|the|it)(?:'?s)? ?(?:name|spelling|it)?|anywhere)?/i,
    build: (m) => (NOT_A_CHUNK.test(m[1]) && !/["“]/.test(m[0]) ? null : containsRule(m[1])),
  },
  { re: /(?:with a )?one[- ]word(?: name)?|\(one word only\)|one word only/i, build: () => ({ label: 'one word', test: (a) => fold(a).split(' ').length === 1 }) },
  {
    re: /(?:with |that has |containing )?(?:a )?double(?:d)? letters?|the same letter twice in a row/i,
    build: () => ({ label: 'double letter', test: (a) => /(.)\1/.test(letters(a)) }),
  },
  {
    re: /(?:whose name )?uses only one vowel(?: letter)?(?: \([^)]*\))?(?:, repeats allowed)?|with only one (?:kind of )?vowel/i,
    build: () => ({ label: 'one vowel letter only', test: (a) => new Set(letters(a).split('').filter((c) => VOWELS.has(c))).size === 1 }),
  },
  { re: /(?:that'?s? |which is |that is )a palindrome|palindromic/i, build: () => ({ label: 'palindrome', test: (a) => { const s = letters(a); return s.length > 1 && s === [...s].reverse().join('') } }) },
  { re: /palindrome/i, replace: 'word', build: () => ({ label: 'palindrome', test: (a) => { const s = letters(a); return s.length > 1 && s === [...s].reverse().join('') } }) },
]

const OF_HEADS = new Set(['type', 'kind', 'sort', 'piece', 'shade', 'part', 'member', 'species', 'unit', 'brand', 'breed', 'variety', 'form', 'style', 'flavor', 'flavour', 'genre', 'pair', 'body'])
const HEAD_STOP = new Set(
  'with that which who whose where when starting beginning ending containing in from by on for you people without than made used known played found often usually commonly not isnt and to at as like whos thats'.split(' '),
)
const GENERIC_HEADS = new Set(['thing', 'something', 'someone', 'one', 'item', 'way', 'word for', 'another'])

function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y'
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2)
  if (/[^s]s$/.test(word)) return word.slice(0, -1)
  return word
}

/** "Name a national capital city that…" → "national capital city"; "Name a type of cheese" → "type of cheese". */
export function categoryOf(base: string): string | null {
  const text = base
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[’']s\b/g, ' __poss ')
    .replace(/[^a-z\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:name|list|give|what is|whats)\s+/, '')
    .replace(/^(?:a|an|any|the|one|some|another|real)\s+/, '')
  const tokens = text.split(' ').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '__poss') return null // "a country's capital" is not a country
    if (HEAD_STOP.has(token)) break
    if (token === 'of' && !(out.length === 1 && OF_HEADS.has(out[0]))) break
    if (out.length >= 4) break
    out.push(token)
  }
  if (!out.length) return null
  out[out.length - 1] = singular(out[out.length - 1])
  const head = out.join(' ').replace(/-/g, ' ')
  if (GENERIC_HEADS.has(head) || GENERIC_HEADS.has(out[0])) return null
  return head
}

const FILLER = new Set('name a an the any one some another that which who whose with its their is are in of letter letters english'.split(' '))

export function parseRules(question: string): Parsed {
  let rest = ` ${question.replace(/\s+/g, ' ').trim()} `
  const rules: Rule[] = []
  for (const matcher of MATCHERS) {
    const re = new RegExp(`(?<![a-z])(?:${matcher.re.source})(?![a-z])`, 'gi')
    // Several of the same kind can appear ("starts with A and ends with E").
    for (let guard = 0, from = 0; guard < 6; guard += 1) {
      re.lastIndex = from
      const m = re.exec(rest)
      if (!m) break
      from = m.index + 1
      // "a country whose capital starts with B": the rule is about the capital, not the answer.
      if (matcher.subjectOnly && /\bwhose (?!names?\b)[a-z]+(?: [a-z]+)?\s*$/i.test(rest.slice(0, m.index))) continue
      const built = matcher.build(m)
      if (!built) continue
      rules.push(...(Array.isArray(built) ? built : [built]))
      rest = `${rest.slice(0, m.index)} ${matcher.replace ?? ''} ${rest.slice(m.index + m[0].length)}`
      from = m.index
    }
  }
  const base = rest
    .replace(/\((?:[^)]*\b(?:ignore|letters?|counts?|like|repeats)\b[^)]*)\)/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\b(?:and|but|also)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const head = categoryOf(base)
  const leftover = fold(base)
    .split(' ')
    .filter((w) => w && !FILLER.has(w) && !(head ?? '').split(' ').includes(w) && !(head ?? '').split(' ').includes(singular(w)))
  return { base, head, rules, pure: Boolean(head) && leftover.length === 0 }
}

export function passes(rules: Rule[], answer: string): boolean {
  return rules.every((rule) => rule.test(answer))
}
