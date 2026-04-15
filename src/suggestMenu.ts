import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

export type MenuSuggestion = {
  title: string;
  uses: string[];
  note: string;
};

export type MenuHistoryEntry = {
  id: string;
  userId: string;
  ingredientText: string;
  dishTitle: string;
  recipe: string;
  usedIngredients: string[];
  savedAt: string;
};

export type RecipeIngredient = {
  name: string;
  amount: string;
};

export type StructuredRecipe = {
  ingredients: RecipeIngredient[];
  steps: string[];
};

type MenuHistoryModel = Schema["MenuHistory"]["type"];

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

function normalizeRecipeLines(recipe: string): string[] {
  return recipe
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*・]|[0-9０-９]+[.)．、]?)\s*/, "").trim();
}

function isServingsLine(line: string): boolean {
  return /^[（(]?\s*\d+\s*人分\s*[）)]?$/.test(line);
}

function isIngredientHeader(line: string): boolean {
  return /^【?\s*材料(?:・調味料)?/.test(line);
}

function isStepHeader(line: string): boolean {
  return /^【?\s*(?:手順|作り方|レシピ)/.test(line);
}

function looksLikeAmount(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return /^(?:約\s*)?(?:(?:大さじ|小さじ)\s*\d+(?:\s*\/\s*\d+)?|(?:\d+|[０-９]+)(?:\s*\/\s*(?:\d+|[０-９]+))?(?:\.\d+)?(?:\s*(?:g|kg|mg|ml|mL|cc|l|L|リットル|カップ|個|玉|本|枚|袋|パック|缶|片|房|束|合|かけ|切れ|尾|杯|滴|cm))|(?:\d+|[０-９]+)(?:\s*[〜~-]\s*(?:\d+|[０-９]+))?\s*(?:個|本|枚|玉|袋|パック|缶)|少々|適量|ひとつまみ|お好みで|適宜)$/.test(
    normalized
  );
}

function parseIngredientLine(line: string): RecipeIngredient {
  const cleaned = stripListMarker(line);
  const pipeParts = cleaned.split(/\s*\|\s*/);
  if (pipeParts.length >= 2) {
    return {
      name: pipeParts[0]?.trim() ?? "",
      amount: pipeParts.slice(1).join(" | ").trim(),
    };
  }

  const colonMatch = cleaned.match(/^(.+?)[：:]\s*(.+)$/);
  if (colonMatch) {
    return {
      name: colonMatch[1]?.trim() ?? "",
      amount: colonMatch[2]?.trim() ?? "",
    };
  }

  const tokens = cleaned.split(/[\s\u3000]+/).filter(Boolean);
  for (let amountTokenCount = Math.min(3, tokens.length - 1); amountTokenCount >= 1; amountTokenCount -= 1) {
    const name = tokens.slice(0, -amountTokenCount).join(" ").trim();
    const amount = tokens.slice(-amountTokenCount).join(" ").trim();
    if (name && looksLikeAmount(amount)) {
      return { name, amount };
    }
  }

  const compactAmountMatch = cleaned.match(
    /^(.+?)((?:約\s*)?(?:(?:大さじ|小さじ)\s*\d+(?:\s*\/\s*\d+)?|(?:\d+|[０-９]+)(?:\s*\/\s*(?:\d+|[０-９]+))?(?:\.\d+)?(?:g|kg|mg|ml|mL|cc|l|L|リットル|カップ|個|玉|本|枚|袋|パック|缶|片|房|束|合|かけ|切れ|尾|杯|滴|cm)|少々|適量|ひとつまみ|お好みで|適宜))$/
  );
  if (compactAmountMatch) {
    return {
      name: compactAmountMatch[1]?.trim() ?? cleaned,
      amount: compactAmountMatch[2]?.trim() ?? "",
    };
  }

  return { name: cleaned, amount: "" };
}

