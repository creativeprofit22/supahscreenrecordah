import { describe, it, expect } from 'vitest';
import {
  createSpringState,
  stepSpring,
  setSpringTarget,
  DEFAULT_SPRING_CONFIG,
  type SpringConfig,
  type SpringState,
} from '../../src/shared/zoom';

describe('constants', () => {
  it('DEFAULT_SPRING_CONFIG has expected values', () => {
    expect(DEFAULT_SPRING_CONFIG.stiffness).toBe(170);
    expect(DEFAULT_SPRING_CONFIG.damping).toBe(26);
    expect(DEFAULT_SPRING_CONFIG.mass).toBe(1);
  });

  it('DEFAULT_SPRING_CONFIG values are all positive', () => {
    expect(DEFAULT_SPRING_CONFIG.stiffness).toBeGreaterThan(0);
    expect(DEFAULT_SPRING_CONFIG.damping).toBeGreaterThan(0);
    expect(DEFAULT_SPRING_CONFIG.mass).toBeGreaterThan(0);
  });
});

describe('createSpringState', () => {
  it('returns correct initial state', () => {
    const state = createSpringState(1.0);
    expect(state.position).toBe(1.0);
    expect(state.velocity).toBe(0);
    expect(state.target).toBe(1.0);
    expect(state.settled).toBe(true);
  });

  it('works with different initial values', () => {
    const state = createSpringState(2.5);
    expect(state.position).toBe(2.5);
    expect(state.target).toBe(2.5);
    expect(state.velocity).toBe(0);
    expect(state.settled).toBe(true);
  });

  it('works with 0 as initial value', () => {
    const state = createSpringState(0);
    expect(state.position).toBe(0);
    expect(state.target).toBe(0);
  });

  it('works with negative initial value', () => {
    const state = createSpringState(-1);
    expect(state.position).toBe(-1);
    expect(state.target).toBe(-1);
  });
});

describe('stepSpring', () => {
  it('returns immediately when state is settled (no change)', () => {
    const state = createSpringState(1.0);
    const original = { ...state };
    const result = stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    expect(result.position).toBe(original.position);
    expect(result.velocity).toBe(original.velocity);
    expect(result.settled).toBe(true);
  });

  it('moves position toward target when unsettled', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);
    const initialPosition = state.position;
    stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    // Should have moved toward target (2.0)
    expect(state.position).toBeGreaterThan(initialPosition);
    expect(state.position).toBeLessThan(2.0);
  });

  it('moves position toward lower target', () => {
    const state = createSpringState(2.0);
    setSpringTarget(state, 1.0);
    stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    expect(state.position).toBeLessThan(2.0);
    expect(state.position).toBeGreaterThan(1.0);
  });

  it('clamps large dt to 0.064', () => {
    const state1 = createSpringState(1.0);
    setSpringTarget(state1, 2.0);

    const state2 = createSpringState(1.0);
    setSpringTarget(state2, 2.0);

    // Step with dt = 1.0 (way too large, should be clamped to 0.064)
    stepSpring(state1, DEFAULT_SPRING_CONFIG, 1.0);
    // Step with dt = 0.064 (exactly the clamp value)
    stepSpring(state2, DEFAULT_SPRING_CONFIG, 0.064);

    // Both should produce the same result since 1.0 gets clamped to 0.064
    expect(state1.position).toBeCloseTo(state2.position, 10);
    expect(state1.velocity).toBeCloseTo(state2.velocity, 10);
  });

  it('dt below 0.064 is not clamped', () => {
    const state1 = createSpringState(1.0);
    setSpringTarget(state1, 2.0);

    const state2 = createSpringState(1.0);
    setSpringTarget(state2, 2.0);

    // Step with different small dt values
    stepSpring(state1, DEFAULT_SPRING_CONFIG, 0.01);
    stepSpring(state2, DEFAULT_SPRING_CONFIG, 0.02);

    // Should produce different results
    expect(state1.position).not.toBeCloseTo(state2.position, 10);
  });

  it('spring eventually settles at target', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);

    // Simulate ~5 seconds of spring animation at 60fps
    for (let i = 0; i < 300; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
      if (state.settled) break;
    }

    expect(state.settled).toBe(true);
    expect(state.position).toBe(2.0);
    expect(state.velocity).toBe(0);
  });

  it('spring settles within reasonable time (~2-3 seconds)', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);

    let steps = 0;
    while (!state.settled && steps < 300) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
      steps++;
    }

    // Should settle within about 180 frames (~3 seconds at 60fps)
    expect(steps).toBeLessThan(200);
    expect(state.settled).toBe(true);
  });

  it('mutates state in place', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);
    const returnedState = stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    expect(returnedState).toBe(state); // same reference
  });

  describe('edge case: zero mass', () => {
    it('produces extreme acceleration with very small mass', () => {
      const config: SpringConfig = { stiffness: 170, damping: 26, mass: 0.001 };
      const state = createSpringState(1.0);
      setSpringTarget(state, 2.0);
      stepSpring(state, config, 1 / 60);
      // With near-zero mass, acceleration is huge, position changes drastically
      expect(Math.abs(state.position - 1.0)).toBeGreaterThan(0.1);
    });
  });

  describe('custom spring configs', () => {
    it('stiffer spring moves faster', () => {
      const stiffConfig: SpringConfig = { stiffness: 500, damping: 26, mass: 1 };
      const softConfig: SpringConfig = { stiffness: 50, damping: 26, mass: 1 };

      const stiffState = createSpringState(1.0);
      setSpringTarget(stiffState, 2.0);
      stepSpring(stiffState, stiffConfig, 1 / 60);

      const softState = createSpringState(1.0);
      setSpringTarget(softState, 2.0);
      stepSpring(softState, softConfig, 1 / 60);

      // Stiffer spring should move more in the same time step
      expect(Math.abs(stiffState.position - 1.0)).toBeGreaterThan(
        Math.abs(softState.position - 1.0),
      );
    });

    it('heavier mass moves slower', () => {
      const lightConfig: SpringConfig = { stiffness: 170, damping: 26, mass: 0.5 };
      const heavyConfig: SpringConfig = { stiffness: 170, damping: 26, mass: 5 };

      const lightState = createSpringState(1.0);
      setSpringTarget(lightState, 2.0);
      stepSpring(lightState, lightConfig, 1 / 60);

      const heavyState = createSpringState(1.0);
      setSpringTarget(heavyState, 2.0);
      stepSpring(heavyState, heavyConfig, 1 / 60);

      expect(Math.abs(lightState.position - 1.0)).toBeGreaterThan(
        Math.abs(heavyState.position - 1.0),
      );
    });
  });
});

