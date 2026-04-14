import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

export type MenuSuggestion = {
  title: string;
  uses: string[];
  note: string;
};

const client = generateClient<Schema>();

/** Lambda が「献立と無関係」と判定したときのメッセージ（この文言が含まれるエラーは UI で区別する） */
export const NON_FOOD_ERROR_SNIPPET =
  "食材・献立・料理に関連する内容を入力してください";

export function isNonFoodRelatedErrorMessage(message: string): boolean {
  return message.includes(NON_FOOD_ERROR_SNIPPET);
}

export function parseIngredients(text: string): string[] {
  return text
    .split(/[,、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** AppSync の suggestMenu クエリ（Lambda → Bedrock）を呼び出す。 */
export async function fetchMenuSuggestions(
  ingredientText: string
): Promise<MenuSuggestion[]> {
  const text = ingredientText.trim();
  if (!text) {
    return [
      {
        title: "まずは食材を入れよう",
        uses: [],
        note: "例: 卵、玉ねぎ、しめじ（カンマまたは改行で区切れます）",
      },
    ];
  }

  const { data, errors } = await client.queries.suggestMenu({
    ingredientText: text,
  });

  if (errors?.length) {
    const msg = errors.map((e) => e.message).join(" ");
    throw new Error(msg || "献立の取得に失敗しました");
  }

  if (!data?.title && !data?.recipe) {
    throw new Error("献立データを取得できませんでした");
  }

  const uses = parseIngredients(text);
  return [
    {
      title: data.title ?? "献立",
      uses,
      note: data.recipe ?? "",
    },
  ];
}
