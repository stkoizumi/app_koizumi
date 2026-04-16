import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { suggestMenu as suggestMenuFn } from "../functions/suggest-menu/resource";

const schema = a.schema({
  MenuHistory: a
    .model({
      userId: a.string().required(),
      ingredientText: a.string().required(),
      dishTitle: a.string().required(),
      recipe: a.string().required(),
      usedIngredients: a.string().array(),
      savedAt: a.string().required(),
    })
    .secondaryIndexes((index) => [
      index("userId").sortKeys(["savedAt"]),
    ])
    .authorization((allow) => [allow.owner()]),

  FavoriteMenu: a
    .model({
      userId: a.string().required(),
      favoriteKey: a.string().required(),
      ingredientText: a.string().required(),
      dishTitle: a.string().required(),
      recipe: a.string().required(),
      usedIngredients: a.string().array(),
      imagePath: a.string(),
      favoritedAt: a.string().required(),
      sourceHistoryId: a.string(),
    })
    .secondaryIndexes((index) => [
      index("userId").sortKeys(["favoritedAt"]),
      index("userId").sortKeys(["favoriteKey"]),
    ])
    .authorization((allow) => [allow.owner()]),

  SuggestMenuResponse: a.customType({
    title: a.string(),
    recipe: a.string(),
  }),

  suggestMenu: a
    .query()
    .arguments({ ingredientText: a.string() })
    .returns(a.ref("SuggestMenuResponse"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(suggestMenuFn)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
