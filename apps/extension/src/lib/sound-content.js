// Classic-script sound-effects twin shared by the toolbar (content script) and the options page —
// same short audio cues either context can trigger, gated by the same preferences.soundEffects
// flag. Split out of toolbar.js so options.js (a separate JS context with no access to toolbar.js's
// module state) can play the "achievement unlocked" cue on the Tutorial panel too.
(() => {
  const SOUND_FILES = {
    pass: "src/assets/sounds/test-pass.mp3",
    fail: "src/assets/sounds/test-fail.mp3",
    blocked: "src/assets/sounds/test-block.mp3",
    limitation: "src/assets/sounds/test-block.mp3",
    httpError: "src/assets/sounds/http-error.mp3",
    macroPlay: "src/assets/sounds/play-macro.mp3",
    // Reuses the existing "pass" cue for tutorial step completion — it already reads as a
    // success/positive sound, and adding a brand new audio asset isn't worth the extra binary
    // for what's functionally the same "you did it" moment.
    achievement: "src/assets/sounds/test-pass.mp3",
  };

  function soundEffectsEnabled(workspace) {
    return workspace?.preferences?.soundEffects !== false;
  }

  function playSound(key, workspace) {
    if (!soundEffectsEnabled(workspace)) return;
    const path = SOUND_FILES[key];
    if (!path) return;
    try {
      const audio = new Audio(chrome.runtime.getURL(path));
      audio.volume = 0.6;
      void audio.play().catch(() => {});
    } catch {
      // Ignore playback failures (e.g. autoplay policy) — sound is a nicety, never blocking.
    }
  }

  window.QTS_SOUND = Object.freeze({ SOUND_FILES, soundEffectsEnabled, playSound });
})();
