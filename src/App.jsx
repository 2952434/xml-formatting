import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import XmlTree from './XmlTree.jsx'
import CodeEditor from './CodeEditor.jsx'
import XPathPanel from './XPathPanel.jsx'
import XmlCompare from './XmlCompare.jsx'
import {
  DEFAULT_FORMAT_OPTIONS,
  INDENT_UNITS,
  canCollapseNode,
  collectMatches,
  formatXml,
  getHistorySignature,
  getNodeXPath,
  getTreeNodeEntries,
  serializeXmlNode,
  getStats,
  getSuggestedFileName,
  getTreeChildren,
  getXmlTitle,
  jsonToXml,
  parseXml,
  xmlToJson
} from './xml.js'

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

const PLUGIN_EXPAND_HEIGHT = 760
const HISTORY_STORAGE_KEY = 'xml-format-history'
const OPTIONS_STORAGE_KEY = 'xml-format-options'
const MAX_HISTORY_ITEMS = 20
const FILE_EXTENSIONS = ['xml', 'xsd', 'xsl', 'xslt', 'svg', 'rss', 'plist', 'txt']
const ACCEPT_EXTENSIONS = FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')
const VIEW_MODES = [
  { key: 'tree', label: '树视图' },
  { key: 'source', label: '源码' },
  { key: 'json', label: 'JSON' },
  { key: 'xpath', label: 'XPath' },
  { key: 'compare', label: '对比' }
]

function isUtoolsReady () {
  return Boolean(window.utools)
}

function baseName (filePath) {
  return String(filePath).split(/[\\/]/).pop() || ''
}

function readOptions () {
  try {
    const raw = window.localStorage?.getItem(OPTIONS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null

    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FORMAT_OPTIONS }

    return {
      indent: INDENT_UNITS[parsed.indent] ? String(parsed.indent) : DEFAULT_FORMAT_OPTIONS.indent,
      sortAttributes: Boolean(parsed.sortAttributes),
      minify: Boolean(parsed.minify)
    }
  } catch {
    return { ...DEFAULT_FORMAT_OPTIONS }
  }
}

function writeOptions (options) {
  try {
    window.localStorage?.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options))
  } catch {
    // 选项写入失败只影响下次启动的默认值，不打断当前使用
  }
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
    return true
  } catch {
    return false
  }
}

/**
 * 写入历史记录。localStorage 容量有限（约 5MB），
 * 写入失败时逐级丢弃较旧的记录重试，并把原因回传给界面提示。
 */
function persistHistory (items) {
  if (writeHistory(items)) return { items, warning: '' }

  let kept = items.slice(0, Math.max(1, Math.floor(items.length / 2)))

  while (kept.length > 1 && !writeHistory(kept)) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)))
  }

  if (writeHistory(kept)) {
    return { items: kept, warning: '本地存储空间不足，已自动清理较旧的历史记录' }
  }

  return { items: kept, warning: '本地存储空间不足，历史记录仅在本次会话中保留，关闭后会丢失' }
}

function formatHistoryTime (timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

async function copyText (text) {
  if (!text) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 无剪贴板权限或页面未聚焦时回落到 execCommand
    }
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const succeeded = document.execCommand('copy')
    document.body.removeChild(area)

    return succeeded
  } catch {
    return false
  }
}

function pickFileInBrowser () {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT_EXTENSIONS
    input.style.display = 'none'

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      cleanup()

      if (!file) {
        resolve({ canceled: true })
        return
      }

      file.text()
        .then((content) => resolve({ name: file.name, content }))
        .catch((error) => resolve({ error: `读取文件失败：${error.message}` }))
    })

    input.addEventListener('cancel', () => {
      cleanup()
      resolve({ canceled: true })
    })

    document.body.appendChild(input)
    input.click()
  })
}

async function openXmlFile () {
  if (isUtoolsReady() && window.services?.readFile) {
    const picked = window.utools.showOpenDialog({
      title: '打开 XML 文件',
      filters: [{ name: 'XML', extensions: FILE_EXTENSIONS }],
      properties: ['openFile']
    })

    if (!picked || !picked.length) return { canceled: true }

    const filePath = picked[0]

    try {
      return { name: baseName(filePath), content: window.services.readFile(filePath) }
    } catch (error) {
      return { error: `读取文件失败：${error.message}` }
    }
  }

  return pickFileInBrowser()
}

