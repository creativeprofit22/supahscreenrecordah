/* eslint-disable @typescript-eslint/no-unused-vars */
var exports = {};
var _modules = {};

/* Minimal CommonJS require() shim for renderer scripts.
   Shared modules loaded via <script> tags call _snap(name) afterward
   to snapshot their exports before the next script resets `exports`. */
function _snap(name) {
  _modules[name] = exports;
  exports = {};
}

function require(id) {
  var name = id.replace(/^.*[\\/]/, '').replace(/\.js$/, '');
  if (_modules[name]) {
    return _modules[name];
  }
  throw new Error('Module not found: ' + id);
}
