import * as device from "@swipt/api/device";
import { defineAction, defineExtension } from "@swipt/api/swiplet";

export default defineExtension({
  actions: {
    frontApp: defineAction({
      title: "Find the App in Front",
      run: (_, { signal }) => device.foregroundApplication.get({ signal }),
    }),
  },
});
