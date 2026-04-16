import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "favoriteMenuImages",
  access: (allow) => ({
    "favorite-menu-images/{entity_id}/*": [
      allow.entity("identity").to(["read", "write", "delete"]),
    ],
  }),
});
