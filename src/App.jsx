import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SAMPLE_XML = `<catalog>
  <book id="bk101" genre="fiction">
    <author>Gambardella, Matthew</author>
    <title>XML Developer's Guide</title>
    <price currency="USD">44.95</price>
  </book>
  <book id="bk102" genre="computer">
    <author>Ralls, Kim</author>
    <title>Midnight Rain</title>
    <price currency="USD">5.95</price>
  </book>
</catalog>`

const NODE_TYPES = {
  element: 1,
  text: 3,
  cdata: 4,
  comment: 8
}

const INDENT = '    '
const PLUGIN_EXPAND_HEIGHT = 760
const HISTORY_STORAGE_KEY = 'xml-format-history'
const MAX_HISTORY_ITEMS = 20

function parseXml (value) {
  const source = value.trim()

  if (!source) {
    return { doc: null, error: '' }
  }

  const doc = new window.DOMParser().parseFromString(source, 'application/xml')
  const parserError = doc.querySelector('parsererror')

  if (parserError) {
    return {
      doc: null,
      error: parserError.textContent.replace(/\s+/g, ' ').trim()
    }
  }

  return { doc, error: '' }
}

function readHistory () {
  try {
    const value = window.localStorage?.getItem(HISTORY_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : []

    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.content === 'string')
      : []
  } catch {
    return []
  }
}

function writeHistory (items) {
  try {
    window.localStorage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items))
  } catch {
  }
}

function getHistorySignature (value) {
  const formatted = formatXml(value)

  return formatted || value.trim()
}

function getHistoryTitle (value) {
  const parsed = parseXml(value)

  if (parsed.doc?.documentElement) {
    return `<${parsed.doc.documentElement.nodeName}>`
  }

  return value.trim().slice(0, 36) || 'XML 片段'
}

function formatHistoryTime (timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function formatXml (value) {
  const source = value.trim()

  if (!source) return ''

  const parsed = parseXml(source)
  if (parsed.error || !parsed.doc?.documentElement) return ''

  const declaration = source.match(/^<\?xml[^?]*\?>/)?.[0]
  const doctype = formatDoctype(parsed.doc.doctype)
  const root = formatXmlNode(parsed.doc.documentElement)

  return [declaration, doctype, root].filter(Boolean).join('\n')
}

function formatDoctype (doctype) {
  if (!doctype) return ''

  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''
  const systemId = doctype.systemId ? ` "${doctype.systemId}"` : ''

  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`
}

function formatXmlNode (node, level = 0) {
  const indent = INDENT.repeat(level)

  if (node.nodeType === NODE_TYPES.text) {
    return `${indent}${escapeText(node.textContent.trim())}`
  }

  if (node.nodeType === NODE_TYPES.cdata) {
    return `${indent}<![CDATA[${node.textContent}]]>`
  }

  if (node.nodeType === NODE_TYPES.comment) {
    return `${indent}<!--${node.textContent}-->`
  }

  const attrs = Array.from(node.attributes)
    .map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`)
    .join('')
  const children = getElementChildren(node)

  if (children.length === 0) {
    return `${indent}<${node.nodeName}${attrs}/>`
  }

  if (children.length === 1 && children[0].nodeType === NODE_TYPES.text) {
    return `${indent}<${node.nodeName}${attrs}>${escapeText(children[0].textContent.trim())}</${node.nodeName}>`
  }

  return [
    `${indent}<${node.nodeName}${attrs}>`,
    ...children.map((child) => formatXmlNode(child, level + 1)),
    `${indent}</${node.nodeName}>`
  ].join('\n')
}

