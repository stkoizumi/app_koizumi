import { defineFunction } from "@aws-amplify/backend";

export const suggestMenu = defineFunction({
  name: "suggest-menu",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
});
