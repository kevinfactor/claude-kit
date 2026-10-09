// A line diff that emits real unified hunks (`@@ -a,b +c,d @@`), so `Code format="diff"` parses it.

type Op = { t: ' ' | '-' | '+'; s: string }

const MAX_CELLS = 4_000_000

function ops(a: readonly string[], b: readonly string[]): Op[] {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++

  const head: Op[] = a.slice(0, pre).map(s => ({ t: ' ', s }))
  const tail: Op[] = a.slice(a.length - suf).map(s => ({ t: ' ', s }))
  const x = a.slice(pre, a.length - suf)
  const y = b.slice(pre, b.length - suf)

  let mid: Op[]
  if (x.length * y.length > MAX_CELLS) {
    // Too big to align line by line: show it as one replacement.
    mid = [...x.map(s => ({ t: '-' as const, s })), ...y.map(s => ({ t: '+' as const, s }))]
  } else {
    const n = x.length
    const m = y.length
    const w = m + 1
    const lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = x[i] === y[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0)
      }
    }
    mid = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        mid.push({ t: ' ', s: x[i] ?? '' })
        i++
        j++
      } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0)) {
        mid.push({ t: '-', s: x[i] ?? '' })
        i++
      } else {
        mid.push({ t: '+', s: y[j] ?? '' })
        j++
      }
    }
    while (i < n) mid.push({ t: '-', s: x[i++] ?? '' })
    while (j < m) mid.push({ t: '+', s: y[j++] ?? '' })
  }
  return [...head, ...mid, ...tail]
}

export type Diff = { text: string; added: number; removed: number }

export function unified(before: string, after: string, context = 3): Diff {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n')
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n')
  const all = ops(a, b)
  let added = 0
  let removed = 0
  for (const o of all) {
    if (o.t === '+') added++
    if (o.t === '-') removed++
  }
  if (added === 0 && removed === 0) return { text: '', added, removed }

  // Old/new line numbers at each op.
  const at: { o: number; n: number }[] = []
  let on = 1
  let nn = 1
  for (const o of all) {
    at.push({ o: on, n: nn })
    if (o.t !== '+') on++
    if (o.t !== '-') nn++
  }

  const hunks: string[] = []
  let k = 0
  while (k < all.length) {
    if (all[k]?.t === ' ') {
      k++
      continue
    }
    const start = Math.max(0, k - context)
    let end = k
    // Extend while the next change is within 2*context unchanged lines.
    while (end < all.length) {
      if (all[end]?.t !== ' ') {
        end++
        continue
      }
      let run = 0
      while (end + run < all.length && all[end + run]?.t === ' ') run++
      if (end + run >= all.length || run > context * 2) {
        end = Math.min(all.length, end + Math.min(run, context))
        break
      }
      end += run
    }
    const slice = all.slice(start, end)
    const first = at[start] ?? { o: 1, n: 1 }
    const oldLen = slice.filter(o => o.t !== '+').length
    const newLen = slice.filter(o => o.t !== '-').length
    const oStart = oldLen === 0 ? first.o - 1 : first.o
    const nStart = newLen === 0 ? first.n - 1 : first.n
    hunks.push(`@@ -${oStart},${oldLen} +${nStart},${newLen} @@`)
    for (const o of slice) hunks.push(`${o.t}${o.s}`)
    k = end
  }
  return { text: hunks.join('\n'), added, removed }
}

type Row = { t: ' ' | '-' | '+'; s: string; o: number; n: number; hunk: number }

/** The diff's body rows (headers dropped), each with its old/new line number. */
export function rowsOf(diff: string): Row[] {
  const out: Row[] = []
  let o = 0
  let n = 0
  let hunk = -1
  for (const line of diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h) {
      hunk++
      o = Number(h[1])
      n = Number(h[2])
      // A zero-length side starts one before its first line.
      if (o === 0) o = 1
      if (n === 0) n = 1
      continue
    }
    const t = line[0] === '-' || line[0] === '+' ? line[0] : ' '
    out.push({ t, s: line.slice(1), o, n, hunk })
    if (t !== '+') o++
    if (t !== '-') n++
  }
  return out
}

/** Rows [top, top+room) re-headed so each piece is a parseable hunk. */
export function windowed(diff: string, top: number, room: number): string {
  const rows = rowsOf(diff).slice(top, top + room)
  const out: string[] = []
  let i = 0
  while (i < rows.length) {
    const first = rows[i]
    if (first === undefined) break
    let j = i
    while (j < rows.length && rows[j]?.hunk === first.hunk) j++
    const group = rows.slice(i, j)
    const oldLen = group.filter(r => r.t !== '+').length
    const newLen = group.filter(r => r.t !== '-').length
    out.push(`@@ -${oldLen === 0 ? first.o - 1 : first.o},${oldLen} +${newLen === 0 ? first.n - 1 : first.n},${newLen} @@`)
    for (const r of group) out.push(`${r.t}${r.s}`)
    i = j
  }
  return out.join('\n')
}

/** Row index where each hunk starts. */
export function hunkStarts(diff: string): number[] {
  const starts: number[] = []
  rowsOf(diff).forEach((r, k, all) => {
    if (k === 0 || all[k - 1]?.hunk !== r.hunk) starts.push(k)
  })
  return starts
}
