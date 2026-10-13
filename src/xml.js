/**
 * XML 解析、格式化、搜索与 JSON 互转的纯逻辑集合。
 * 这里不依赖 React，便于单独做单元测试。
 */

export const NODE_TYPES = {
  element: 1,
  text: 3,
  cdata: 4,
  comment: 8
}

export const INDENT_UNITS = {
  2: '  ',
  4: '    ',
  tab: '\t'
}

export const DEFAULT_FORMAT_OPTIONS = {
  indent: '4',
  sortAttributes: false,
  minify: false
}

/** 把界面上保存的选项归一化成格式化内部需要的形状 */
export function normalizeOptions (options) {
  const source = options && typeof options === 'object' ? options : {}

  return {
    indentUnit: INDENT_UNITS[source.indent] || INDENT_UNITS[DEFAULT_FORMAT_OPTIONS.indent],
    sortAttributes: Boolean(source.sortAttributes),
    minify: Boolean(source.minify)
  }
}

export function parseXml (value) {
  const source = String(value || '')

  if (!source.trim()) {
    return { doc: null, error: '', errorLine: 0, errorColumn: 0 }
  }

  const doc = new window.DOMParser().parseFromString(source, 'application/xml')
  const parserError = doc.querySelector('parsererror')

  if (parserError) {
    return describeParseError(parserError.textContent)
  }

  return { doc, error: '', errorLine: 0, errorColumn: 0 }
}

function describeParseError (text) {
  const message = String(text || '').replace(/\s+/g, ' ').trim()
  // Chrome: "error on line 3 at column 5"；部分解析器: "3:5: unexpected ..."
  const matched = /line\s+(\d+)\s+at\s+column\s+(\d+)/i.exec(message) ||
    /(\d+):(\d+):/.exec(message)

  return {
    doc: null,
    error: message || 'XML 解析失败',
    errorLine: matched ? Number(matched[1]) : 0,
    errorColumn: matched ? Number(matched[2]) : 0
  }
}

/** 结构性子节点：元素、CDATA、注释（不含文本） */
export function getStructuralChildren (node) {
  return Array.from(node.childNodes).filter((child) => (
    child.nodeType === NODE_TYPES.element ||
    child.nodeType === NODE_TYPES.cdata ||
    child.nodeType === NODE_TYPES.comment
  ))
}

/** 树视图里需要展示的子节点：结构性节点 + 非空白文本 */
export function getTreeChildren (node) {
  return Array.from(node.childNodes).filter((child) => {
    if (child.nodeType === NODE_TYPES.text) return Boolean(child.textContent.trim())

    return child.nodeType === NODE_TYPES.element ||
      child.nodeType === NODE_TYPES.cdata ||
      child.nodeType === NODE_TYPES.comment
  })
}

export function isElementNode (node) {
  return node.nodeType === NODE_TYPES.element
}

/** 单行元素：只有一个文本子节点，例如 <title>xxx</title> */
export function isInlineElement (node) {
  if (!isElementNode(node)) return false

  const children = getTreeChildren(node)

  return children.length === 1 && children[0].nodeType === NODE_TYPES.text
}

export function canCollapseNode (node) {
  return isElementNode(node) && getTreeChildren(node).length > 0 && !isInlineElement(node)
}

/** 文本子节点内容（去空白后拼接），用于判断是否属于混合内容 */
export function getTextContent (node) {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === NODE_TYPES.text)
    .map((child) => child.textContent.trim())
    .filter(Boolean)
    .join(' ')
}

/** 文本 + CDATA 内容，用于 JSON 转换 */
function getNodeText (node) {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === NODE_TYPES.text || child.nodeType === NODE_TYPES.cdata)
    .map((child) => child.textContent.trim())
    .filter(Boolean)
    .join(' ')
}

