'use strict';
var React = require('react');
var store = require('../state/store.js');

const VoiceContext = React.createContext(null);

function VoiceProvider({ children }) {
  return React.createElement(VoiceContext.Provider, { value: store.createStore({
    voiceState: 'idle',
    voiceError: null,
    voiceInterimTranscript: '',
    voiceAudioLevels: [],
    voiceWarmingUp: false
  }) }, children);
}

function useVoiceStore() {
  const ctx = React.useContext(VoiceContext);
  if (!ctx) throw new Error("useVoiceState must be used within a VoiceProvider");
  return ctx;
}

function useVoiceState(selector) {
  const store = useVoiceStore();
  return React.useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

function useSetVoiceState() {
  return useVoiceStore().setState;
}

function useGetVoiceState() {
  return useVoiceStore().getState;
}

module.exports = { VoiceContext, VoiceProvider, useVoiceState, useSetVoiceState, useGetVoiceState };
