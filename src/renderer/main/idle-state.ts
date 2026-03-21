// Idle state visibility — shown when no screen or camera is active

import { idleState } from './dom';

export function showIdleState(): void {
  idleState.classList.remove('hidden');
}

export function hideIdleState(): void {
  idleState.classList.add('hidden');
}
