import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VERSION = "0.1.0";

export default function xpiSuperplan(pi: ExtensionAPI): void {
  pi.registerCommand("xpi-superplan", {
    description: "Show xpi-superplan status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-superplan ${VERSION} loaded`);
    },
  });
}
