// Type declarations for @mediapipe/tasks-vision
// The package ships vision.d.ts but doesn't declare "types" in package.json,
// so TypeScript can't find it with Node16 resolution. We declare the minimum
// surface used by webcam-blur.ts here.

declare module '@mediapipe/tasks-vision' {
  interface BaseOptions {
    modelAssetPath?: string;
    modelAssetBuffer?: Uint8Array;
    delegate?: 'CPU' | 'GPU';
  }

  interface ImageSegmenterOptions {
    baseOptions: BaseOptions;
    runningMode: 'IMAGE' | 'VIDEO';
    outputCategoryMask?: boolean;
    outputConfidenceMasks?: boolean;
  }

  interface MPMask {
    getAsFloat32Array(): Float32Array;
    getAsUint8Array(): Uint8Array;
    close(): void;
    width: number;
    height: number;
  }

  interface ImageSegmenterResult {
    confidenceMasks?: MPMask[];
    categoryMask?: MPMask;
  }

  class ImageSegmenter {
    static createFromOptions(
      vision: VisionTasksFilesetResolver,
      options: ImageSegmenterOptions,
    ): Promise<ImageSegmenter>;
    segmentForVideo(
      videoFrame: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
      timestampMs: number,
    ): ImageSegmenterResult;
    segment(
      image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    ): ImageSegmenterResult;
    close(): void;
  }

  interface VisionTasksFilesetResolver {
    // opaque handle returned by FilesetResolver.forVisionTasks
  }

  class FilesetResolver {
    static forVisionTasks(wasmBasePath: string): Promise<VisionTasksFilesetResolver>;
  }
}
