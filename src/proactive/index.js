'use strict';
var EventEmitter = require('events');

let _isActive = false;
let _isPaused = false;
let _contextBlocked = false;
let _nextTickAt = null;
const _emitter = new EventEmitter();

function setContextBlocked(blocked) {
  _contextBlocked = blocked;
  _emitter.emit('change');
}

function resumeProactive() {
  _isPaused = false;
  _emitter.emit('change');
}

function pauseProactive() {
  _isPaused = true;
  _emitter.emit('change');
}

function isProactiveActive() {
  return _isActive;
}

function isProactivePaused() {
  return _isPaused;
}

function activateProactive(mode) {
  _isActive = true;
  _isPaused = false;
  _nextTickAt = Date.now() + 5000;
  _emitter.emit('change');
}

function deactivateProactive() {
  _isActive = false;
  _isPaused = false;
  _nextTickAt = null;
  _emitter.emit('change');
}

function getNextTickAt() {
  return _nextTickAt;
}

function subscribeToProactiveChanges(cb) {
  _emitter.on('change', cb);
  return () => _emitter.off('change', cb);
}

module.exports = {
  setContextBlocked,
  resumeProactive,
  pauseProactive,
  isProactiveActive,
  isProactivePaused,
  activateProactive,
  deactivateProactive,
  getNextTickAt,
  subscribeToProactiveChanges,
  default: {
    setContextBlocked,
    resumeProactive,
    pauseProactive,
    isProactiveActive,
    isProactivePaused,
    activateProactive,
    deactivateProactive,
    getNextTickAt,
    subscribeToProactiveChanges,
  }
};
