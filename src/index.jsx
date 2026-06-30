import { h, render } from 'preact'
import { useState, useCallback, useRef, useEffect } from 'preact/hooks'

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function stripHtml(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}

function cloneTree(nodes) {
  return JSON.parse(JSON.stringify(nodes))
}

// Walk tree and apply fn(node, parent, index) — returns new tree (immutable)
function mapTree(nodes, fn, parent = null) {
  return nodes.map((node, i) => {
    const updated = fn({ ...node }, parent, i)
    if (updated.children && updated.children.length) {
      updated.children = mapTree(updated.children, fn, updated)
    }
    return updated
  })
}

// Flatten tree to [{ node, parent, index, siblings }] in DFS order
function flatten(nodes, parent = null, siblings = null) {
  const result = []
  const s = siblings || nodes
  nodes.forEach((node, i) => {
    result.push({ node, parent, index: i, siblings: s })
    if (node.children && node.children.length) {
      result.push(...flatten(node.children, node, node.children))
    }
  })
  return result
}

// Find a node by id anywhere in the tree
function findNode(nodes, id) {
  for (const { node, parent, index, siblings } of flatten(nodes)) {
    if (node.id === id) return { node, parent, index, siblings }
  }
  return null
}

// ─── Tree mutation helpers ───────────────────────────────────────────────────

function updateNodeText(nodes, id, text) {
  return mapTree(nodes, node => node.id === id ? { ...node, text } : node)
}

function deleteNode(nodes, id) {
  const recurse = (arr) =>
    arr.filter(n => n.id !== id).map(n => ({
      ...n,
      children: n.children ? recurse(n.children) : []
    }))
  return recurse(nodes)
}

function insertAfter(nodes, afterId, newNode) {
  const recurse = (arr) => {
    const out = []
    for (const n of arr) {
      out.push({ ...n, children: n.children ? recurse(n.children) : [] })
      if (n.id === afterId) out.push(newNode)
    }
    return out
  }
  return recurse(nodes)
}

// Make node a child of its previous sibling
function indentNode(nodes, id) {
  const recurse = (arr) => {
    const out = []
    for (let i = 0; i < arr.length; i++) {
      const n = { ...arr[i], children: arr[i].children ? recurse(arr[i].children) : [] }
      if (arr[i].id === id && i > 0) {
        // attach to previous sibling's children
        const prev = out[out.length - 1]
        out[out.length - 1] = {
          ...prev,
          children: [...(prev.children || []), n]
        }
      } else {
        out.push(n)
      }
    }
    return out
  }
  return recurse(nodes)
}

// Lift node out to parent's level (after parent)
function outdentNode(nodes, id, rootNodes) {
  let targetNode = null
  let targetParentId = null

  const removeFromParent = (arr, parentId) => {
    return arr.map(n => {
      const children = n.children || []
      const idx = children.findIndex(c => c.id === id)
      if (idx !== -1) {
        targetNode = children[idx]
        targetParentId = n.id
        return { ...n, children: [...children.slice(0, idx), ...children.slice(idx + 1)] }
      }
      return { ...n, children: removeFromParent(children, n.id) }
    })
  }

  let updated = removeFromParent(nodes)
  if (!targetNode) return nodes

  // Insert after targetParentId at the parent's parent level
  const insertAfterParent = (arr) => {
    const out = []
    for (const n of arr) {
      out.push({ ...n, children: n.children ? insertAfterParent(n.children) : [] })
      if (n.id === targetParentId) out.push(targetNode)
    }
    return out
  }

  return insertAfterParent(updated)
}

function moveNode(nodes, id, direction) {
  const recurse = (arr) => {
    const idx = arr.findIndex(n => n.id === id)
    if (idx !== -1) {
      const out = arr.map(n => ({ ...n, children: n.children ? recurse(n.children) : [] }))
      if (direction === 'up' && idx > 0) {
        ;[out[idx - 1], out[idx]] = [out[idx], out[idx - 1]]
      } else if (direction === 'down' && idx < out.length - 1) {
        ;[out[idx], out[idx + 1]] = [out[idx + 1], out[idx]]
      }
      return out
    }
    return arr.map(n => ({ ...n, children: n.children ? recurse(n.children) : [] }))
  }
  return recurse(nodes)
}