describe('setSpringTarget', () => {
  it('marks state as unsettled', () => {
    const state = createSpringState(1.0);
    expect(state.settled).toBe(true);
    setSpringTarget(state, 2.0);
    expect(state.settled).toBe(false);
  });

  it('updates the target', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 3.0);
    expect(state.target).toBe(3.0);
  });

  it('preserves velocity', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);
    // Step a few times to build up velocity
    for (let i = 0; i < 10; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    }
    const velocityBefore = state.velocity;
    expect(velocityBefore).not.toBe(0);

    // Change target mid-flight
    setSpringTarget(state, 3.0);
    expect(state.velocity).toBe(velocityBefore); // velocity preserved
    expect(state.settled).toBe(false);
  });

  it('preserves position', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 2.0);
    for (let i = 0; i < 10; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    }
    const positionBefore = state.position;
    setSpringTarget(state, 3.0);
    expect(state.position).toBe(positionBefore);
  });

  it('multiple rapid target changes produce continuous motion', () => {
    const state = createSpringState(1.0);

    // Set target, step a bit, change target, step more
    setSpringTarget(state, 2.0);
    for (let i = 0; i < 5; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    }
    const pos1 = state.position;

    setSpringTarget(state, 0.5);
    for (let i = 0; i < 5; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    }
    const pos2 = state.position;

    setSpringTarget(state, 3.0);
    for (let i = 0; i < 5; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    }
    const pos3 = state.position;

    // Positions should all be different, showing the spring is actually moving
    expect(pos1).not.toBe(pos2);
    expect(pos2).not.toBe(pos3);

    // Eventually settles at final target
    for (let i = 0; i < 300; i++) {
      stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
      if (state.settled) break;
    }
    expect(state.settled).toBe(true);
    expect(state.position).toBe(3.0);
  });

  it('setting target to current position marks as unsettled but settles quickly', () => {
    const state = createSpringState(1.0);
    setSpringTarget(state, 1.0);
    expect(state.settled).toBe(false);
    // One step should settle it since position === target and velocity === 0
    stepSpring(state, DEFAULT_SPRING_CONFIG, 1 / 60);
    expect(state.settled).toBe(true);
  });
});