export function escapeText (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeAttr (value) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function formatAttributes (node, sortAttributes) {
  const attributes = Array.from(node.attributes)

  if (sortAttributes) {
    attributes.sort((a, b) => a.name.localeCompare(b.name))
  }

  return attributes.map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`).join('')
}

function formatDoctype (doctype) {
  if (!doctype) return ''

  // PUBLIC 后面直接跟 systemId；只有 systemId 时才需要 SYSTEM 关键字
  if (doctype.publicId) {
    const systemId = doctype.systemId ? ` "${doctype.systemId}"` : ''

    return `<!DOCTYPE ${doctype.name} PUBLIC "${doctype.publicId}"${systemId}>`
  }

  if (doctype.systemId) {
    return `<!DOCTYPE ${doctype.name} SYSTEM "${doctype.systemId}">`
  }

  return `<!DOCTYPE ${doctype.name}>`
}

/** 不做缩进、不额外插入空白的序列化，用于混合内容与 JSON 转换 */
function serializeInlineChildren (node, settings) {
  return Array.from(node.childNodes)
    .map((child) => serializeInlineNode(child, settings))
    .join('')
}

function serializeInlineNode (node, settings) {
  if (node.nodeType === NODE_TYPES.text) return escapeText(node.textContent)
  if (node.nodeType === NODE_TYPES.cdata) return `<![CDATA[${node.textContent}]]>`
  if (node.nodeType === NODE_TYPES.comment) return `<!--${node.textContent}-->`
  if (node.nodeType !== NODE_TYPES.element) return ''

  const attrs = formatAttributes(node, settings.sortAttributes)

  if (node.childNodes.length === 0) return `<${node.nodeName}${attrs}/>`

  return `<${node.nodeName}${attrs}>${serializeInlineChildren(node, settings)}</${node.nodeName}>`
}

function formatNode (node, settings, level) {
  const indent = settings.minify ? '' : settings.indentUnit.repeat(level)
  const lineBreak = settings.minify ? '' : '\n'

  if (node.nodeType === NODE_TYPES.text) {
    return `${indent}${escapeText(node.textContent.trim())}`
  }

  if (node.nodeType === NODE_TYPES.cdata) {
    return `${indent}<![CDATA[${node.textContent}]]>`
  }

  if (node.nodeType === NODE_TYPES.comment) {
    return `${indent}<!--${node.textContent}-->`
  }

  const attrs = formatAttributes(node, settings.sortAttributes)
  const structural = getStructuralChildren(node)
  const text = getTextContent(node)

  if (structural.length === 0) {
    if (!text) return `${indent}<${node.nodeName}${attrs}/>`

    return `${indent}<${node.nodeName}${attrs}>${escapeText(text)}</${node.nodeName}>`
  }

  if (text) {
    // 混合内容（文本与子元素交错）：整体保持一行并原样保留空白，避免重排改变语义
    return `${indent}<${node.nodeName}${attrs}>${serializeInlineChildren(node, settings)}</${node.nodeName}>`
  }

  if (structural.length === 1 && (structural[0].nodeType === NODE_TYPES.cdata || structural[0].nodeType === NODE_TYPES.comment)) {
    return `${indent}<${node.nodeName}${attrs}>${serializeInlineNode(structural[0], settings)}</${node.nodeName}>`
  }

  return [
    `${indent}<${node.nodeName}${attrs}>`,
    ...structural.map((child) => formatNode(child, settings, level + 1)),
    `${indent}</${node.nodeName}>`
  ].join(lineBreak)
}

export function formatXml (value, options) {
  const source = String(value || '').trim()

  if (!source) return ''

  const parsed = parseXml(source)
  if (parsed.error || !parsed.doc?.documentElement) return ''

  const settings = normalizeOptions(options)
  const declaration = source.match(/^<\?xml[^?]*\?>/)?.[0] || ''
  const doctype = formatDoctype(parsed.doc.doctype)
  const root = formatNode(parsed.doc.documentElement, settings, 0)

  return [declaration, doctype, root]
    .filter(Boolean)
    .join(settings.minify ? '' : '\n')
}

export function getStats (doc) {
  if (!doc?.documentElement) return { nodes: 0, attributes: 0 }

  const elements = Array.from(doc.getElementsByTagName('*'))

  return {
    nodes: elements.length,
    attributes: elements.reduce((total, node) => total + node.attributes.length, 0)
  }
}

export function getHistorySignature (value) {
  return formatXml(value) || String(value || '').trim()
}

export function getXmlTitle (value) {
  const parsed = parseXml(value)

  if (parsed.doc?.documentElement) {
    return `<${parsed.doc.documentElement.nodeName}>`
  }

  return String(value || '').trim().slice(0, 36) || 'XML 片段'
}

export function getSuggestedFileName (value) {
  const parsed = parseXml(value)
  const rootName = parsed.doc?.documentElement?.nodeName
  const base = rootName ? rootName.replace(/[^\p{L}\p{N}_.-]/gu, '_') : ''

  return `${base || 'output'}.xml`
}

function getNodeSearchText (node) {
  if (node.nodeType === NODE_TYPES.element) {
    const attrs = Array.from(node.attributes)
      .map((attr) => `${attr.name}="${attr.value}"`)
      .join(' ')
    const inlineText = isInlineElement(node)
      ? getTreeChildren(node)[0].textContent.trim()
      : ''

    return `${node.nodeName} ${attrs} ${inlineText}`.toLowerCase()
  }

  return node.textContent.toLowerCase()
}

export function collectMatches (node, query, path = '0', matches = new Set(), ancestors = new Set(), matchPaths = []) {
  if (!query) return { matches, ancestors, matchPaths }

  const lowerQuery = query.toLowerCase()

  if (getNodeSearchText(node).includes(lowerQuery)) {
    matches.add(path)
    matchPaths.push(path)
    path.split('.').slice(0, -1).forEach((part, index, parts) => {
      ancestors.add(parts.slice(0, index + 1).join('.'))
    })
  }

  if (isInlineElement(node)) {
    return { matches, ancestors, matchPaths }
  }

  getTreeChildren(node).forEach((child, index) => {
    collectMatches(child, query, `${path}.${index}`, matches, ancestors, matchPaths)
  })

  return { matches, ancestors, matchPaths }
}

function elementToJson (node) {
  const result = {}

  Array.from(node.attributes).forEach((attr) => {
    result[`@${attr.name}`] = attr.value
  })

  const elements = getStructuralChildren(node)
    .filter((child) => child.nodeType === NODE_TYPES.element)
  const text = getNodeText(node)

  if (elements.length === 0) {
    if (Object.keys(result).length === 0) return text
    if (text) result['#text'] = text

    return result
  }

  elements.forEach((child) => {
    const key = child.nodeName
    const value = elementToJson(child)

    if (key in result) {
      if (!Array.isArray(result[key])) result[key] = [result[key]]
      result[key].push(value)
    } else {
      result[key] = value
    }
  })

  if (text) result['#text'] = text

  return result
}

export function xmlToJson (value) {
  const parsed = parseXml(value)

  if (parsed.error) return { error: parsed.error, output: '' }
  if (!parsed.doc?.documentElement) return { error: '没有可转换的 XML 内容', output: '' }

  const root = parsed.doc.documentElement

  // 保留根标签名，这样 JSON → XML 能还原成同一份文档
  return {
    error: '',
    output: JSON.stringify({ [root.nodeName]: elementToJson(root) }, null, 2)
  }
}

function sanitizeName (name) {
  const cleaned = String(name).replace(/[^\p{L}\p{N}_.\-:]/gu, '_')
  if (!cleaned) return '_'

  return /^[\p{L}_]/u.test(cleaned) ? cleaned : `_${cleaned}`
}

function formatScalar (value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)

  return String(value)
}

function valueToXml (name, value) {
  const tag = sanitizeName(name)

  if (Array.isArray(value)) {
    // 数组 = 重复同名标签，与「同名节点合并为数组」互为逆运算
    return value.map((item) => valueToXml(tag, item)).join('')
  }

  if (value === null || value === undefined) return `<${tag}/>`

  if (typeof value !== 'object') return `<${tag}>${escapeText(formatScalar(value))}</${tag}>`

  let attrs = ''
  let text = ''
  const children = []

  Object.entries(value).forEach(([key, item]) => {
    if (key.startsWith('@')) {
      attrs += ` ${sanitizeName(key.slice(1))}="${escapeAttr(formatScalar(item))}"`
    } else if (key === '#text') {
      text = formatScalar(item)
    } else {
      children.push(valueToXml(key, item))
    }
  })

  if (children.length === 0) {
    return text ? `<${tag}${attrs}>${escapeText(text)}</${tag}>` : `<${tag}${attrs}/>`
  }

  return `<${tag}${attrs}>${text ? escapeText(text) : ''}${children.join('')}</${tag}>`
}

function buildRootElement (data) {
  if (Array.isArray(data)) {
    return `<root>${data.map((item) => valueToXml('item', item)).join('')}</root>`
  }

  if (data === null || typeof data !== 'object') {
    return `<root>${escapeText(formatScalar(data))}</root>`
  }

  const keys = Object.keys(data)
  const onlyKey = keys.length === 1 ? keys[0] : ''
  const usableKey = onlyKey && !onlyKey.startsWith('@') && onlyKey !== '#text'

  if (usableKey) {
    const xml = valueToXml(onlyKey, data[onlyKey])

    // 根值是数组时会产生多个根节点，包一层保证是合法文档
    return Array.isArray(data[onlyKey]) ? `<root>${xml}</root>` : xml
  }

  return valueToXml('root', data)
}

export function jsonToXml (value, options) {
  const source = String(value || '').trim()

  if (!source) return { error: '没有可转换的 JSON 内容', output: '' }

  let data

  try {
    data = JSON.parse(source)
  } catch (error) {
    return { error: `JSON 解析失败：${error.message}`, output: '' }
  }

  if (data === null || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return { error: 'JSON 内容为空，无法生成 XML', output: '' }
  }

  const output = formatXml(buildRootElement(data), options)

  if (!output) return { error: '生成的 XML 无法解析，请检查 JSON 字段名是否合法', output: '' }

  return { error: '', output }
}

/** 可直接执行的 XPath 使用 local-name + namespace-uri，避免依赖文档前缀。 */
export function getNodeXPath (node) {
  if (!node || node.nodeType === 9) return ''
  if (node.nodeType === 2) return `${getNodeXPath(node.ownerElement)}/@${xpathNameTest(node)}`
  const parent = getNodeXPath(node.parentNode)
  const test = node.nodeType === 1
    ? xpathNameTest(node)
    : node.nodeType === 8 ? 'comment()' : node.nodeType === 7 ? 'processing-instruction()' : 'text()'
  const siblings = Array.from(node.parentNode?.childNodes || []).filter((item) => (
    node.nodeType === 1
      ? item.nodeType === 1 && item.localName === node.localName && item.namespaceURI === node.namespaceURI
      : (node.nodeType === 3 || node.nodeType === 4) ? item.nodeType === 3 || item.nodeType === 4 : item.nodeType === node.nodeType
  ))
  return `${parent}/${test}[${siblings.indexOf(node) + 1}]`
}

function xpathNameTest (node) {
  // 某些浏览器的 XPath 引擎将无命名空间视为空值，使用 not() 兼容处理。
  const namespace = node.namespaceURI ? `namespace-uri()=${xpathLiteral(node.namespaceURI)}` : 'not(namespace-uri())'
  return `*[local-name()=${xpathLiteral(node.localName)} and ${namespace}]`
}

function xpathLiteral (value) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`
}

export function serializeXmlNode (node) {
  return node ? new window.XMLSerializer().serializeToString(node) : ''
}

export function getTreeNodeEntries (root) {
  const entries = []
  const walk = (node, path) => {
    entries.push({ node, path })
    if (!isInlineElement(node)) getTreeChildren(node).forEach((child, index) => walk(child, `${path}.${index}`))
  }
  if (root) walk(root, '0')
  return entries
}

export function getDocumentNamespaces (doc) {
  const namespaces = new Map()
  Array.from(doc?.getElementsByTagName('*') || []).forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (attr.name === 'xmlns') namespaces.set('default', attr.value)
      else if (attr.prefix === 'xmlns') namespaces.set(attr.localName, attr.value)
    })
  })
  return Array.from(namespaces, ([prefix, uri]) => `${prefix}=${uri}`).join('\n')
}

