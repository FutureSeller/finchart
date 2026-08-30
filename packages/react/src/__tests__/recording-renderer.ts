import type { DrawCommand, RendererFactory } from '@finchart/core';
import { recordingRenderer } from '@finchart/core';

export interface RendererSpy {
  createRenderer: RendererFactory;
  /** The commands the last commit actually emitted. */
  readonly committed: readonly DrawCommand[];
}

/**
 * Wraps core's recording renderer (now first-class) in the shape of a spy.
 * This used to be a hand-rolled fake, but once the same renderer became the
 * official headless output, these tests started exercising the real path
 * instead of an imitation.
 */
export function rendererSpy(): RendererSpy {
  const recorder = recordingRenderer();

  return {
    createRenderer: recorder.factory,
    get committed() {
      return recorder.commands();
    },
  };
}
