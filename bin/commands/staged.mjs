/** @import { PassthroughCommand } from '../command.d.ts' */

import { runTool } from '../tools.mjs';

/** @type {PassthroughCommand} */
export default {
  kind: 'passthrough',
  describe: 'Run lint-staged, for a pre-commit hook',
  run(argv) {
    runTool('lint-staged', argv);
  },
};
