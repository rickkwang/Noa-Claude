// Soft synthesized ticks while an answer is revealed: short notes from a pentatonic scale, denser as
// the text reveals faster, so the ear and the eye follow one tempo. Synth -> reverb -> tremolo -> lowpass.
type Preset = {
  wave: OscillatorType
  attack: number; decay: number; sustain: number; release: number
  cutoff: number; slope: 12 | 24
  tremolo: [hz: number, depth: number]
  reverb: [seconds: number, wet: number]
}
const PRESETS: Record<string, Preset> = {
  classic: { wave: "triangle", attack: .01, decay: .2, sustain: .2, release: .3, cutoff: 2000, slope: 12, tremolo: [.8, .3], reverb: [1.5, .7] },
  ethereal: { wave: "sine", attack: .1, decay: .4, sustain: .4, release: .8, cutoff: 3000, slope: 24, tremolo: [.5, .5], reverb: [2.5, .8] },
}
// C4 D4 F4 G4 A4 C5 D5: no semitone steps, so any random sequence stays consonant.
const NOTES = [261.63, 293.66, 349.23, 392, 440, 523.25, 587.33]
const NOTE_SECONDS = .0625
// Notes per second grow with the log of the reveal speed: about 4 at 15 chars/s, 6 at 50, 9 at 180.
// Perceived tempo is roughly logarithmic, so faster text sounds faster without turning into a buzz.
const notesPerSecond = (charsPerSecond: number) => Math.min(10, Math.max(3, 2.012 * Math.log(charsPerSecond) - 1.449))
const PREVIEW_GAP_SECONDS = .12
const MAX_VOICES = 16
const VOLUME = .5 // -6dB at full volume
const PRE_DELAY_SECONDS = .01

// Time constant of an exponential approach that is within 1/200 of its target after `seconds`.
const approach = (seconds: number) => Math.log(seconds + 1) / Math.log(200)

type Settings = { enabled: boolean; preset: string; volume: number }
let settings: Settings = { enabled: false, preset: "classic", volume: 100 }
let audio: { ctx: AudioContext; input: GainNode; preset: Preset; name: string } | null | undefined
let lastNote = -Infinity
let voices = 0

function setup() {
  const name = settings.preset
  const preset = PRESETS[name]
  if (!preset) return null
  const ctx = new AudioContext()
  // Timing and voice counts belong to the context they were measured on.
  lastNote = -Infinity
  voices = 0
  const input = new GainNode(ctx, { gain: VOLUME * settings.volume / 100 })
  // Reverb: decaying stereo noise as the impulse, mixed with the dry signal.
  const [seconds, wet] = preset.reverb
  const impulse = ctx.createBuffer(2, Math.round((PRE_DELAY_SECONDS + seconds) * ctx.sampleRate), ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate - PRE_DELAY_SECONDS
      data[i] = t < 0 ? 0 : (Math.random() * 2 - 1) * Math.exp(-t / approach(seconds))
    }
  }
  const convolver = new ConvolverNode(ctx, { buffer: impulse })
  const mix = new GainNode(ctx)
  // Equal-power dry/wet mix.
  input.connect(new GainNode(ctx, { gain: Math.cos(wet * Math.PI / 2) })).connect(mix)
  input.connect(convolver).connect(new GainNode(ctx, { gain: Math.sin(wet * Math.PI / 2) })).connect(mix)
  // Tremolo: each channel's gain swings between (1 - depth) / 2 and (1 + depth) / 2, left and right in opposite phase.
  const [hz, depth] = preset.tremolo
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 })
  const tremolo = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
  mix.connect(split)
  for (const channel of [0, 1]) {
    const gain = new GainNode(ctx, { gain: .5 })
    const lfo = new OscillatorNode(ctx, { frequency: hz })
    lfo.connect(new GainNode(ctx, { gain: channel ? -depth / 2 : depth / 2 })).connect(gain.gain)
    lfo.start()
    split.connect(gain, channel).connect(tremolo, 0, channel)
  }
  let out: AudioNode = tremolo
  for (let i = 0; i < preset.slope / 12; i++) out = out.connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: preset.cutoff, Q: 1 }))
  out.connect(ctx.destination)
  return { ctx, input, preset, name }
}

function playNote(ctx: AudioContext, input: GainNode, p: Preset, gap: number) {
  const now = ctx.currentTime
  if (now - lastNote < gap || voices >= MAX_VOICES) return
  lastNote = now
  const osc = new OscillatorNode(ctx, { type: p.wave, frequency: NOTES[Math.floor(Math.random() * NOTES.length)] })
  const env = new GainNode(ctx, { gain: 0 })
  // A release before the attack ends (a slow attack) starts from wherever the ramp got to.
  const release = now + NOTE_SECONDS
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(1, now + p.attack)
  env.gain.setTargetAtTime(p.sustain, now + p.attack, approach(p.decay))
  env.gain.cancelAndHoldAtTime(release)
  env.gain.setTargetAtTime(0, release, approach(p.release))
  osc.connect(env).connect(input)
  osc.start(now)
  osc.stop(release + p.release)
  voices++
  osc.onended = () => { voices--; osc.disconnect(); env.disconnect() }
}

export function configureStreamSound(next: Settings) {
  settings = next
  // Turning the sound off releases the audio device; switching presets rebuilds the chain.
  if (audio && (!next.enabled || audio.name !== next.preset)) { void audio.ctx.close(); audio = undefined }
  if (audio) audio.input.gain.value = VOLUME * next.volume / 100
}

function play(gap: number) {
  if (audio === undefined) audio = setup()
  if (!audio) return
  const current = audio
  // A new context starts suspended; play once it is running rather than dropping the note.
  if (current.ctx.state === "running") playNote(current.ctx, current.input, current.preset, gap)
  else current.ctx.resume().then(() => { if (audio === current) playNote(current.ctx, current.input, current.preset, gap) }, () => undefined)
}

// Called on each frame that reveals text, with the current reveal speed.
export function streamSound(charsPerSecond: number) {
  if (settings.enabled) play(1 / notesPerSecond(charsPerSecond))
}

// Five notes 120ms apart with the current preset and volume.
export function previewStreamSound() {
  play(0)
  for (let i = 1; i < 5; i++) setTimeout(() => play(0), i * PREVIEW_GAP_SECONDS * 1000)
}
