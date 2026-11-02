// Minimal Chrome DevTools Protocol driver for the Electron app (test harness only).
// Launches the built app (out/) with COS_DATA_DIR pointing at a throwaway folder and
// backups redirected into it, so real data and OneDrive backups are never touched.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ appDir, dataDir, port = 9333, fresh = true, packagedExe = null }) {
  if (fresh) rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  // Keep test backups out of the real OneDrive folder.
  if (fresh) writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ backupFolder: join(dataDir, 'backups') }))
  // The electron package exports the path to its binary (any OS).
  const exe = createRequire(join(appDir, 'package.json'))('electron')
  const proc = spawn(packagedExe ?? exe, [...(packagedExe ? [] : [appDir]), `--remote-debugging-port=${port}`], { env: { ...process.env, COS_DATA_DIR: dataDir }, stdio: 'ignore' })
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('No page target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id
      pending.set(n, r)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')

  const api = {
    proc,
    errors,
    sleep,
    async eval(expr) {
      const res = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
      if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? 'eval failed')
      return res.result?.result?.value
    },
    async waitFor(selector, ms = 8000) {
      for (let t = 0; t < ms; t += 100) {
        if (await api.eval(`return !!document.querySelector(${JSON.stringify(selector)})`)) return
        await sleep(100)
      }
      throw new Error(`Timed out waiting for ${selector}`)
    },
    async click(selector) {
      const box = await api.eval(`const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}`)
      if (!box) throw new Error(`No element ${selector}`)
      await api.mouse(box.x, box.y)
    },
    async clickText(text, scope = 'button, .r, .pi, .tab, .pill, .card') {
      const box = await api.eval(`const e = [...document.querySelectorAll(${JSON.stringify(scope)})].find(x => x.textContent.trim().includes(${JSON.stringify(text)})); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}`)
      if (!box) throw new Error(`No element with text ${text}`)
      await api.mouse(box.x, box.y)
    },
    async mouse(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      await sleep(150)
    },
    async drag(x1, y1, x2, y2) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 10; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, button: 'left', buttons: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
      await sleep(200)
    },
    async type(text) {
      await send('Input.insertText', { text })
      await sleep(80)
    },
    async key(key, { ctrl = false, shift = false, alt = false } = {}) {
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0)
      const named = { Enter: [13, '\r'], Escape: [27, ''], ArrowDown: [40, ''], ArrowUp: [38, ''], ArrowLeft: [37, ''], ArrowRight: [39, ''], Tab: [9, ''] }
      const [code, text] = named[key] ?? [key.toUpperCase().charCodeAt(0), shift ? key.toUpperCase() : key]
      const base = { key, windowsVirtualKeyCode: code, modifiers }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: ctrl || alt ? undefined : text || undefined })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      await sleep(150)
    },
    async screenshot(file) {
      const res = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(res.result.data, 'base64'))
    },
    async setTitleInput(selector, value) {
      await api.click(selector)
      await api.key('a', { ctrl: true })
      await api.type(value)
    },
    async close() {
      ws.close()
      proc.kill()
      await sleep(500)
    },
  }
  await api.waitFor('.top')
  return api
}
