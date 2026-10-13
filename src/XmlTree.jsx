import {
  NODE_TYPES,
  canCollapseNode,
  getTreeChildren,
  isElementNode,
  isInlineElement
} from './xml.js'

function highlight (value, query) {
  if (!query) return value

  const index = value.toLowerCase().indexOf(query.toLowerCase())

  if (index === -1) return value

  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  )
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

function XmlNode ({ node, path, collapsed, matches, activeMatchPath, expandedBySearch, query, onToggle }) {
  const children = getTreeChildren(node)
  const canCollapse = canCollapseNode(node)
  const isCollapsed = collapsed.has(path) && !expandedBySearch.has(path)
  const isMatched = matches.has(path)
  const isActiveMatch = path === activeMatchPath
  const rowClassName = `xml-row xml-leaf ${isMatched ? 'is-match' : ''} ${isActiveMatch ? 'is-active-match' : ''}`

  if (!isElementNode(node)) {
    const prefix = node.nodeType === NODE_TYPES.cdata
      ? '<![CDATA['
      : node.nodeType === NODE_TYPES.comment ? '<!--' : ''
    const suffix = node.nodeType === NODE_TYPES.cdata
      ? ']]>'
      : node.nodeType === NODE_TYPES.comment ? '-->' : ''

    return (
      <div className={rowClassName} data-node-path={path}>
        <span className='xml-spacer' />
        <span className='xml-text'>{prefix}{highlight(node.textContent.trim(), query)}{suffix}</span>
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className={rowClassName} data-node-path={path}>
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
      <div className={rowClassName} data-node-path={path}>
        <span className='xml-spacer' />
        <XmlElementName node={node} query={query} />
        <span className='xml-text'>{highlight(children[0].textContent.trim(), query)}</span>
        <span className='xml-tag'>&lt;/{highlight(node.nodeName, query)}&gt;</span>
      </div>
    )
  }

  return (
    <div className={`xml-node ${isMatched ? 'is-match' : ''}`}>
      <div className={`xml-row ${isActiveMatch ? 'is-active-match' : ''}`} data-node-path={path}>
        <button
          type='button'
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
                activeMatchPath={activeMatchPath}
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

export default function XmlTree ({ root, collapsed, matches, activeMatchPath, expandedBySearch, query, onToggle }) {
  return (
    <div className='xml-tree'>
      <XmlNode
        node={root}
        path='0'
        collapsed={collapsed}
        matches={matches}
        activeMatchPath={activeMatchPath}
        expandedBySearch={expandedBySearch}
        query={query}
        onToggle={onToggle}
      />
    </div>
  )
}
