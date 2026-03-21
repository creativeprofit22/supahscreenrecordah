import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPRING_CONFIG,
  createSpringState,
  stepSpring,
  setSpringTarget,
} from '../../src/shared/zoom';
import type { SpringState, SpringConfig } from '../../src/shared/zoom';

/** Simulate N steps of the spring at a given dt */
function simulate(state: SpringState, config: SpringConfig, dt: number, steps: number): SpringState {
  for (let i = 0; i < steps; i++) {
    stepSpring(state, config, dt);
  }
  return state;
}

const DT_60FPS = 1 / 60; // ~16.67ms

describe('Spring-based Zoom Integration', () => {
  describe('Complete zoom-in/zoom-out cycle', () => {
    it('zooms in to target and then zooms back out to 1.0', () => {
      const state = createSpringState(1.0);
      expect(state.position).toBe(1.0);
      expect(state.settled).toBe(true);

      // Zoom in
      setSpringTarget(state, 1.5);
      expect(state.settled).toBe(false);

      // Run enough steps for ~3 seconds at 60fps
      simulate(state, DEFAULT_SPRING_CONFIG, DT_60FPS, 180);
      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(1.5, 3);

      // Zoom out
      setSpringTarget(state, 1.0);
      simulate(state, DEFAULT_SPRING_CONFIG, DT_60FPS, 180);
      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(1.0, 3);
    });
  });

  describe('Spring reaches target within reasonable steps', () => {
    it('settles to target within 120 frames (~2 seconds at 60fps)', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 2.0);

      let settledAt = -1;
      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        if (state.settled) {
          settledAt = i;
          break;
        }
      }

      expect(settledAt).toBeGreaterThan(0);
      expect(settledAt).toBeLessThan(120); // Should settle in under 2 seconds
      expect(state.position).toBe(2.0);
    });
  });

  describe('Spring does not overshoot significantly with DEFAULT_SPRING_CONFIG', () => {
    it('position never exceeds target + 10% during zoom-in', () => {
      const state = createSpringState(1.0);
      const target = 1.5;
      setSpringTarget(state, target);

      const overshootThreshold = target * 1.10; // 10% overshoot tolerance
      let maxPosition = state.position;

      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        maxPosition = Math.max(maxPosition, state.position);
      }

      expect(maxPosition).toBeLessThanOrEqual(overshootThreshold);
    });

    it('position never goes below target - 10% during zoom-out', () => {
      const state = createSpringState(2.0);
      const target = 1.0;
      setSpringTarget(state, target);

      const undershootThreshold = target - (2.0 - target) * 0.10;
      let minPosition = state.position;

      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        minPosition = Math.min(minPosition, state.position);
      }

      expect(minPosition).toBeGreaterThanOrEqual(undershootThreshold);
    });
  });

  describe('Interrupted zoom (target change mid-animation)', () => {
    it('produces smooth transition when target changes mid-flight', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 2.0);

      // Run 15 frames (~250ms), then change target
      const positions: number[] = [];
      for (let i = 0; i < 15; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        positions.push(state.position);
      }

      // Should be partway to 2.0, not yet settled
      expect(state.settled).toBe(false);
      expect(state.position).toBeGreaterThan(1.0);
      expect(state.position).toBeLessThan(2.0);

      // Change target back to 1.0 mid-flight
      const positionAtChange = state.position;
      const velocityAtChange = state.velocity;
      setSpringTarget(state, 1.0);

      // Velocity should be preserved (smooth, not a jump)
      expect(state.velocity).toBe(velocityAtChange);

      // Continue simulating
      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        positions.push(state.position);
      }

      // Should settle back to 1.0
      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(1.0, 3);

      // Check smoothness: no massive jumps between consecutive frames
      for (let i = 1; i < positions.length; i++) {
        const delta = Math.abs(positions[i] - positions[i - 1]);
        // A single frame delta should be small (less than 0.15 at 60fps)
        expect(delta).toBeLessThan(0.15);
      }
    });
  });

  describe('Position is always finite and reasonable', () => {
    it('no NaN or Infinity values during simulation', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 2.0);

      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        expect(Number.isFinite(state.position)).toBe(true);
        expect(Number.isFinite(state.velocity)).toBe(true);
        expect(Number.isNaN(state.position)).toBe(false);
        expect(Number.isNaN(state.velocity)).toBe(false);
      }
    });

    it('handles very small dt without instability', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 1.5);

      // Very small timestep (1000fps equivalent)
      for (let i = 0; i < 3000; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, 0.001);
        expect(Number.isFinite(state.position)).toBe(true);
        expect(Number.isFinite(state.velocity)).toBe(true);
      }

      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(1.5, 3);
    });

    it('handles large dt (frame drops) without producing NaN or Infinity', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 1.5);

      // Simulate severe frame drops: 200ms per frame (clamped to 64ms internally).
      // The semi-implicit Euler integrator with stiffness=170 and dt=0.064 can
      // oscillate, but values must remain finite (no NaN/Infinity).
      for (let i = 0; i < 50; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, 0.2);
        expect(Number.isFinite(state.position)).toBe(true);
        expect(Number.isFinite(state.velocity)).toBe(true);
      }

      // After the frame drops, switching to normal dt should allow convergence
      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
      }
      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(1.5, 3);
    });

    it('position stays within reasonable bounds [0, 10]', () => {
      const state = createSpringState(1.0);
      setSpringTarget(state, 2.0);

      for (let i = 0; i < 300; i++) {
        stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        expect(state.position).toBeGreaterThan(0);
        expect(state.position).toBeLessThan(10);
      }
    });
  });

  describe('Multiple rapid target changes (stability test)', () => {
    it('rapid target oscillation does not cause instability', () => {
      const state = createSpringState(1.0);

      // Rapidly switch targets every 5 frames
      for (let cycle = 0; cycle < 20; cycle++) {
        const target = cycle % 2 === 0 ? 2.0 : 1.3;
        setSpringTarget(state, target);

        for (let i = 0; i < 5; i++) {
          stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
          expect(Number.isFinite(state.position)).toBe(true);
          expect(Number.isFinite(state.velocity)).toBe(true);
          expect(state.position).toBeGreaterThan(0);
          expect(state.position).toBeLessThan(10);
        }
      }
    });

    it('eventually settles after rapid changes stop', () => {
      const state = createSpringState(1.0);

      // Rapid changes
      for (let cycle = 0; cycle < 10; cycle++) {
        setSpringTarget(state, 1.0 + Math.random());
        for (let i = 0; i < 3; i++) {
          stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
        }
      }

      // Set final target and let it settle
      const finalTarget = 1.5;
      setSpringTarget(state, finalTarget);
      simulate(state, DEFAULT_SPRING_CONFIG, DT_60FPS, 300);

      expect(state.settled).toBe(true);
      expect(state.position).toBeCloseTo(finalTarget, 3);
    });
  });

  describe('Spring constants and exported values', () => {
    it('DEFAULT_SPRING_CONFIG has positive stiffness, damping, mass', () => {
      expect(DEFAULT_SPRING_CONFIG.stiffness).toBeGreaterThan(0);
      expect(DEFAULT_SPRING_CONFIG.damping).toBeGreaterThan(0);
      expect(DEFAULT_SPRING_CONFIG.mass).toBeGreaterThan(0);
    });

    it('createSpringState initialises at rest', () => {
      const state = createSpringState(1.0);
      expect(state.position).toBe(1.0);
      expect(state.velocity).toBe(0);
      expect(state.target).toBe(1.0);
      expect(state.settled).toBe(true);
    });

    it('stepSpring on settled state is a no-op', () => {
      const state = createSpringState(1.0);
      const before = { ...state };
      stepSpring(state, DEFAULT_SPRING_CONFIG, DT_60FPS);
      expect(state.position).toBe(before.position);
      expect(state.velocity).toBe(before.velocity);
      expect(state.settled).toBe(true);
    });
  });
});
