/** @import { PassthroughCommand } from '../command.d.ts' */

import { runTool } from '../tools.mjs';

/** @type {PassthroughCommand} */
export default {
  kind: 'passthrough',
  describe: 'Run oxfmt over the repo',
  run(argv) {
    runTool('oxfmt', argv);
  },
};