export function parseSuggestedRecipe(recipe: string): StructuredRecipe {
  const lines = normalizeRecipeLines(recipe);
  const ingredientHeaderIndex = lines.findIndex(isIngredientHeader);
  const stepHeaderIndex = lines.findIndex(isStepHeader);

  const ingredientLines =
    ingredientHeaderIndex >= 0
      ? lines.slice(
          ingredientHeaderIndex + 1,
          stepHeaderIndex > ingredientHeaderIndex ? stepHeaderIndex : undefined
        )
      : stepHeaderIndex > 0
        ? lines.slice(0, stepHeaderIndex)
        : [];

  const stepLines =
    stepHeaderIndex >= 0
      ? lines.slice(stepHeaderIndex + 1)
      : lines.filter((line) => /^\s*(?:[0-9０-９]+[.)．、]?)/.test(line));

  const ingredients = ingredientLines
    .filter((line) => !isServingsLine(line))
    .map(parseIngredientLine)
    .filter((ingredient) => ingredient.name.length > 0);

  const steps = stepLines
    .map(stripListMarker)
    .filter((line) => line.length > 0 && !isIngredientHeader(line));

  if (ingredients.length > 0 || steps.length > 0) {
    return { ingredients, steps };
  }

  return {
    ingredients: [],
    steps: lines,
  };
}

function normalizeHistoryEntry(
  entry: Partial<MenuHistoryEntry> & { id?: string | null }
): MenuHistoryEntry {
  return {
    id: entry.id ?? crypto.randomUUID(),
    userId: entry.userId ?? "",
    ingredientText: entry.ingredientText ?? "",
    dishTitle: entry.dishTitle ?? "",
    recipe: entry.recipe ?? "",
    usedIngredients: entry.usedIngredients ?? [],
    savedAt: entry.savedAt ?? new Date(0).toISOString(),
  };
}

function normalizeStringArray(
  values: ReadonlyArray<string | null | undefined> | null | undefined
): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string");
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

export async function saveMenuHistory(input: {
  userId: string;
  ingredientText: string;
  suggestion: MenuSuggestion;
}): Promise<MenuHistoryEntry> {
  const savedAt = new Date().toISOString();
  const { data, errors } = await client.models.MenuHistory.create(
    {
      userId: input.userId,
      ingredientText: input.ingredientText.trim(),
      dishTitle: input.suggestion.title,
      recipe: input.suggestion.note,
      usedIngredients: input.suggestion.uses,
      savedAt,
    },
    {
      authMode: "userPool",
    }
  );

  if (errors?.length) {
    const msg = errors.map((e) => e.message).join(" ");
    throw new Error(msg || "履歴の保存に失敗しました");
  }

  if (!data) {
    throw new Error("履歴を保存できませんでした");
  }

  return normalizeHistoryEntry({
    id: data.id,
    userId: data.userId,
    ingredientText: data.ingredientText,
    dishTitle: data.dishTitle,
    recipe: data.recipe,
    usedIngredients: normalizeStringArray(data.usedIngredients),
    savedAt: data.savedAt ?? savedAt,
  });
}

export async function fetchMenuHistory(
  userId: string,
  limit = 10
): Promise<MenuHistoryEntry[]> {
  const { data, errors } =
    await client.models.MenuHistory.listMenuHistoryByUserIdAndSavedAt(
      {
        userId,
      },
      {
        authMode: "userPool",
        limit,
        sortDirection: "DESC",
      }
    );

  if (errors?.length) {
    const msg = errors.map((e: { message: string }) => e.message).join(" ");
    throw new Error(msg || "履歴の取得に失敗しました");
  }

  return (data ?? []).map((entry: MenuHistoryModel) =>
    normalizeHistoryEntry({
      id: entry.id,
      userId: entry.userId,
      ingredientText: entry.ingredientText,
      dishTitle: entry.dishTitle,
      recipe: entry.recipe,
      usedIngredients: normalizeStringArray(entry.usedIngredients),
      savedAt: entry.savedAt,
    })
  );
}
