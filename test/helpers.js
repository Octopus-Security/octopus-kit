'use strict';
// Shared test doubles. Not a test file.
const http = require('node:http');

/** A res double that records what an Express handler did. */
function fakeRes() {
  const r = {
    code: 200, body: undefined, headers: {}, ended: false,
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; r.ended = true; return r; },
    send(b) { r.body = b; r.ended = true; return r; },
    type() { return r; },
    set(k, v) { r.headers[k] = v; return r; },
    locals: {},
  };
  return r;
}

function fakeReq(over = {}) {
  const headers = { cookie: 'octopus_sso=abc', ...(over.headers || {}) };
  return { user: { username: 'sam' }, originalUrl: '/', url: '/', ...over, headers };
}

async function run(mw, req, res = fakeRes()) {
  let nexted = false; let err;
  await mw(req, res, e => { nexted = true; err = e; });
  return { res, nexted, err };
}

const silent = { warn() {}, error() {}, info() {}, log() {} };

/** Start a local HTTP stub. handler(req, res, body). Resolves { url, close, hits }. */
function stub(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { hits.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

const json = (res, code, b) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };

module.exports = { fakeRes, fakeReq, run, silent, stub, json };
