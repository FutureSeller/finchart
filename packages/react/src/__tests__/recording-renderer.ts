import type { DrawCommand, RendererFactory } from '@finchart/core';
import { recordingRenderer } from '@finchart/core';

export interface RendererSpy {
  createRenderer: RendererFactory;
  /** The commands the last commit actually emitted. */
  readonly committed: readonly DrawCommand[];
}

/**
 * Wraps core's recording renderer in the shape of a spy. It is the same
 * renderer as the official headless output, so these tests exercise the
 * real path instead of an imitation.
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
