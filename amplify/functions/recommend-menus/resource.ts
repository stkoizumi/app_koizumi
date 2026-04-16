import { defineFunction } from "@aws-amplify/backend";

export const recommendMenus = defineFunction({
  name: "recommend-menus",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
});
