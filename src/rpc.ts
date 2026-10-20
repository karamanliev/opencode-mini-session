import { Rpc } from "@opencode/plugin/rpc";

export const MiniSettings = Rpc.define({
  id: "opencode-mini-session.settings",
  methods: {
    options: {
      input: { type: "object", additionalProperties: false },
      output: { type: "object", additionalProperties: true },
    },
  },
  events: {},
});
