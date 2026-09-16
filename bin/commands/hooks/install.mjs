/** @import { ParsedCommand } from '../../command.d.ts' */

/** @type {ParsedCommand} */
export default {
  kind: 'parsed',
  describe: "Install husky's git hooks",
  async run() {
    // Lazy: husky is only needed when this command actually runs, and keeping
    // it out of module scope keeps `devkit lint` from paying for it.
    const { default: husky } = await import('husky');
    const message = husky();
    if (message) console.log(message);
  },
};