function escapeText (value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr (value) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function nodeText (node) {
  if (node.nodeType === NODE_TYPES.element) {
    const attrs = Array.from(node.attributes)
      .map((attr) => `${attr.name}="${attr.value}"`)
      .join(' ')
    return `${node.nodeName} ${attrs} ${node.textContent}`.toLowerCase()
  }

  return node.textContent.toLowerCase()
}

function getElementChildren (node) {
  return Array.from(node.childNodes).filter((child) => {
    if (child.nodeType === NODE_TYPES.text) {
      return child.textContent.trim()
    }

    return child.nodeType === NODE_TYPES.element || child.nodeType === NODE_TYPES.cdata || child.nodeType === NODE_TYPES.comment
  })
}

function collectMatches (node, query, path = '0', matches = new Set(), ancestors = new Set()) {
  if (!query) return { matches, ancestors }

  const lowerQuery = query.toLowerCase()

  if (nodeText(node).includes(lowerQuery)) {
    matches.add(path)
    path.split('.').slice(0, -1).forEach((_, index, parts) => {
      ancestors.add(parts.slice(0, index + 1).join('.'))
    })
  }

  getElementChildren(node).forEach((child, index) => {
    collectMatches(child, query, `${path}.${index}`, matches, ancestors)
  })

  return { matches, ancestors }
}

function highlight (value, query) {
  if (!query) return value

  const lowerValue = value.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerValue.indexOf(lowerQuery)

  if (index === -1) return value

  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  )
}

function isInlineElement (node) {
  const children = getElementChildren(node)
  return node.nodeType === NODE_TYPES.element && children.length === 1 && children[0].nodeType === NODE_TYPES.text
}

function canCollapseNode (node) {
  return node.nodeType === NODE_TYPES.element && getElementChildren(node).length > 0 && !isInlineElement(node)
}

function XmlElementName ({ node, query }) {
  const attrs = Array.from(node.attributes)

  return (
    <>
      <span className='xml-tag'>&lt;{highlight(node.nodeName, query)}</span>
      {attrs.map((attr) => (
        <span className='xml-attr' key={attr.name}>
          {' '}{highlight(attr.name, query)}=<span className='xml-value'>"{highlight(attr.value, query)}"</span>
        </span>
      ))}
      <span className='xml-tag'>&gt;</span>
    </>
  )
}

function XmlNode ({ node, path, collapsed, matches, expandedBySearch, query, onToggle }) {
  const children = getElementChildren(node)
  const isElement = node.nodeType === NODE_TYPES.element
  const canCollapse = canCollapseNode(node)
  const isCollapsed = collapsed.has(path) && !expandedBySearch.has(path)
  const isMatched = matches.has(path)

  if (!isElement) {
    const prefix = node.nodeType === NODE_TYPES.cdata
      ? '<![CDATA['
      : node.nodeType === NODE_TYPES.comment ? '<!--' : ''
    const suffix = node.nodeType === NODE_TYPES.cdata
      ? ']]>'
      : node.nodeType === NODE_TYPES.comment ? '-->' : ''

    return (
      <div className={`xml-row xml-leaf ${isMatched ? 'is-match' : ''}`}>
        <span className='xml-spacer' />
        <span className='xml-text'>{prefix}{highlight(node.textContent.trim(), query)}{suffix}</span>
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className={`xml-row xml-leaf ${isMatched ? 'is-match' : ''}`}>
        <span className='xml-spacer' />
        <span className='xml-tag'>&lt;{highlight(node.nodeName, query)}</span>
        {Array.from(node.attributes).map((attr) => (
          <span className='xml-attr' key={attr.name}>
            {' '}{highlight(attr.name, query)}=<span className='xml-value'>"{highlight(attr.value, query)}"</span>
          </span>
        ))}
        <span className='xml-tag'>/&gt;</span>
      </div>
    )
  }

  if (isInlineElement(node)) {
    return (
      <div className={`xml-row xml-leaf ${isMatched ? 'is-match' : ''}`}>
        <span className='xml-spacer' />
        <XmlElementName node={node} query={query} />
        <span className='xml-text'>{highlight(children[0].textContent.trim(), query)}</span>
        <span className='xml-tag'>&lt;/{highlight(node.nodeName, query)}&gt;</span>
      </div>
    )
  }

  return (
    <div className={`xml-node ${isMatched ? 'is-match' : ''}`}>
      <div className='xml-row'>
        <button
          className='fold-button'
          disabled={!canCollapse}
          onClick={() => onToggle(path)}
          title={canCollapse ? '折叠/展开' : '没有子节点'}
        >
          {canCollapse ? (isCollapsed ? '>' : 'v') : ''}
        </button>
        <XmlElementName node={node} query={query} />
        {isCollapsed && <span className='xml-muted'>...</span>}
        {isCollapsed && <span className='xml-tag'>&lt;/{node.nodeName}&gt;</span>}
      </div>
      {!isCollapsed && (
        <>
          <div className='xml-children'>
            {children.map((child, index) => (
              <XmlNode
                key={`${path}.${index}`}
                node={child}
                path={`${path}.${index}`}
                collapsed={collapsed}
                matches={matches}
                expandedBySearch={expandedBySearch}
                query={query}
                onToggle={onToggle}
              />
            ))}
          </div>
          <div className='xml-row xml-close'>
            <span className='xml-spacer' />
            <span className='xml-tag'>&lt;/{highlight(node.nodeName, query)}&gt;</span>
          </div>
        </>
      )}
    </div>
  )
}

