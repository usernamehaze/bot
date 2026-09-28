// Glossy neon-pink accent used across every glowing element.
export const PINK = '#FF1493';
export const PINK_SOFT = '#FF69B4';

// The five emotion states. Each carries a target pose for the 3D rig plus the
// UI metadata (label, icon, blurb) shown on the emotion cards.
// Pose fields (all interpolated smoothly in CassieBot's useFrame loop):
//   jump      – vertical bob offset added to the whole rig
//   headX     – head pitch (look up when negative)
//   headZ     – head roll (tilt sideways)
//   armL/armR – shoulder roll for the left / right arm (raise = larger magnitude)
//   rimColor  – ambient rim light colour behind the bot
//   eyes      – 'oval' | 'star'   (celebratory uses star eyes)
//   confetti  – show floating particles
//   icon      – floating status icon: 'none' | 'cloud' | 'question'
export const EMOTIONS = {
  neutral: {
    key: 'neutral',
    label: 'Ready',
    emoji: '🤖',
    blurb: 'Clean, calm and ready to help.',
    pose: { jump: 0, headX: 0, headZ: 0, armL: -0.28, armR: 0.28, rimColor: PINK, eyes: 'oval', confetti: false, icon: 'none' },
  },
  thinking: {
    key: 'thinking',
    label: 'Thinking',
    emoji: '💭',
    blurb: 'Looking up, working it out.',
    pose: { jump: 0, headX: -0.28, headZ: 0.14, armL: -0.28, armR: 2.2, rimColor: '#6aa9ff', eyes: 'oval', confetti: false, icon: 'cloud' },
  },
  encouraging: {
    key: 'encouraging',
    label: 'Encouraging',
    emoji: '🙌',
    blurb: 'Arms open — you’ve got this!',
    pose: { jump: 0.04, headX: -0.06, headZ: 0, armL: -1.4, armR: 1.4, rimColor: '#57e39b', eyes: 'oval', confetti: false, icon: 'none' },
  },
  celebratory: {
    key: 'celebratory',
    label: 'Celebrating',
    emoji: '🎉',
    blurb: 'Jumping for joy with star eyes.',
    pose: { jump: 0.32, headX: -0.1, headZ: 0, armL: -2.4, armR: 2.4, rimColor: PINK, eyes: 'star', confetti: true, icon: 'none' },
  },
  curious: {
    key: 'curious',
    label: 'Curious',
    emoji: '❓',
    blurb: 'Head tilted, wondering aloud.',
    pose: { jump: 0, headX: 0.02, headZ: 0.38, armL: -0.28, armR: 0.28, rimColor: PINK_SOFT, eyes: 'oval', confetti: false, icon: 'question' },
  },
  // Not shown as a showcase card; driven by the tutor at night via setEmotion('sleep').
  sleep: {
    key: 'sleep',
    label: 'Sleeping',
    emoji: '😴',
    blurb: 'Taking a little nap.',
    pose: { jump: 0, headX: 0.16, headZ: 0.12, armL: -0.2, armR: 0.2, rimColor: PINK_SOFT, eyes: 'closed', confetti: false, icon: 'zzz' },
  },
  // Driven by the tutor when the bot is dragged too fast.
  angry: {
    key: 'angry',
    label: 'Angry',
    emoji: '😠',
    blurb: 'Hey — quit shaking me!',
    pose: { jump: 0, headX: 0.06, headZ: 0, armL: -0.55, armR: 0.55, rimColor: '#ff4d4d', eyes: 'angry', confetti: false, icon: 'none', shake: true },
  },
  // Driven by the tutor while the bot is being dragged around.
  dizzy: {
    key: 'dizzy',
    label: 'Dizzy',
    emoji: '😵',
    blurb: 'Wheee… so dizzy!',
    pose: { jump: 0, headX: 0, headZ: 0.2, armL: -0.4, armR: 0.4, rimColor: PINK_SOFT, eyes: 'dizzy', confetti: false, icon: 'none', wobble: true },
  },
};

export const EMOTION_ORDER = ['neutral', 'thinking', 'encouraging', 'celebratory', 'curious'];