export function queryXPath (doc, expression, namespaceText = '') {
  if (!doc || !expression.trim()) return { error: '请输入 XPath 表达式', nodes: [], value: '' }
  try {
    const namespaces = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']])
    namespaceText.split('\n').filter((line) => line.trim()).forEach((line) => {
      const separator = line.indexOf('=')
      if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error('命名空间格式应为 prefix=URI，每行一项')
      namespaces.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
    })
    const result = doc.evaluate(expression, doc, (prefix) => namespaces.get(prefix) || null, window.XPathResult.ANY_TYPE, null)
    if (result.resultType === 1) return { error: '', nodes: [], value: String(result.numberValue), type: 'value' }
    if (result.resultType === 2) return { error: '', nodes: [], value: result.stringValue, type: 'value' }
    if (result.resultType === 3) return { error: '', nodes: [], value: String(result.booleanValue), type: 'value' }
    const nodes = []
    let node = result.iterateNext()
    while (node) {
      nodes.push(node)
      node = result.iterateNext()
    }
    return { error: '', nodes, value: '', type: 'nodes' }
  } catch (error) {
    return { error: `XPath 查询失败：${error.message}`, nodes: [], value: '' }
  }
}

/** 按子节点位置比较，保持顺序；仅忽略元素容器中的缩进空白。 */
export function compareXml (left, right, options = {}) {
  const before = parseXml(left)
  const after = parseXml(right)
  if (before.error || after.error || !before.doc || !after.doc) {
    return { error: before.error ? `左侧 XML：${before.error}` : after.error ? `右侧 XML：${after.error}` : '请在两侧输入有效 XML', differences: [] }
  }
  const differences = []
  const add = (type, path, oldValue, newValue) => differences.push({ type, path, before: oldValue, after: newValue })
  const children = (node) => {
    const all = Array.from(node.childNodes)
    let preserve = false
    for (let ancestor = node; ancestor?.nodeType === 1; ancestor = ancestor.parentNode) {
      const space = ancestor.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')
      if (space === 'preserve' || space === 'default') { preserve = space === 'preserve'; break }
    }
    const mixed = all.some((child) => child.nodeType === 3 && child.textContent.trim()) || all.some((child) => child.nodeType === 4)
    const container = node.nodeType === 9 || all.some((child) => child.nodeType === 1)
    return options.ignoreWhitespace && container && !preserve && !mixed
      ? all.filter((child) => child.nodeType !== 3 || child.textContent.trim())
      : all
  }
  const walk = (a, b, path) => {
    if (!a || !b) {
      add(a ? '删除' : '新增', path, serializeXmlNode(a), serializeXmlNode(b))
      return
    }
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || a.namespaceURI !== b.namespaceURI) {
      add('节点变化', path, serializeXmlNode(a), serializeXmlNode(b))
      return
    }
    if (a.nodeType !== 1 && a.nodeType !== 9) {
      if (serializeXmlNode(a) !== serializeXmlNode(b)) add('内容变化', path, serializeXmlNode(a), serializeXmlNode(b))
      return
    }
    if (a.nodeType === 1) {
      const attrsA = Array.from(a.attributes)
      const attrsB = Array.from(b.attributes)
      const names = new Set([...attrsA, ...attrsB].map((attr) => attr.name))
      names.forEach((name) => {
        if (a.getAttribute(name) !== b.getAttribute(name)) add('属性变化', `${path}/@${name}`, a.getAttribute(name) ?? '（不存在）', b.getAttribute(name) ?? '（不存在）')
      })
      if (!options.ignoreAttributeOrder && attrsA.length === attrsB.length && attrsA.every((attr) => b.hasAttribute(attr.name)) && attrsA.map((attr) => attr.name).join(' ') !== attrsB.map((attr) => attr.name).join(' ')) {
        add('属性顺序', path, attrsA.map((attr) => attr.name).join(' '), attrsB.map((attr) => attr.name).join(' '))
      }
    }
    const ca = children(a)
    const cb = children(b)
    const childPaths = (nodes) => {
      const counts = new Map()
      return nodes.map((node) => {
        const name = node.nodeType === 3 || node.nodeType === 4 ? 'text()' : node.nodeType === 8 ? 'comment()' : node.nodeType === 7 ? 'processing-instruction()' : node.nodeName
        const count = (counts.get(name) || 0) + 1
        counts.set(name, count)
        return `${path}/${name}[${count}]`
      })
    }
    const pathsA = childPaths(ca)
    const pathsB = childPaths(cb)
    for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
      walk(ca[i], cb[i], pathsA[i] || pathsB[i])
    }
  }
  walk(before.doc, after.doc, '')
  return { error: '', differences }
}
