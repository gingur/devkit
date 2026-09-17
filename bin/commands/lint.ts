import type { PassthroughCommand } from '../command.ts';
import { runTool } from '../tools.mjs';

export default {
  kind: 'passthrough',
  describe: 'Run oxlint over the repo',
  run(argv) {
    runTool('oxlint', argv);
  },
} satisfies PassthroughCommand;
