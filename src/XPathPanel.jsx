import { useMemo, useState } from 'react'
import { getDocumentNamespaces, getNodeXPath, queryXPath, serializeXmlNode } from './xml.js'

export default function XPathPanel ({ doc, onLocate, onCopy }) {
  const [expression, setExpression] = useState('//book')
  const [executed, setExecuted] = useState(null)
  const [namespaceOverride, setNamespaceOverride] = useState(null)
  const namespaces = namespaceOverride ?? getDocumentNamespaces(doc)
  const result = useMemo(() => executed !== null ? queryXPath(doc, executed, namespaces) : null, [doc, executed, namespaces])
  const run = (event) => { event.preventDefault(); setExecuted(expression) }
  return (
    <section className='xpath-panel'>
      <form className='query-form' onSubmit={run}>
        <input aria-label='XPath 表达式' value={expression} onChange={(event) => setExpression(event.target.value)} placeholder='例如 //order[@id="123"] 或 count(//order)' />
        <button disabled={!doc}>查询</button>
      </form>
      <details className='namespace-settings'>
        <summary>命名空间设置</summary>
        <p>每行 prefix=URI。默认命名空间使用 default 前缀，例如 //default:order。相同前缀有不同声明时，请在此指定所需 URI。</p>
        <textarea aria-label='XPath 命名空间' value={namespaces} onChange={(event) => setNamespaceOverride(event.target.value)} placeholder='default=https://example.com/orders' />
        <button className='ghost-button' onClick={() => setNamespaceOverride(null)}>从 XML 重新读取</button>
      </details>
      {!doc && <div className='empty-box'>请先在左侧输入有效 XML</div>}
      {result?.error && <div className='error-box'>{result.error}</div>}
      {result && !result.error && (
        <>
          <div className='result-summary' role='status'>{result.type === 'value' ? `查询值：${result.value === '' ? '（空字符串）' : result.value}` : `${result.nodes.length} 个匹配节点`}</div>
          {result.type === 'value' && <button className='ghost-button scalar-copy' onClick={() => onCopy(result.value)}>复制查询值</button>}
          <ol className='xpath-results'>
            {result.nodes.map((node, index) => (
              <li key={index}>
                <code>{getNodeXPath(node) || '/'}</code>
                <pre>{node.nodeType === 2 ? node.value : serializeXmlNode(node)}</pre>
                <div className='result-actions'>
                  <button className='ghost-button' onClick={() => onLocate(node)}>定位树节点</button>
                  <button className='ghost-button' onClick={() => onCopy(node.nodeType === 2 ? node.value : serializeXmlNode(node))}>复制结果</button>
                  <button className='ghost-button' onClick={() => onCopy(getNodeXPath(node) || '/')}>复制 XPath</button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {!result && doc && <div className='empty-box'>支持 XPath 1.0：元素、属性、文本，以及 count()、string()、boolean() 等表达式</div>}
    </section>
  )
}
