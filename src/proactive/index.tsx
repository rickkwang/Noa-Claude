// @ts-nocheck
import { EventEmitter } from 'events';

let _isActive = false;
let _isPaused = false;
let _contextBlocked = false;
let _nextTickAt: number | null = null;
const _emitter = new EventEmitter();

export function setContextBlocked(blocked: boolean): void {
  _contextBlocked = blocked;
  _emitter.emit('change');
}

export function resumeProactive(): void {
  _isPaused = false;
  _emitter.emit('change');
}

export function pauseProactive(): void {
  _isPaused = true;
  _emitter.emit('change');
}

export function isProactiveActive(): boolean {
  return _isActive;
}

export function isProactivePaused(): boolean {
  return _isPaused;
}

export function activateProactive(mode: string): void {
  _isActive = true;
  _isPaused = false;
  _nextTickAt = Date.now() + 5000;
  _emitter.emit('change');
}

export function deactivateProactive(): void {
  _isActive = false;
  _isPaused = false;
  _nextTickAt = null;
  _emitter.emit('change');
}

export function getNextTickAt(): number | null {
  return _nextTickAt;
}

export function subscribeToProactiveChanges(cb: () => void): () => void {
  _emitter.on('change', cb);
  return () => _emitter.off('change', cb);
}

export default {
  setContextBlocked,
  resumeProactive,
  pauseProactive,
  isProactiveActive,
  isProactivePaused,
  activateProactive,
  deactivateProactive,
  getNextTickAt,
  subscribeToProactiveChanges,
};