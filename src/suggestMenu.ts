import { generateClient } from "aws-amplify/data";
import { getUrl, remove, uploadData } from "aws-amplify/storage";
import type { Schema } from "../amplify/data/resource";

export type MenuSuggestion = {
  title: string;
  uses: string[];
  note: string;
};

export type RecommendedMenu = MenuSuggestion;

export type MenuHistoryEntry = {
  id: string;
  userId: string;
  ingredientText: string;
  dishTitle: string;
  recipe: string;
  usedIngredients: string[];
  savedAt: string;
};

export type FavoriteMenuEntry = {
  id: string;
  userId: string;
  favoriteKey: string;
  ingredientText: string;
  dishTitle: string;
  recipe: string;
  usedIngredients: string[];
  imagePath: string | null;
  favoritedAt: string;
  sourceHistoryId: string | null;
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
type FavoriteMenuModel = Schema["FavoriteMenu"]["type"];

const client = generateClient<Schema>();
const MAX_FAVORITE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

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

function normalizeFavoriteKeyPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ja-JP");
}

export function normalizeDishTitleKey(dishTitle: string): string {
  return normalizeFavoriteKeyPart(dishTitle);
}

export function buildFavoriteMenuKey(input: {
  dishTitle: string;
  recipe: string;
  usedIngredients: readonly string[];
}): string {
  const title = normalizeFavoriteKeyPart(input.dishTitle);
  const recipe = normalizeFavoriteKeyPart(input.recipe);
  const ingredients = input.usedIngredients
    .map((ingredient) => normalizeFavoriteKeyPart(ingredient))
    .filter(Boolean)
    .join("|");

  return [title, recipe, ingredients].join("::");
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

function looksLikeStructuredIngredientLine(line: string): boolean {
  const cleaned = stripListMarker(line);
  if (!cleaned) {
    return false;
  }

  if (/^(.+?)[：:]\s*(.+)$/.test(cleaned) || /\s\|\s/.test(cleaned)) {
    return true;
  }

  const tokens = cleaned.split(/[\s\u3000]+/).filter(Boolean);
  for (
    let amountTokenCount = Math.min(3, tokens.length - 1);
    amountTokenCount >= 1;
    amountTokenCount -= 1
  ) {
    const amount = tokens.slice(-amountTokenCount).join(" ").trim();
    if (looksLikeAmount(amount)) {
      return true;
    }
  }

  return false;
}

function looksLikeInstructionLine(line: string): boolean {
  const cleaned = stripListMarker(line);
  if (!cleaned) {
    return false;
  }

  if (/[。！？]/.test(cleaned)) {
    return true;
  }

  return /(?:加え|混ぜ|炒め|焼[きく]|煮|茹で|ゆで|揚げ|のせ|載せ|かけ|仕上げ|盛り付け|切り|刻み|熱し|入れ|戻し|蒸し|完成)/.test(
    cleaned
  );
}

function looksLikeSimpleIngredientName(line: string): boolean {
  const cleaned = stripListMarker(line);
  if (!cleaned || looksLikeInstructionLine(cleaned)) {
    return false;
  }

  if (/[：:|。！？]/.test(cleaned)) {
    return false;
  }

  const tokens = cleaned.split(/[\s\u3000]+/).filter(Boolean);
  return tokens.length >= 1 && tokens.length <= 3 && cleaned.length <= 24;
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

  const ingredientCandidates = ingredientLines.filter(
    (line) => !isServingsLine(line) && !looksLikeInstructionLine(line)
  );
  const ingredients =
    ingredientHeaderIndex >= 0
      ? ingredientCandidates
          .filter(
            (line) =>
              looksLikeStructuredIngredientLine(line) ||
              looksLikeSimpleIngredientName(line)
          )
          .map(parseIngredientLine)
          .filter((ingredient) => ingredient.name.length > 0)
      : ingredientCandidates
          .filter(looksLikeStructuredIngredientLine)
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

function normalizeNullableString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFavoriteEntry(
  entry: Partial<FavoriteMenuEntry> & { id?: string | null }
): FavoriteMenuEntry {
  return {
    id: entry.id ?? crypto.randomUUID(),
    userId: entry.userId ?? "",
    favoriteKey: entry.favoriteKey ?? "",
    ingredientText: entry.ingredientText ?? "",
    dishTitle: entry.dishTitle ?? "",
    recipe: entry.recipe ?? "",
    usedIngredients: entry.usedIngredients ?? [],
    imagePath: normalizeNullableString(entry.imagePath),
    favoritedAt: entry.favoritedAt ?? new Date(0).toISOString(),
    sourceHistoryId: normalizeNullableString(entry.sourceHistoryId),
  };
}

function sanitizeFavoriteImageFileName(fileName: string): string {
  const normalized = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "-");
  const trimmed = normalized.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return trimmed || "favorite-image";
}

function buildFavoriteImagePath(
  identityId: string | undefined,
  favoriteId: string,
  fileName: string
): string {
  if (!identityId) {
    throw new Error("画像保存用のユーザー情報を取得できませんでした");
  }

  const safeFileName = sanitizeFavoriteImageFileName(fileName);
  return `favorite-menu-images/${identityId}/${favoriteId}/${Date.now()}-${safeFileName}`;
}

function assertFavoriteImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください");
  }

  if (file.size > MAX_FAVORITE_IMAGE_SIZE_BYTES) {
    throw new Error("画像サイズは5MB以下にしてください");
  }
}

