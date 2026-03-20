"use strict";
// Zoom calculation utilities — extracted for testability
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SPRING_CONFIG = exports.MAX_CLICK_ZOOM = exports.MIN_CLICK_ZOOM = void 0;
exports.createSpringState = createSpringState;
exports.stepSpring = stepSpring;
exports.setSpringTarget = setSpringTarget;
exports.MIN_CLICK_ZOOM = 1.3;
exports.MAX_CLICK_ZOOM = 2.0;
/** Default spring config — critically-damped feel, no bounce */
exports.DEFAULT_SPRING_CONFIG = {
    stiffness: 170,
    damping: 26,
    mass: 1,
};
function createSpringState(initial) {
    return { position: initial, velocity: 0, target: initial, settled: true };
}
/**
 * Advance a spring simulation by `dt` seconds.
 *
 * Uses a semi-implicit Euler integrator — stable enough for 60 fps zoom
 * transitions while remaining simple and predictable.
 *
 * @returns Updated state (mutated in-place for performance)
 */
function stepSpring(state, config, dt) {
    if (state.settled) {
        return state;
    }
    // Clamp dt to avoid spiral-of-death on long frame drops
    const clampedDt = Math.min(dt, 0.064);
    // Semi-implicit Euler
    const displacement = state.position - state.target;
    const springForce = -config.stiffness * displacement;
    const dampingForce = -config.damping * state.velocity;
    const acceleration = (springForce + dampingForce) / config.mass;
    state.velocity += acceleration * clampedDt;
    state.position += state.velocity * clampedDt;
    // Settle when both displacement and velocity are negligible
    const SETTLE_THRESHOLD = 0.0005;
    const VELOCITY_THRESHOLD = 0.005;
    if (Math.abs(state.position - state.target) < SETTLE_THRESHOLD &&
        Math.abs(state.velocity) < VELOCITY_THRESHOLD) {
        state.position = state.target;
        state.velocity = 0;
        state.settled = true;
    }
    return state;
}
/**
 * Set a new target for the spring. Preserves current velocity so
 * mid-flight target changes produce smooth, continuous motion.
 */
function setSpringTarget(state, target) {
    state.target = target;
    state.settled = false;
}
//# sourceMappingURL=zoom.js.map