function toggleExpand(expanded, id) {
  const current = expanded[id] !== false
  return { ...expanded, [id]: !current }
}

// ─── Single node component ───────────────────────────────────────────────────

function Node({ node, depth, expanded, onToggle, onSelect, onEdit, selectedId, editingId,
                editRef, rowRef, onEditKeyDown, onRowKeyDown, onSave, readOnly }) {
  const isExpanded = expanded[node.id] !== false
  const hasChildren = node.children && node.children.length > 0
  const isEditing = editingId === node.id
  const isSelected = selectedId === node.id && !isEditing

  return (
    <div class="rcn-node" style={{ marginLeft: depth * 18 + 'px' }}>
      <div
        class={'rcn-node-row' + (isSelected ? ' rcn-node-selected' : '')}
        tabIndex={isSelected ? 0 : -1}
        ref={isSelected ? rowRef : null}
        onClick={e => { e.stopPropagation(); onSelect(node.id) }}
        onDblClick={e => { e.stopPropagation(); !readOnly && onEdit(node.id) }}
        onKeyDown={e => !readOnly && onRowKeyDown(e, node)}
      >
        <span
          class={'rcn-toggle' + (hasChildren ? '' : ' rcn-toggle-leaf')}
          onClick={e => { e.stopPropagation(); hasChildren && onToggle(node.id) }}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
        </span>

        {isEditing ? (
          <span
            ref={editRef}
            class="rcn-node-edit"
            contenteditable
            dangerouslySetInnerHTML={{ __html: node.text }}
            onKeyDown={e => onEditKeyDown(e, node)}
            onBlur={() => onSave(node.id, editRef.current ? editRef.current.innerHTML : node.text)}
          />
        ) : (
          <span
            class="rcn-node-text"
            dangerouslySetInnerHTML={{ __html: node.text || '<em style="color:#aaa">empty</em>' }}
          />
        )}
      </div>

      {hasChildren && isExpanded && (
        <div class="rcn-children">
          {node.children.map(child => (
            <Node
              key={child.id}
              node={child}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onEdit={onEdit}
              selectedId={selectedId}
              editingId={editingId}
              editRef={editRef}
              rowRef={rowRef}
              onEditKeyDown={onEditKeyDown}
              onRowKeyDown={onRowKeyDown}
              onSave={onSave}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main plugin component ───────────────────────────────────────────────────

const PROXY = 'http://localhost:8765'
const MORE_URL = PROXY + '/tools/more-outliner.html'
const WINDOW_NAME = 'rcn-outliner'

// Ensure all nodes have cloneId: null so MORE doesn't flag them as clones
function normalizeOutline(nodes) {
  return (nodes || []).map(n => ({
    cloneId: null,
    comment: '',
    ...n,
    children: normalizeOutline(n.children)
  }))
}

function OutlinerPlugin({ item, pageSlug }) {
  const [outline, setOutline] = useState(() => normalizeOutline(item.outline))
  const [title, setTitle] = useState(() => item.outlineTitle || '')
  const [expanded, setExpanded] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [focusTick, setFocusTick] = useState(0)
  const [dirty, setDirty] = useState(false)
  const editRef = useRef(null)
  const rowRef = useRef(null)
  const containerRef = useRef(null)
  const saveTimer = useRef(null)

  // Refs so window-level capture handler can see current state without stale closure
  const outlineRef = useRef(outline)
  const editingIdRef = useRef(editingId)
  const selectedIdRef = useRef(selectedId)
  const updateRef = useRef(null) // set after update is defined below

  useEffect(() => { outlineRef.current = outline }, [outline])
  useEffect(() => { editingIdRef.current = editingId }, [editingId])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // Focus selected row when selectedId changes (and not editing)
  useEffect(() => {
    if (selectedId && !editingId && rowRef.current) {
      rowRef.current.focus()
    }
  }, [selectedId, editingId])

  // Focus edit span whenever editingId changes OR focusTick increments
  useEffect(() => {
    if (editingId && editRef.current) {
      const el = editRef.current
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      if (sel) { sel.removeAllRanges(); sel.addRange(range) }
    }
  }, [editingId, focusTick])

  // Debounced save to disk
  const persist = useCallback((newOutline, newTitle) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch(PROXY + '/api/wiki-save-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: 'localhost',
          slug: pageSlug,
          id: item.id,
          updates: { outline: newOutline, outlineTitle: newTitle }
        })
      }).catch(e => console.warn('[rcn-outliner] save failed:', e))
    }, 600)
  }, [pageSlug, item.id])

  const update = useCallback((newOutline, newTitle) => {
    const t = newTitle !== undefined ? newTitle : title
    setOutline(newOutline)
    item.outline = newOutline
    item.outlineTitle = t
    setDirty(true)
    persist(newOutline, t)
  }, [title, persist, item])

  // Keep updateRef current so the window capture handler can call it
  useEffect(() => { updateRef.current = update }, [update])

  // Window-level capture handler: intercept Tab before browser moves focus.
  // Handles Tab from BOTH edit mode (rcn-node-edit) and selected mode (rcn-node-row).
  useEffect(() => {
    const onCapture = (e) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      const inEdit = active && active.classList.contains('rcn-node-edit')
      const inRow = active && active.classList.contains('rcn-node-row')
      // Also handle Tab when a node is selected but focus drifted to another element
      // inside the plugin (timing gap between click and useEffect focusing the row)
      const inPlugin = containerRef.current && containerRef.current.contains(active)
      const hasSelected = !!selectedIdRef.current && !editingIdRef.current && inPlugin
      if (!inEdit && !inRow && !hasSelected) return

      e.preventDefault()
      e.stopImmediatePropagation()

      const nodeId = inEdit ? editingIdRef.current : selectedIdRef.current
      if (!nodeId) return
      const currentOutline = outlineRef.current
      const html = inEdit ? active.innerHTML : null
      const saved = html !== null ? updateNodeText(currentOutline, nodeId, html) : currentOutline
      const newOutline = e.shiftKey ? outdentNode(saved, nodeId) : indentNode(saved, nodeId)
      updateRef.current(newOutline)
      if (inEdit) {
        setEditingId(nodeId)
        setFocusTick(t => t + 1)
      } else {
        setSelectedId(nodeId)
        setFocusTick(t => t + 1)
      }
    }
    window.addEventListener('keydown', onCapture, { capture: true })
    return () => window.removeEventListener('keydown', onCapture, { capture: true })
  }, []) // empty deps — all state accessed via refs

  const handleToggle = useCallback(id => {
    setExpanded(prev => toggleExpand(prev, id))
  }, [])

  const handleSelect = useCallback(id => {
    if (editingId) return // don't change selection while editing
    setSelectedId(id)
  }, [editingId])

  const handleEdit = useCallback(id => {
    setSelectedId(id)
    setEditingId(id)
  }, [])

  // Keys that work when a row is selected (not in edit mode)
  const handleRowKeyDown = useCallback((e, node) => {
    // Tab handled by window capture — skip
    if (e.key === 'Tab') return
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter from selected: add sibling below
      const newNode = { id: uid(), text: '', cloneId: null, comment: '', children: [] }
      const newOutline = insertAfter(outline, node.id, newNode)
      setSelectedId(newNode.id)
      setEditingId(newNode.id)
      update(newOutline)
    } else if (e.key === 'Delete' || (e.key === 'Backspace')) {
      e.preventDefault()
      const flat = flatten(outline)
      const idx = flat.findIndex(f => f.node.id === node.id)
      const prevId = idx > 0 ? flat[idx - 1].node.id : null
      const newOutline = deleteNode(outline, node.id)
      setSelectedId(prevId)
      setEditingId(null)
      update(newOutline)
    } else if (e.key === 'F2') {
      e.preventDefault()
      handleEdit(node.id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const flat = flatten(outline)
      const idx = flat.findIndex(f => f.node.id === node.id)
      if (idx > 0) setSelectedId(flat[idx - 1].node.id)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const flat = flatten(outline)
      const idx = flat.findIndex(f => f.node.id === node.id)
      if (idx < flat.length - 1) setSelectedId(flat[idx + 1].node.id)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // Printable character: jump into edit mode, start with that character
      e.preventDefault()
      setEditingId(node.id)
      // Set text to just this character after re-render (via a brief timeout)
      setTimeout(() => {
        if (editRef.current) {
          editRef.current.textContent = e.key
          editRef.current.focus()
          const range = document.createRange()
          range.selectNodeContents(editRef.current)
          range.collapse(false)
          const sel = window.getSelection()
          if (sel) { sel.removeAllRanges(); sel.addRange(range) }
        }
      }, 0)
    }
  }, [outline, update, handleEdit])

  const handleSave = useCallback((id, html) => {
    const newOutline = updateNodeText(outline, id, html)
    setEditingId(null)
    setSelectedId(id) // stay selected after saving
    update(newOutline)
  }, [outline, update])

  const handleKeyDown = useCallback((e, node) => {
    // Tab is handled by the window capture handler above — skip it here
    if (e.key === 'Tab') return
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const html = editRef.current ? editRef.current.innerHTML : node.text
      const saved = updateNodeText(outline, node.id, html)
      const newNode = { id: uid(), text: '', cloneId: null, comment: '', children: [] }
      const newOutline = insertAfter(saved, node.id, newNode)
      setEditingId(newNode.id)
      update(newOutline)
    } else if (e.key === 'Backspace') {
      const content = editRef.current ? editRef.current.textContent : ''
      if (content === '') {
        e.preventDefault()
        const flat = flatten(outline)
        const idx = flat.findIndex(f => f.node.id === node.id)
        const prevId = idx > 0 ? flat[idx - 1].node.id : null
        const newOutline = deleteNode(outline, node.id)
        setEditingId(prevId)
        update(newOutline)
      }
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setSelectedId(node.id) // back to selected
    }
  }, [outline, update])

  const handleAddRoot = useCallback(() => {
    const newNode = { id: uid(), text: '', cloneId: null, comment: '', children: [] }
    const newOutline = [...outline, newNode]
    setEditingId(newNode.id)
    update(newOutline)
  }, [outline, update])

  // Listen for round-trip from MORE popup
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || event.data.toolType !== 'rcn-outliner') return
      if (event.data.action === 'saveOutline') {
        const newOutline = event.data.outline || []
        const newTitle = event.data.title || ''
        setOutline(newOutline)
        setTitle(newTitle)
        item.outline = newOutline
        item.outlineTitle = newTitle
        persist(newOutline, newTitle)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [item, persist])

  const openInMore = useCallback(() => {
    const popup = window.open(MORE_URL, WINDOW_NAME, 'popup,height=820,width=1440')
    if (popup) popup.focus()
    // MORE will fire outlinerReady; the global listener in the old plugin handled this.
    // We expose pendingItem on the window so the global listener can find it.
    window._rcnOutlinerPending = { item, $item: null }
  }, [item])

  const isEmpty = !outline || outline.length === 0

  return (
    <div class="rcn-outliner-root" ref={containerRef}>
      <div class="rcn-outliner-toolbar">
        <span class="rcn-outliner-title">{title || 'Outline'}</span>
        <button class="rcn-tb-btn" onClick={openInMore} title="Open full MORE Outliner">MORE ↗</button>
      </div>

      {isEmpty ? (
        <div class="rcn-outliner-empty">
          <p>No outline yet.</p>
          <button class="rcn-tb-btn" onClick={handleAddRoot}>+ Add first item</button>
        </div>
      ) : (
        <div class="rcn-outliner-tree">
          {outline.map(node => (
            <Node
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onEdit={handleEdit}
              selectedId={selectedId}
              editingId={editingId}
              editRef={editRef}
              rowRef={rowRef}
              onEditKeyDown={handleKeyDown}
              onRowKeyDown={handleRowKeyDown}
              onSave={handleSave}
              readOnly={false}
            />
          ))}
        </div>
      )}

      <div class="rcn-outliner-footer">
        <button class="rcn-tb-btn" onClick={handleAddRoot}>+ Root</button>
        {dirty && <span class="rcn-saved-badge">✓</span>}
      </div>
    </div>
  )
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
.rcn-outliner-root {
  font-family: system-ui, sans-serif;
  font-size: 13px;
  padding: 24px 6px 6px;
  background: #f9f9f9;
  border-top: 2px solid #c8d8e0;
  min-height: 60px;
}
.rcn-outliner-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.rcn-outliner-title {
  flex: 1;
  font-weight: bold;
  font-size: 12px;
  color: #444;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rcn-tb-btn {
  font-size: 11px;
  padding: 2px 7px;
  border: 1px solid #bbb;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.rcn-tb-btn:hover { background: #e8f0fe; border-color: #6090c8; }
.rcn-outliner-empty {
  text-align: center;
  color: #888;
  padding: 10px 0;
}
.rcn-outliner-tree {
  padding: 2px 0;
}
.rcn-node { line-height: 1.6; }
.rcn-node-row {
  display: flex;
  align-items: baseline;
  gap: 3px;
  padding: 1px 0;
}
.rcn-toggle {
  cursor: pointer;
  user-select: none;
  color: #888;
  font-size: 11px;
  min-width: 14px;
  flex-shrink: 0;
}
.rcn-toggle-leaf { cursor: default; color: #ccc; }
.rcn-node-row:focus { outline: none; }
.rcn-node-selected { background: rgba(100,150,220,0.15); border-radius: 3px; }
.rcn-node-text {
  flex: 1;
  cursor: text;
  word-break: break-word;
}
.rcn-node-text:hover { background: rgba(100,150,220,0.07); border-radius: 2px; }
.rcn-node-edit {
  flex: 1;
  outline: none;
  background: #fff;
  border: 1px solid #6090c8;
  border-radius: 3px;
  padding: 0 3px;
  min-width: 40px;
  word-break: break-word;
}
.rcn-children { margin-left: 14px; border-left: 1px solid #e0e0e0; padding-left: 4px; }
.rcn-outliner-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #e0e0e0;
}
.rcn-saved-badge { font-size: 11px; color: #4a9; }
`

// ─── Plugin API ───────────────────────────────────────────────────────────────

let styleInjected = false
function injectStyle() {
  if (styleInjected) return
  styleInjected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

function getPageSlug($item) {
  try {
    return $item.parents('.page').data('key') || ''
  } catch (e) {
    return ''
  }
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  const outlinerPlugin = {
    emit($item, item) {
      injectStyle()
      const container = document.createElement('div')
      $item[0].appendChild(container)
      render(
        <OutlinerPlugin item={item} pageSlug={getPageSlug($item)} />,
        container
      )
    },
    bind($item, item) {
      $item.on('click', e => e.stopPropagation())
      $item.on('dblclick', e => e.stopPropagation())
      // Stop Tab/Enter/Backspace from reaching FedWiki's document-level handlers
      $item.on('keydown', e => {
        if ($item.find('.rcn-node-edit').length > 0) e.stopPropagation()
      })
    }
  }
  window.plugins['rcnoutliner'] = outlinerPlugin
  window.plugins['rcn-outliner'] = outlinerPlugin

  // Global message handler: outlinerReady handshake + showResult (→ Wiki Ghost)
  if (!window.rcnOutlinerListener) {
    window.rcnOutlinerListener = true
    window.addEventListener('message', event => {
      if (!event.data || event.data.toolType !== 'rcn-outliner') return
      const data = event.data
      if (data.action === 'outlinerReady') {
        const pending = window._rcnOutlinerPending
        if (pending && pending.item && pending.item.outline) {
          event.source.postMessage({
            action: 'loadOutline',
            outline: pending.item.outline,
            title: pending.item.outlineTitle || ''
          }, '*')
        }
      } else if (data.action === 'showResult') {
        wiki.showResult(wiki.newPage(data.page), { $page: data.keepLineup ? null : undefined })
      }
    })
  }
}