function dedupeFavoritesByDishTitle(entries: FavoriteMenuEntry[]): FavoriteMenuEntry[] {
  const seen = new Set<string>();

  return entries.filter((entry) => {
    const dishKey = normalizeDishTitleKey(entry.dishTitle);
    if (seen.has(dishKey)) {
      return false;
    }

    seen.add(dishKey);
    return true;
  });
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

export async function fetchRecommendedMenus(): Promise<RecommendedMenu[]> {
  const { data, errors } = await client.queries.recommendMenus();

  if (errors?.length) {
    const msg = errors.map((e) => e.message).join(" ");
    throw new Error(msg || "おすすめ料理の取得に失敗しました");
  }

  const items = (data ?? [])
    .filter(
      (
        item
      ): item is {
        title?: string | null;
        recipe?: string | null;
      } => Boolean(item)
    )
    .map((item) => ({
      title: item.title?.trim() || "おすすめ料理",
      uses: [],
      note: item.recipe?.trim() || "",
    }))
    .filter((item) => item.title.length > 0 || item.note.length > 0);

  if (items.length === 0) {
    throw new Error("おすすめ料理データを取得できませんでした");
  }

  return items;
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

async function listFavoritePage(
  userId: string,
  limit = 50,
  nextToken?: string | null
) {
  const response =
    await client.models.FavoriteMenu.listFavoriteMenuByUserIdAndFavoritedAt(
      {
        userId,
      },
      {
        authMode: "userPool",
        limit,
        nextToken: nextToken ?? undefined,
        sortDirection: "DESC",
      }
    );
  const { data, errors } = response;

  if (errors?.length) {
    const msg = errors.map((e: { message: string }) => e.message).join(" ");
    throw new Error(msg || "お気に入りの取得に失敗しました");
  }

  const responseNextToken =
    "nextToken" in response && typeof response.nextToken === "string"
      ? response.nextToken
      : null;

  return {
    items: (data ?? []).map((entry: FavoriteMenuModel) =>
      normalizeFavoriteEntry({
        id: entry.id,
        userId: entry.userId,
        favoriteKey: entry.favoriteKey,
        ingredientText: entry.ingredientText,
        dishTitle: entry.dishTitle,
        recipe: entry.recipe,
        usedIngredients: normalizeStringArray(entry.usedIngredients),
        imagePath: entry.imagePath,
        favoritedAt: entry.favoritedAt,
        sourceHistoryId: entry.sourceHistoryId,
      })
    ),
    nextToken: responseNextToken,
  };
}

async function fetchAllFavoritesForUser(userId: string): Promise<FavoriteMenuEntry[]> {
  const allFavorites: FavoriteMenuEntry[] = [];
  let nextToken: string | null = null;

  do {
    const page = await listFavoritePage(userId, 100, nextToken);
    allFavorites.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);

  return allFavorites;
}

export async function createFavorite(input: {
  userId: string;
  ingredientText: string;
  dishTitle: string;
  recipe: string;
  usedIngredients: readonly string[];
  sourceHistoryId?: string | null;
}): Promise<FavoriteMenuEntry> {
  const favoriteKey = buildFavoriteMenuKey({
    dishTitle: input.dishTitle,
    recipe: input.recipe,
    usedIngredients: input.usedIngredients,
  });
  const existingFavorites = await fetchAllFavoritesForUser(input.userId);
  const dishKey = normalizeDishTitleKey(input.dishTitle);

  if (
    existingFavorites.some(
      (entry) => normalizeDishTitleKey(entry.dishTitle) === dishKey
    )
  ) {
    throw new Error("この料理は既にお気に入り登録されています");
  }

  const favoritedAt = new Date().toISOString();
  const { data, errors } = await client.models.FavoriteMenu.create(
    {
      userId: input.userId,
      favoriteKey,
      ingredientText: input.ingredientText.trim(),
      dishTitle: input.dishTitle,
      recipe: input.recipe,
      usedIngredients: [...input.usedIngredients],
      imagePath: null,
      favoritedAt,
      sourceHistoryId: normalizeNullableString(input.sourceHistoryId),
    },
    {
      authMode: "userPool",
    }
  );

  if (errors?.length) {
    const msg = errors.map((e) => e.message).join(" ");
    throw new Error(msg || "お気に入りの保存に失敗しました");
  }

  if (!data) {
    throw new Error("お気に入りを保存できませんでした");
  }

  return normalizeFavoriteEntry({
    id: data.id,
    userId: data.userId,
    favoriteKey: data.favoriteKey,
    ingredientText: data.ingredientText,
    dishTitle: data.dishTitle,
    recipe: data.recipe,
    usedIngredients: normalizeStringArray(data.usedIngredients),
    imagePath: data.imagePath,
    favoritedAt: data.favoritedAt ?? favoritedAt,
    sourceHistoryId: data.sourceHistoryId,
  });
}

export async function deleteFavorite(
  userId: string,
  dishTitle: string
): Promise<void> {
  const dishKey = normalizeDishTitleKey(dishTitle);
  const existingFavorites = await fetchAllFavoritesForUser(userId);
  const targets = existingFavorites.filter(
    (entry) => normalizeDishTitleKey(entry.dishTitle) === dishKey
  );

  if (targets.length === 0) {
    return;
  }

  for (const target of targets) {
    if (target.imagePath) {
      await remove({
        path: target.imagePath,
      });
    }

    const { errors } = await client.models.FavoriteMenu.delete(
      {
        id: target.id,
      },
      {
        authMode: "userPool",
      }
    );

    if (errors?.length) {
      const msg = errors.map((e) => e.message).join(" ");
      throw new Error(msg || "お気に入りの解除に失敗しました");
    }
  }
}

export async function fetchFavorites(
  userId: string,
  limit = 20,
  nextToken?: string | null
): Promise<{ items: FavoriteMenuEntry[]; nextToken: string | null }> {
  const page = await listFavoritePage(userId, limit, nextToken);

  return {
    items: dedupeFavoritesByDishTitle(page.items),
    nextToken: page.nextToken,
  };
}

export async function getFavoriteImageUrl(imagePath: string): Promise<string> {
  const { url } = await getUrl({
    path: imagePath,
    options: {
      validateObjectExistence: true,
      expiresIn: 60 * 60,
    },
  });

  return url.toString();
}

export async function uploadFavoriteImage(input: {
  favoriteId: string;
  imageFile: File;
  existingImagePath?: string | null;
}): Promise<FavoriteMenuEntry> {
  assertFavoriteImageFile(input.imageFile);

  const uploadTask = uploadData({
    path: ({ identityId }) =>
      buildFavoriteImagePath(identityId, input.favoriteId, input.imageFile.name),
    data: input.imageFile,
    options: {
      contentType: input.imageFile.type,
    },
  });

  const result = await uploadTask.result;

  try {
    const { data, errors } = await client.models.FavoriteMenu.update(
      {
        id: input.favoriteId,
        imagePath: result.path,
      },
      {
        authMode: "userPool",
      }
    );

    if (errors?.length) {
      const msg = errors.map((e) => e.message).join(" ");
      throw new Error(msg || "お気に入り画像の保存に失敗しました");
    }

    if (!data) {
      throw new Error("お気に入り画像を保存できませんでした");
    }

    if (input.existingImagePath && input.existingImagePath !== result.path) {
      await remove({
        path: input.existingImagePath,
      });
    }

    return normalizeFavoriteEntry({
      id: data.id,
      userId: data.userId,
      favoriteKey: data.favoriteKey,
      ingredientText: data.ingredientText,
      dishTitle: data.dishTitle,
      recipe: data.recipe,
      usedIngredients: normalizeStringArray(data.usedIngredients),
      imagePath: data.imagePath,
      favoritedAt: data.favoritedAt,
      sourceHistoryId: data.sourceHistoryId,
    });
  } catch (error) {
    await remove({
      path: result.path,
    }).catch(() => undefined);
    throw error;
  }
}

export async function removeFavoriteImage(input: {
  favoriteId: string;
  imagePath: string;
}): Promise<FavoriteMenuEntry> {
  await remove({
    path: input.imagePath,
  });

  const { data, errors } = await client.models.FavoriteMenu.update(
    {
      id: input.favoriteId,
      imagePath: null,
    },
    {
      authMode: "userPool",
    }
  );

  if (errors?.length) {
    const msg = errors.map((e) => e.message).join(" ");
    throw new Error(msg || "お気に入り画像の削除に失敗しました");
  }

  if (!data) {
    throw new Error("お気に入り画像を削除できませんでした");
  }

  return normalizeFavoriteEntry({
    id: data.id,
    userId: data.userId,
    favoriteKey: data.favoriteKey,
    ingredientText: data.ingredientText,
    dishTitle: data.dishTitle,
    recipe: data.recipe,
    usedIngredients: normalizeStringArray(data.usedIngredients),
    imagePath: data.imagePath,
    favoritedAt: data.favoritedAt,
    sourceHistoryId: data.sourceHistoryId,
  });
}
