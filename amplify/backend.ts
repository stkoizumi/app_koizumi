import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { suggestMenu } from "./functions/suggest-menu/resource";

const CLAUDE_HAIKU_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";

const backend = defineBackend({
  auth,
  data,
  suggestMenu,
});

const suggestMenuLambda = backend.suggestMenu.resources.lambda;
const region = Stack.of(suggestMenuLambda).region;

suggestMenuLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:InvokeModel"],
    resources: [
      `arn:aws:bedrock:${region}::foundation-model/${CLAUDE_HAIKU_MODEL_ID}`,
    ],
  })
);
