// Dedicated-worker clock for recorder.js. The recorder window usually sits behind the browser
// window it is recording, and Chrome throttles timers of hidden/occluded pages (down to one tick
// per second, or per minute after a few minutes). Worker timers are not subject to that
// throttling, so the GIF sampler and the part rotation keep their real cadence.
// 200 ms = 1000 / GIF_FPS (5 fps), the GIF sampling interval in recorder.js.
setInterval(() => postMessage(Date.now()), 200);
