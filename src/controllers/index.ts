import type { Controller, ControllerKind } from '../shared/types';
import { llmController } from './llm';
import { scriptedController } from './scripted';

// Model/provider access is shared; all mutable per-agent state lives in the sim store.
export function getController(kind: ControllerKind): Controller {
  switch (kind) {
    case 'scripted':
      return scriptedController;
    case 'llm':
      return llmController;
    case 'fly':
      return {
        kind: 'fly',
        decide: async () => {
          throw new Error('fly bodies are driven by the connectome brain driver, not by plan decisions');
        },
      };
  }
}
