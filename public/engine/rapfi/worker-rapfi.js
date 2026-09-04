/* Rapfi WebAssembly worker bridge.
 *
 * This file is application glue. The adjacent rapfi.js, rapfi.wasm and
 * rapfi.data files are GPL-3.0-covered third-party artifacts; see SOURCE.md
 * and COPYING. The message protocol implemented here mirrors the types in
 * src/engine/rapfi/protocol.ts.
 *
 * The Emscripten preamble exposes Module.sendCommand (which pushes a command
 * into the stdin queue and runs one gomocupLoopOnce) plus the stdout/stderr
 * callbacks. Because the single-threaded build executes each command
 * synchronously, a move request is complete when sendCommand returns; the
 * reply is the last bare "x,y" line written to stdout.
 */
'use strict'

var MOVE_LINE_PATTERN = /^\s*-?\d+,\s*-?\d+\s*$/
var ABOUT_LINE_PATTERN = /name="Rapfi"/
var MAX_STDOUT_LINES = 2000

var engineRoot = new URL('.', self.location.href)
var modulePromise = null
var module = null
var stdoutLines = []
var exited = false

function post(message) {
  self.postMessage(message)
}

// The Emscripten build emits rapfi-single-simd128.* names; the shipped
// artifacts are renamed to rapfi.*, so every side file is remapped here.
function locateFile(path) {
  return new URL(path.replace('rapfi-single-simd128', 'rapfi'), engineRoot).href
}

function recordStdout(line) {
  stdoutLines.push(String(line))
  if (stdoutLines.length > MAX_STDOUT_LINES) {
    stdoutLines.splice(0, stdoutLines.length - MAX_STDOUT_LINES)
  }
}

function findMoveLine(lines) {
  for (var i = lines.length - 1; i >= 0; i -= 1) {
    var line = lines[i].trim()
    if (MOVE_LINE_PATTERN.test(line)) return line
  }
  return null
}

function versionFromAbout(line) {
  var match = /version="([^"]*)"/.exec(line)
  return match ? match[1] : 'unknown'
}

function loadModule() {
  if (modulePromise) return modulePromise

  modulePromise = new Promise(function (resolve, reject) {
    var Module = {
      locateFile: locateFile,
      onReceiveStdout: recordStdout,
      onReceiveStderr: function (line) {
        post({ type: 'log', text: String(line) })
      },
      onAbort: function (reason) {
        exited = true
        post({ type: 'log', text: 'Rapfi 中止：' + String(reason) })
      },
      onExit: function (code) {
        exited = true
        post({ type: 'log', text: 'Rapfi 已退出，退出码 ' + code })
      },
    }

    try {
      self.importScripts(new URL('rapfi.js', engineRoot).href)
    } catch (error) {
      reject(error)
      return
    }

    globalThis.Rapfi(Module).then(
      function (loaded) {
        module = loaded
        resolve(loaded)
      },
      function (error) {
        reject(error)
      },
    )
  })

  return modulePromise
}

function boot() {
  loadModule().then(
    function () {
      var start = stdoutLines.length
      module.sendCommand('ABOUT')
      for (var i = start; i < stdoutLines.length; i += 1) {
        if (ABOUT_LINE_PATTERN.test(stdoutLines[i])) {
          post({ type: 'ready', version: versionFromAbout(stdoutLines[i]) })
          return
        }
      }
      post({ type: 'boot-error', error: 'Rapfi 没有回应 ABOUT' })
    },
    function (error) {
      post({ type: 'boot-error', error: String(error) })
    },
  )
}

self.onmessage = function (event) {
  var request = event.data
  if (!request || typeof request !== 'object') return

  if (request.type === 'init') {
    if (!modulePromise) boot()
    return
  }

  if (request.type !== 'move') return

  var response = { type: 'response', id: request.id, ok: false }

  if (!module || exited) {
    response.error = 'Rapfi 引擎尚未就绪'
    post(response)
    return
  }

  var start = stdoutLines.length
  try {
    for (var i = 0; i < request.commands.length; i += 1) {
      module.sendCommand(request.commands[i])
    }
  } catch (error) {
    exited = true
    response.error = 'Rapfi 指令执行失败：' + String(error)
    post(response)
    return
  }

  var moveLine = findMoveLine(stdoutLines.slice(start))
  if (moveLine) {
    response.ok = true
    response.move = moveLine
  } else {
    response.error = 'Rapfi 未返回落点'
  }
  post(response)
}
