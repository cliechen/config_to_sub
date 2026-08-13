// Test harness: loads src/worker.js into a VM and exposes internal functions.
// Functions declared with `function` at top level become global bindings in the sandbox.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WORKER_PATH = path.join(__dirname, '..', 'src', 'worker.js');

function loadWorker(mockFetch) {
  let src = fs.readFileSync(WORKER_PATH, 'utf8');
  // Turn the ESM module into a plain script so vm can run it
  src = src.replace(/import yaml from 'js-yaml';/, 'const yaml = require("js-yaml");');
  src = src.replace(/export default/, 'globalThis.workerDefault =');

  const sandbox = {
    require,
    console,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    AbortSignal,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    fetch: mockFetch || (() => Promise.reject(new Error('fetch not mocked'))),
    __dirname,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'worker.js' });
  return sandbox;
}

module.exports = { loadWorker, WORKER_PATH };
