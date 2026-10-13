import { useMemo, useState } from 'react'
import CodeEditor from './CodeEditor.jsx'
import { compareXml, parseXml } from './xml.js'

function displayDifference (value) {
  if (!value) return '（空）'
  return /^\s+$/.test(value) ? value.replace(/ /g, '·').replace(/\t/g, '⇥').replace(/\r/g, '␍').replace(/\n/g, '↵\n') : value
}

export default function XmlCompare ({ source, active }) {
  const [target, setTarget] = useState('')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true)
  const [ignoreAttributeOrder, setIgnoreAttributeOrder] = useState(true)
  const [running, setRunning] = useState(false)
  const result = useMemo(() => running && active ? compareXml(source, target, { ignoreWhitespace, ignoreAttributeOrder }) : null, [source, target, ignoreWhitespace, ignoreAttributeOrder, running, active])
  const parsed = useMemo(() => parseXml(target), [target])
  return (
    <section className='compare-panel'>
      <div className='compare-tools'>
        <strong>左侧输入为原文，在下面输入对比 XML</strong>
        <button className='ghost-button' onClick={() => setTarget(source)}>从左侧复制</button>
        <button onClick={() => setRunning(true)}>对比</button>
        <label><input type='checkbox' checked={ignoreWhitespace} onChange={(event) => setIgnoreWhitespace(event.target.checked)} />忽略缩进空白</label>
        <label><input type='checkbox' checked={ignoreAttributeOrder} onChange={(event) => setIgnoreAttributeOrder(event.target.checked)} />忽略属性顺序</label>
        <span>子节点按位置比较，保留顺序；混合内容及 xml:space 空白保留</span>
      </div>
      <div className='compare-editor'><CodeEditor value={target} onChange={setTarget} label='对比 XML 输入' errorLine={parsed.errorLine} errorColumn={parsed.errorColumn} /></div>
      <div className='diff-results'>
        {result?.error && <div className='error-box'>{result.error}</div>}
        {result && !result.error && (
          <>
            <div className='result-summary' role='status'>{result.differences.length ? `${result.differences.length} 处差异` : '两份 XML 在当前选项下相同'}</div>
            {result.differences.length > 0 && (
              <table className='diff-table'>
                <thead><tr><th>位置 / 类型</th><th>原文</th><th>对比内容</th></tr></thead>
                <tbody>{result.differences.map((item, index) => (
                  <tr key={index}><td><strong>{item.type}</strong><code>{item.path}</code></td><td className='diff-before'><pre>{displayDifference(item.before)}</pre></td><td className='diff-after'><pre>{displayDifference(item.after)}</pre></td></tr>
                ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {!result && <div className='empty-box'>粘贴第二份 XML 后点击“对比”，查看节点、属性和文本差异</div>}
      </div>
    </section>
  )
}