export default function App () {
  const [input, setInput] = useState(SAMPLE_XML)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(new Set())
  const [copied, setCopied] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState(readHistory)
  const hasEditedRef = useRef(false)
  const skipNextSaveRef = useRef(false)

  const saveHistory = useCallback((value) => {
    const content = value.trim()
    if (!content) return
    const signature = getHistorySignature(content)

    setHistoryItems((current) => {
      const next = [
        {
          id: `${Date.now()}-${content.length}`,
          title: getHistoryTitle(content),
          content,
          signature,
          createdAt: Date.now()
        },
        ...current.filter((item) => (item.signature || getHistorySignature(item.content)) !== signature)
      ].slice(0, MAX_HISTORY_ITEMS)

      writeHistory(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (!window.utools) return

    window.utools.setExpendHeight(PLUGIN_EXPAND_HEIGHT)

    window.utools.onPluginEnter((action) => {
      if (typeof action.payload === 'string') {
        setInput(action.payload)
        saveHistory(action.payload)
      }

      window.utools.setExpendHeight(PLUGIN_EXPAND_HEIGHT)
    })
  }, [saveHistory])

  useEffect(() => {
    if (!hasEditedRef.current) return

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }

    const timer = window.setTimeout(() => saveHistory(input), 700)
    return () => window.clearTimeout(timer)
  }, [input, saveHistory])

  const parsed = useMemo(() => parseXml(input), [input])
  const formatted = useMemo(() => (parsed.error ? '' : formatXml(input)), [input, parsed.error])
  const search = useMemo(() => {
    if (!parsed.doc?.documentElement || !query.trim()) {
      return { matches: new Set(), ancestors: new Set() }
    }

    return collectMatches(parsed.doc.documentElement, query.trim())
  }, [parsed.doc, query])

  const stats = useMemo(() => {
    if (!parsed.doc?.documentElement) return { nodes: 0, attributes: 0 }

    const elements = Array.from(parsed.doc.getElementsByTagName('*'))
    return {
      nodes: elements.length,
      attributes: elements.reduce((total, node) => total + node.attributes.length, 0)
    }
  }, [parsed.doc])

  const handleCopy = async () => {
    if (!formatted) return
    await navigator.clipboard.writeText(formatted)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const handleClear = () => {
    setInput('')
    setCollapsed(new Set())
  }

  const handleInputChange = (event) => {
    hasEditedRef.current = true
    setInput(event.target.value)
  }

  const handleRestoreHistory = (item) => {
    skipNextSaveRef.current = item.content !== input
    setInput(item.content)
    setCollapsed(new Set())
  }

  const handleDeleteHistory = (id) => {
    setHistoryItems((current) => {
      const next = current.filter((item) => item.id !== id)
      writeHistory(next)
      return next
    })
  }

  const handleClearHistory = () => {
    setHistoryItems([])
    writeHistory([])
  }

  const handleToggle = (path) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleExpandAll = () => setCollapsed(new Set())

  const handleCollapseAll = () => {
    if (!parsed.doc?.documentElement) return

    const next = new Set()
    const walk = (node, path = '0') => {
      if (canCollapseNode(node)) next.add(path)
      getElementChildren(node).forEach((child, index) => walk(child, `${path}.${index}`))
    }

    walk(parsed.doc.documentElement)
    setCollapsed(next)
  }

  return (
    <main className='app-shell'>
      <section className='toolbar'>
        <div>
          <h1>XML 格式化</h1>
          <p>{parsed.error ? '解析失败，请检查 XML 结构' : `${stats.nodes} 个节点，${stats.attributes} 个属性`}</p>
        </div>
      </section>

      <section className='workspace'>
        <div className='editor-panel'>
          <div className='panel-header'>
            <strong>输入 XML</strong>
            <span>{input.length.toLocaleString()} 字符</span>
          </div>
          <textarea
            spellCheck='false'
            value={input}
            onChange={handleInputChange}
            placeholder='在这里粘贴 XML...'
          />
          <div className='history-bar'>
            <button className='ghost-button' onClick={() => setHistoryOpen((value) => !value)}>
              历史
            </button>
            <span>{historyItems.length ? `${historyItems.length} 条记录` : '暂无历史'}</span>
          </div>
          {historyOpen && (
            <div className='history-panel'>
              <div className='history-panel-header'>
                <strong>历史记录</strong>
                <button className='ghost-button' onClick={handleClearHistory} disabled={!historyItems.length}>清空</button>
              </div>
              {historyItems.length > 0 && (
                <div className='history-list'>
                  {historyItems.map((item) => (
                    <div
                      className='history-item'
                      key={item.id}
                    >
                      <button
                        className='history-restore'
                        onClick={() => handleRestoreHistory(item)}
                        title='恢复这条 XML'
                      >
                        <span>{item.title}</span>
                        <small>{formatHistoryTime(item.createdAt)} · {item.content.length.toLocaleString()} 字符</small>
                      </button>
                      <button
                        className='history-delete'
                        onClick={() => handleDeleteHistory(item.id)}
                        title='删除这条历史'
                        aria-label={`删除 ${item.title}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {historyItems.length === 0 && <div className='history-empty'>输入或粘贴 XML 后会自动记录</div>}
            </div>
          )}
        </div>

        <div className='viewer-panel'>
          <div className='panel-header viewer-header'>
            <strong>格式化结果</strong>
            <div className='viewer-tools'>
              <button className='copy-output-button' onClick={handleCopy} disabled={!formatted}>
                {copied ? '已复制' : '复制'}
              </button>
              <button className='ghost-button' onClick={handleClear}>清空</button>
              <div className='search-box'>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder='搜索标签、属性、文本'
                />
                <span>{query.trim() ? `${search.matches.size} 处` : '搜索'}</span>
              </div>
            </div>
          </div>

          <div className='tree-actions'>
            <button className='ghost-button' onClick={handleExpandAll} disabled={!parsed.doc}>全部展开</button>
            <button className='ghost-button' onClick={handleCollapseAll} disabled={!parsed.doc}>全部折叠</button>
          </div>

          <div className='viewer-body'>
            {parsed.error && <div className='error-box'>{parsed.error}</div>}
            {!parsed.error && parsed.doc?.documentElement && (
              <div className='xml-tree'>
                <XmlNode
                  node={parsed.doc.documentElement}
                  path='0'
                  collapsed={collapsed}
                  matches={search.matches}
                  expandedBySearch={search.ancestors}
                  query={query.trim()}
                  onToggle={handleToggle}
                />
              </div>
            )}
            {!parsed.error && !input.trim() && <div className='empty-box'>等待 XML 输入</div>}
          </div>
        </div>
      </section>
    </main>
  )
}