function saveTextFile (content, suggestedName) {
  if (isUtoolsReady() && window.services?.writeFile) {
    const target = window.utools.showSaveDialog({
      title: '保存 XML 文件',
      defaultPath: suggestedName,
      filters: [{ name: 'XML', extensions: ['xml'] }]
    })

    if (!target) return { canceled: true }

    try {
      window.services.writeFile(target, content)
      window.utools.shellShowItemInFolder(target)
      return { name: baseName(target) }
    } catch (error) {
      return { error: `保存失败：${error.message}` }
    }
  }

  try {
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = suggestedName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    return { name: suggestedName }
  } catch (error) {
    return { error: `保存失败：${error.message}` }
  }
}

export default function App () {
  const [input, setInput] = useState(SAMPLE_XML)
  const [fileName, setFileName] = useState('')
  const [query, setQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1)
  const [collapsed, setCollapsed] = useState(new Set())
  const [selectedPath, setSelectedPath] = useState('')
  const [depth, setDepth] = useState('2')
  const [options, setOptions] = useState(readOptions)
  const [viewMode, setViewMode] = useState('tree')
  const [copyNotice, setCopyNotice] = useState(null)
  const [notice, setNotice] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState(readHistory)
  const [historyWarning, setHistoryWarning] = useState('')
  const hasEditedRef = useRef(false)
  const skipNextSaveRef = useRef(false)
  const noticeTimerRef = useRef(0)
  const copyNoticeTimerRef = useRef(0)
  const viewerBodyRef = useRef(null)

  const showNotice = useCallback((message) => {
    window.clearTimeout(noticeTimerRef.current)
    setNotice(message)

    if (message) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2600)
    }
  }, [])

  const showCopyNotice = useCallback((message, success = true) => {
    window.clearTimeout(copyNoticeTimerRef.current)
    setCopyNotice({ message, success })
    copyNoticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 2200)
  }, [])

  useEffect(() => () => {
    window.clearTimeout(noticeTimerRef.current)
    window.clearTimeout(copyNoticeTimerRef.current)
  }, [])

  useEffect(() => {
    writeOptions(options)
  }, [options])

  // 统一在这里落盘历史记录，容量不足时 persistHistory 会裁剪并给出提示
  useEffect(() => {
    const result = persistHistory(historyItems)

    setHistoryWarning(result.warning)

    if (result.items !== historyItems) {
      setHistoryItems(result.items)
    }
  }, [historyItems])

  const saveHistory = useCallback((value) => {
    const content = String(value || '').trim()
    if (!content) return
    const signature = getHistorySignature(content)

    setHistoryItems((current) => ([
      {
        id: `${Date.now()}-${content.length}`,
        title: getXmlTitle(content),
        content,
        signature,
        createdAt: Date.now()
      },
      ...current.filter((item) => (item.signature || getHistorySignature(item.content)) !== signature)
    ].slice(0, MAX_HISTORY_ITEMS)))
  }, [])

  const loadContent = useCallback((content, name = '') => {
    hasEditedRef.current = true
    skipNextSaveRef.current = false
    setInput(content)
    setQuery('')
    setCollapsed(new Set())
    setFileName(name)
  }, [])

  useEffect(() => {
    if (!isUtoolsReady()) return

    window.utools.setExpendHeight(PLUGIN_EXPAND_HEIGHT)

    window.utools.onPluginEnter((action) => {
      const payload = action?.payload

      if (action?.type === 'files' && Array.isArray(payload) && payload.length) {
        const filePath = payload[0].path || ''

        try {
          loadContent(window.services.readFile(filePath), baseName(filePath))
        } catch (error) {
          showNotice(`读取文件失败：${error.message}`)
        }
      } else if (typeof payload === 'string') {
        setInput(payload)
        saveHistory(payload)
      }

      window.utools.setExpendHeight(PLUGIN_EXPAND_HEIGHT)
    })
  }, [loadContent, saveHistory, showNotice])

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
  const formatted = useMemo(
    () => (parsed.error ? '' : formatXml(input, options)),
    [input, parsed.error, options]
  )
  const conversion = useMemo(() => {
    if (viewMode !== 'json') return { error: '', output: '', direction: '' }

    const source = input.trim()
    if (!source) return { error: '', output: '', direction: '' }

    if (/^[[{]/.test(source)) {
      const result = jsonToXml(source, options)
      return { error: result.error, output: result.output, direction: 'json-to-xml' }
    }

    const result = xmlToJson(source)
    return { error: result.error, output: result.output, direction: 'xml-to-json' }
  }, [viewMode, input, options])

  const search = useMemo(() => {
    if (!parsed.doc?.documentElement || !query.trim()) {
      return { matches: new Set(), ancestors: new Set(), matchPaths: [] }
    }

    return collectMatches(parsed.doc.documentElement, query.trim())
  }, [parsed.doc, query])

  const entries = useMemo(() => getTreeNodeEntries(parsed.doc?.documentElement), [parsed.doc])
  const selectedNode = entries.find((entry) => entry.path === selectedPath)?.node
  const activeMatchPath = selectedPath || search.matchPaths[activeMatchIndex] || ''
  const expandedPaths = useMemo(() => {
    const paths = new Set(search.ancestors)
    selectedPath.split('.').slice(0, -1).forEach((_, index, parts) => paths.add(parts.slice(0, index + 1).join('.')))
    return paths
  }, [search.ancestors, selectedPath])

  useEffect(() => { setSelectedPath('') }, [input])

  const copyNodeText = async (text) => {
    // 空节点值也允许复制，清空剪贴板便于提取字段。
    if (text === '') {
      try { await navigator.clipboard.writeText(''); showCopyNotice('已复制空值') } catch { showCopyNotice('复制失败', false) }
    } else {
      const success = await copyText(text)
      showCopyNotice(success ? '已复制' : '复制失败，请手动复制', success)
    }
  }

  const locateNode = (node) => {
    let target = node.nodeType === 2 ? node.ownerElement : node.nodeType === 9 ? node.documentElement : node
    while (target && !entries.some((entry) => entry.node === target)) target = target.parentNode
    const entry = entries.find((entry) => entry.node === target)
    if (!entry) { showNotice('此节点不在树视图中展示，可复制查询结果'); return }
    setSelectedPath(entry.path)
    setViewMode('tree')
  }

  const foldToDepth = () => {
    setSelectedPath('')
    setQuery('')
    setCollapsed(new Set(entries.filter(({ node, path }) => canCollapseNode(node) && path.split('.').length >= Number(depth)).map(({ path }) => path)))
  }

  useEffect(() => {
    setActiveMatchIndex(query.trim() && search.matchPaths.length ? 0 : -1)
  }, [query, search.matchPaths.length])

  useEffect(() => {
    if (!activeMatchPath) return

    viewerBodyRef.current
      ?.querySelector(`[data-node-path="${activeMatchPath}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }, [activeMatchPath, viewMode])

  const stats = useMemo(() => getStats(parsed.doc), [parsed.doc])

  const outputText = viewMode === 'json' ? conversion.output : ['xpath', 'compare'].includes(viewMode) ? '' : formatted
  const saveContent = formatted || (conversion.direction === 'json-to-xml' ? conversion.output : '')

  const handleCopy = async () => {
    if (!outputText) return

    if (await copyText(outputText)) {
      showCopyNotice('已复制')
      return
    }

    showCopyNotice('复制失败，请手动选中内容后复制', false)
  }

  const handleOpenFile = async () => {
    const result = await openXmlFile()

    if (result.canceled) return

    if (result.error) {
      showNotice(result.error)
      return
    }

    loadContent(result.content, result.name || '')
    showNotice(`已打开 ${result.name || '文件'}`)
  }

  const handleSaveFile = () => {
    if (!saveContent) return

    const result = saveTextFile(saveContent, getSuggestedFileName(input))

    if (result.canceled) return

    if (result.error) {
      showNotice(result.error)
      return
    }

    showNotice(`已保存为 ${result.name}`)
  }

  const handleClear = () => {
    hasEditedRef.current = false
    setInput('')
    setQuery('')
    setFileName('')
    setCollapsed(new Set())
  }

  const handleInputChange = (value) => {
    hasEditedRef.current = true
    setInput(value)
  }

  const handleRestoreHistory = (item) => {
    skipNextSaveRef.current = item.content !== input
    setInput(item.content)
    setQuery('')
    setFileName('')
    setCollapsed(new Set())
  }

  const handleDeleteHistory = (id) => {
    setHistoryItems((current) => current.filter((item) => item.id !== id))
  }

  const handleClearHistory = () => {
    setHistoryItems([])
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

  const handleExpandAll = () => { setCollapsed(new Set()); setSelectedPath('') }

  const moveSearch = (direction) => {
    setSelectedPath('')
    if (!search.matchPaths.length) return

    setActiveMatchIndex((current) => {
      const start = current < 0 ? 0 : current
      return (start + direction + search.matchPaths.length) % search.matchPaths.length
    })
  }

  const handleSearchKeyDown = (event) => {
    if (event.key !== 'Enter') return

    event.preventDefault()
    moveSearch(event.shiftKey ? -1 : 1)
  }

  const handleCollapseAll = () => {
    setSelectedPath('')
    setQuery('')
    if (!parsed.doc?.documentElement) return

    const next = new Set()
    const walk = (node, path = '0') => {
      if (canCollapseNode(node)) next.add(path)
      getTreeChildren(node).forEach((child, index) => walk(child, `${path}.${index}`))
    }

    walk(parsed.doc.documentElement)
    setCollapsed(next)
  }

  const handleDragOver = (event) => {
    const types = Array.from(event.dataTransfer?.types || [])
    if (!types.includes('Files')) return

    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return

    setDragActive(false)
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setDragActive(false)

    const file = event.dataTransfer?.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      loadContent(content, file.name)
      showNotice(`已载入 ${file.name}`)
    } catch (error) {
      showNotice(`读取文件失败：${error.message}`)
    }
  }

  const handleOptionsChange = (patch) => {
    setOptions((current) => ({ ...current, ...patch }))
  }

  const summary = conversion.direction === 'json-to-xml'
    ? conversion.error ? 'JSON 转换失败，请检查输入' : 'JSON 输入 · 已转换为 XML'
    : parsed.error ? '解析失败，请检查 XML 结构' : `${stats.nodes} 个节点，${stats.attributes} 个属性`

  return (
    <main className='app-shell'>
      <section className='toolbar'>
        <div>
          <h1>XML 格式化</h1>
          <p>{summary}</p>
        </div>
        <div className='toolbar-actions'>
          <button className='ghost-button' onClick={handleOpenFile}>打开文件</button>
          <button className='ghost-button' onClick={handleSaveFile} disabled={!saveContent}>另存为 .xml</button>
        </div>
      </section>

      {notice && <div className='notice-bar'>{notice}</div>}
      {copyNotice && (
        <div className={`copy-toast${copyNotice.success ? '' : ' is-error'}`} role='status' aria-live='polite'>
          <span className='copy-toast-icon' aria-hidden='true'>{copyNotice.success ? '✓' : '!'}</span>
          <span>{copyNotice.message}</span>
        </div>
      )}

      <section
        className='workspace'
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className={`editor-panel${dragActive ? ' is-drag-active' : ''}`}>
          <div className='panel-header'>
            <strong>输入</strong>
            <span>{fileName ? `${fileName} · ` : ''}{input.length.toLocaleString()} 字符</span>
          </div>
          <CodeEditor value={input} onChange={handleInputChange} errorLine={conversion.direction === 'json-to-xml' ? 0 : parsed.errorLine} errorColumn={parsed.errorColumn} />
          {dragActive && <div className='drop-hint'>松开即可载入文件</div>}
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
              {historyWarning && <div className='history-warning'>{historyWarning}</div>}
              {historyItems.length > 0 && (
                <div className='history-list'>
                  {historyItems.map((item) => (
                    <div className='history-item' key={item.id}>
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
            <div className='segmented'>
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.key}
                  type='button'
                  className={viewMode === mode.key ? 'active' : ''}
                  onClick={() => setViewMode(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className='viewer-tools'>
              <button className='copy-output-button' onClick={handleCopy} disabled={!outputText}>
                复制
              </button>
              <button className='ghost-button' onClick={handleClear}>清空</button>
            </div>
          </div>

          <div className='options-bar' hidden={['xpath', 'compare'].includes(viewMode)}>
            <label>
              缩进
              <select
                value={options.indent}
                disabled={options.minify}
                onChange={(event) => handleOptionsChange({ indent: event.target.value })}
              >
                <option value='2'>2 空格</option>
                <option value='4'>4 空格</option>
                <option value='tab'>Tab</option>
              </select>
            </label>
            <label className='options-check'>
              <input
                type='checkbox'
                checked={options.sortAttributes}
                onChange={(event) => handleOptionsChange({ sortAttributes: event.target.checked })}
              />
              属性按名称排序
            </label>
            <label className='options-check'>
              <input
                type='checkbox'
                checked={options.minify}
                onChange={(event) => handleOptionsChange({ minify: event.target.checked })}
              />
              压缩为一行
            </label>
            {conversion.direction && (
              <span className='viewer-hint'>
                {conversion.direction === 'json-to-xml' ? '按 JSON → XML 转换' : '按 XML → JSON 转换'}
              </span>
            )}
          </div>

          {viewMode === 'tree' && (
            <div className='tree-toolbar'>
              <div className='search-box'>
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSelectedPath('') }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder='搜索标签、属性、文本'
                  disabled={!parsed.doc}
                />
                <span>{query.trim() ? `${search.matches.size ? activeMatchIndex + 1 : 0}/${search.matches.size}` : '搜索'}</span>
                <div className='search-nav'>
                  <button
                    type='button'
                    onClick={() => moveSearch(-1)}
                    disabled={!search.matchPaths.length}
                    title='上一个匹配项'
                    aria-label='上一个匹配项'
                  >
                    ↑
                  </button>
                  <button
                    type='button'
                    onClick={() => moveSearch(1)}
                    disabled={!search.matchPaths.length}
                    title='下一个匹配项'
                    aria-label='下一个匹配项'
                  >
                    ↓
                  </button>
                </div>
              </div>
              <select aria-label='展开层级' value={depth} onChange={(event) => setDepth(event.target.value)}>
                {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level} 层</option>)}
              </select>
              <button className='ghost-button' onClick={foldToDepth} disabled={!parsed.doc}>按层展开</button>
              <button className='ghost-button' onClick={handleExpandAll} disabled={!parsed.doc}>全部展开</button>
              <button className='ghost-button' onClick={handleCollapseAll} disabled={!parsed.doc}>全部折叠</button>
            </div>
          )}

          {viewMode === 'tree' && selectedNode && (
            <div className='node-actions'>
              <strong>已选：{selectedNode.nodeName}</strong>
              <button className='ghost-button' onClick={() => copyNodeText(serializeXmlNode(selectedNode))}>复制节点 XML</button>
              <button className='ghost-button' onClick={() => copyNodeText(selectedNode.textContent)}>复制节点值</button>
              <button className='ghost-button' onClick={() => copyNodeText(getNodeXPath(selectedNode))}>复制 XPath</button>
              {Array.from(selectedNode.attributes || []).map((attr) => (
                <button key={attr.name} className='ghost-button' onClick={() => copyNodeText(attr.value)} title={attr.value}>复制 @{attr.name}</button>
              ))}
              <button className='ghost-button' onClick={() => setSelectedPath('')}>取消选择</button>
            </div>
          )}
          <div className='viewer-body' ref={viewerBodyRef}>
            {viewMode === 'tree' && (
              <>
                {parsed.error && (
                  <div className='error-box'>
                    {parsed.error}
                    {parsed.errorLine > 0 && (
                      <div className='error-location'>约在第 {parsed.errorLine} 行，第 {parsed.errorColumn} 列</div>
                    )}
                  </div>
                )}
                {!parsed.error && parsed.doc?.documentElement && (
                  <XmlTree
                    root={parsed.doc.documentElement}
                    collapsed={collapsed}
                    matches={search.matches}
                    activeMatchPath={activeMatchPath}
                    expandedBySearch={expandedPaths}
                    query={query.trim()}
                    onToggle={handleToggle}
                    onSelect={setSelectedPath}
                  />
                )}
                {!parsed.error && !input.trim() && <div className='empty-box'>等待 XML 输入</div>}
              </>
            )}

            <div hidden={viewMode !== 'xpath'}><XPathPanel doc={parsed.doc} onLocate={locateNode} onCopy={copyNodeText} /></div>
            <div className='compare-container' hidden={viewMode !== 'compare'}><XmlCompare source={input} active={viewMode === 'compare'} /></div>

            {viewMode === 'source' && (
              formatted
                ? <pre className='source-view'>{formatted}</pre>
                : (
                  <div className={parsed.error ? 'error-box' : 'empty-box'}>
                    {parsed.error ? '解析失败，无法生成格式化结果' : '等待 XML 输入'}
                  </div>
                  )
            )}

            {viewMode === 'json' && (
              conversion.output
                ? <pre className='source-view'>{conversion.output}</pre>
                : (
                  <div className={conversion.error ? 'error-box' : 'empty-box'}>
                    {conversion.error || '输入 XML 得到 JSON，输入 JSON 得到 XML'}
                  </div>
                  )
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
