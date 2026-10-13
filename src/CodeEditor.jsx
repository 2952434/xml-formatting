import { useEffect, useMemo, useRef, useState } from 'react'

const TOKEN_PATTERN = /(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+|\/?>|"[^"\n]*"|'[^'\n]*'|\b[\w:.-]+(?=\s*=)|\b(?:true|false|null)\b)/g

function matchingBrackets (value, caret) {
  const pairs = { '<': '>', '(': ')', '[': ']', '{': '}' }
  const protectedRanges = Array.from(value.matchAll(TOKEN_PATTERN))
    .filter((token) => /^['"]/.test(token[0]) || token[0].startsWith('<!--') || token[0].startsWith('<![CDATA['))
    .map((token) => [token.index, token.index + token[0].length])
  const isProtected = (index) => protectedRanges.some(([start, end]) => index >= start && index < end)
  let start = caret
  if (!'<>()[ ]{}'.replace(' ', '').includes(value[start])) start = caret - 1
  const char = value[start]
  const opening = Object.hasOwn(pairs, char)
  const target = opening ? pairs[char] : Object.keys(pairs).find((key) => pairs[key] === char)
  if (!target || isProtected(start)) return []
  let depth = 0
  for (let i = start; i >= 0 && i < value.length; i += opening ? 1 : -1) {
    if (isProtected(i)) continue
    if (value[i] === char) depth++
    if (value[i] === target) depth--
    if (!depth) return [start, i]
  }
  return [start]
}

export default function CodeEditor ({ value, onChange, label = 'XML 输入', errorLine = 0, errorColumn = 0 }) {
  const textareaRef = useRef(null)
  const backdropRef = useRef(null)
  const gutterRef = useRef(null)
  const [caret, setCaret] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [message, setMessage] = useState('')
  const findRef = useRef(null)
  const editsRef = useRef({ values: [value], index: 0 })
  useEffect(() => {
    const edits = editsRef.current
    if (edits.values[edits.index] !== value) editsRef.current = { values: [value], index: 0 }
  }, [value])
  const update = (next) => {
    const edits = editsRef.current
    if (edits.values[edits.index] === next) return
    edits.values = [...edits.values.slice(0, edits.index + 1), next].slice(-100)
    edits.index = edits.values.length - 1
    onChange(next)
  }
  const undo = (redo = false) => {
    const edits = editsRef.current
    const index = edits.index + (redo ? 1 : -1)
    if (index < 0 || index >= edits.values.length) return
    edits.index = index
    onChange(edits.values[index])
  }
  const matches = useMemo(() => {
    if (!find) return []
    const source = caseSensitive ? value : value.toLowerCase()
    const needle = caseSensitive ? find : find.toLowerCase()
    const offsets = []
    let start = 0
    let index
    while ((index = source.indexOf(needle, start)) !== -1) {
      offsets.push(index)
      start = index + find.length
    }
    return offsets
  }, [value, find, caseSensitive])
  const highlighted = useMemo(() => {
    const brackets = matchingBrackets(value, caret)
    const tokens = Array.from(value.matchAll(TOKEN_PATTERN))
    const boundaries = new Set([0, value.length])
    tokens.forEach((token) => { boundaries.add(token.index); boundaries.add(token.index + token[0].length) })
    matches.forEach((index) => { boundaries.add(index); boundaries.add(index + find.length) })
    brackets.forEach((index) => { boundaries.add(index); boundaries.add(index + 1) })
    const positions = Array.from(boundaries).sort((a, b) => a - b)
    let tokenIndex = 0
    let matchIndex = 0
    return positions.slice(0, -1).map((start, index) => {
      while (tokens[tokenIndex] && tokens[tokenIndex].index + tokens[tokenIndex][0].length <= start) tokenIndex++
      while (matches[matchIndex] !== undefined && matches[matchIndex] + find.length <= start) matchIndex++
      const token = tokens[tokenIndex]
      const text = token && token.index <= start ? token[0] : ''
      const className = [
        text.startsWith('<!--') ? 'code-comment' : text.startsWith('<') || text === '>' || text === '/>' ? 'xml-tag' : /^['"]/.test(text) ? 'xml-value' : text ? 'xml-attr' : '',
        matches[matchIndex] !== undefined && matches[matchIndex] <= start ? 'code-match' : '',
        brackets.includes(start) ? 'code-bracket' : ''
      ].join(' ')
      return <span key={start} className={className}>{value.slice(start, positions[index + 1])}</span>
    })
  }, [value, caret, matches, find])
  const syncScroll = () => {
    backdropRef.current.scrollTop = textareaRef.current.scrollTop
    backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    gutterRef.current.scrollTop = textareaRef.current.scrollTop
  }
  const select = (start, end) => {
    const area = textareaRef.current
    area.focus()
    area.setSelectionRange(start, end)
    setCaret(start)
    const line = value.slice(0, start).split('\n').length - 1
    area.scrollTop = Math.max(0, line * 21 - area.clientHeight / 2)
    syncScroll()
  }
  const findNext = (backward = false) => {
    if (!matches.length) { setMessage('没有匹配项'); return }
    const area = textareaRef.current
    const next = backward
      ? matches.filter((index) => index < area.selectionStart).at(-1) ?? matches.at(-1)
      : matches.find((index) => index >= area.selectionEnd) ?? matches[0]
    select(next, next + find.length)
    setMessage(`第 ${matches.indexOf(next) + 1}/${matches.length} 项`)
  }
  const replace = (all) => {
    if (!matches.length) return
    if (all) {
      let start = 0
      let output = ''
      matches.forEach((index) => { output += value.slice(start, index) + replacement; start = index + find.length })
      update(output + value.slice(start))
      setMessage(`已替换 ${matches.length} 项`)
    } else {
      const area = textareaRef.current
      const start = area.selectionStart
      if (matches.includes(start) && area.selectionEnd === start + find.length) {
        update(value.slice(0, start) + replacement + value.slice(area.selectionEnd))
        setMessage('已替换当前项')
      } else findNext()
    }
  }
  const jumpToError = () => {
    const lines = value.split('\n')
    const index = lines.slice(0, errorLine - 1).reduce((sum, line) => sum + line.length + 1, 0) + Math.min(Math.max(0, errorColumn - 1), (lines[errorLine - 1] || '').length)
    select(index, Math.min(index + 1, value.length))
  }
  const keyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      setFindOpen(true)
      window.setTimeout(() => findRef.current?.focus(), 0)
    } else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      undo(event.shiftKey || event.key.toLowerCase() === 'y')
    } else if (event.key === 'Escape') setFindOpen(false)
    else if (event.key === 'Tab') {
      event.preventDefault()
      const area = event.currentTarget
      const start = area.selectionStart
      update(value.slice(0, start) + '  ' + value.slice(area.selectionEnd))
      window.setTimeout(() => select(start + 2, start + 2), 0)
    }
  }
  const line = value.slice(0, caret).split('\n')
  return (
    <div className='code-editor' onKeyDown={(event) => { if (event.key === 'Escape') setFindOpen(false) }}>
      <div className='editor-tools'>
        <button className='ghost-button' onClick={() => setFindOpen(!findOpen)}>查找 / 替换</button>
        <button className='ghost-button' onClick={() => undo()}>撤销</button>
        <button className='ghost-button' onClick={() => undo(true)}>重做</button>
        {errorLine > 0 && <button className='ghost-button error-jump' onClick={jumpToError}>定位错误 {errorLine}:{errorColumn}</button>}
        <span>第 {line.length} 行，第 {line.at(-1).length + 1} 列 · Tab 缩进</span>
      </div>
      {findOpen && (
        <div className='editor-find'>
          <input ref={findRef} aria-label='查找内容' placeholder='查找内容' value={find} onChange={(event) => { setFind(event.target.value); setMessage('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey) } }} />
          <input aria-label='替换内容' placeholder='替换为' value={replacement} onChange={(event) => setReplacement(event.target.value)} />
          <label><input type='checkbox' checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />区分大小写</label>
          <button className='ghost-button' onClick={() => findNext(true)}>上一个</button>
          <button className='ghost-button' onClick={() => findNext()}>下一个</button>
          <button className='ghost-button' onClick={() => replace(false)}>替换</button>
          <button className='ghost-button' onClick={() => replace(true)}>全部替换</button>
          <span role='status'>{message || `${matches.length} 项`}</span>
        </div>
      )}
      <div className='code-surface'>
        <div className='code-gutter' ref={gutterRef} aria-hidden='true'>{value.split('\n').map((_, index) => <div key={index} className={errorLine === index + 1 ? 'error-line' : ''}>{index + 1}</div>)}</div>
        <div className='code-content'>
          <pre ref={backdropRef} className='code-backdrop' aria-hidden='true'>{highlighted}{'\n'}</pre>
          <textarea ref={textareaRef} className='code-input' aria-label={label} spellCheck='false' wrap='off' value={value} onChange={(event) => { update(event.target.value); setCaret(event.target.selectionStart) }} onSelect={(event) => setCaret(event.target.selectionStart)} onScroll={syncScroll} onKeyDown={keyDown} placeholder='粘贴 XML / JSON，或拖入文件' />
        </div>
      </div>
    </div>
  )
}
