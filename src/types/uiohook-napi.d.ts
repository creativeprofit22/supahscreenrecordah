declare module 'uiohook-napi' {
  import { EventEmitter } from 'events';

  export const UiohookKey: Record<string, number>;

  export enum EventType {
    EVENT_KEY_PRESSED = 4,
    EVENT_KEY_RELEASED = 5,
    EVENT_MOUSE_CLICKED = 6,
    EVENT_MOUSE_PRESSED = 7,
    EVENT_MOUSE_RELEASED = 8,
    EVENT_MOUSE_MOVED = 9,
    EVENT_MOUSE_WHEEL = 11,
  }

  export interface UiohookKeyboardEvent {
    type: EventType;
    keycode: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }

  export interface UiohookMouseEvent {
    type: EventType;
    button: number;
    clicks: number;
    x: number;
    y: number;
  }

  export interface UiohookWheelEvent {
    type: EventType;
    x: number;
    y: number;
    rotation: number;
    direction: number;
  }

  interface UiohookNapi extends EventEmitter {
    start(): void;
    stop(): void;
    on(event: 'keydown' | 'keyup', listener: (e: UiohookKeyboardEvent) => void): this;
    on(event: 'mousedown' | 'mouseup' | 'click', listener: (e: UiohookMouseEvent) => void): this;
    on(event: 'mousemove', listener: (e: UiohookMouseEvent) => void): this;
    on(event: 'wheel', listener: (e: UiohookWheelEvent) => void): this;
  }

  export const uIOhook: UiohookNapi;
}
