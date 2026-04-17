import { type ChangeEvent, type MouseEvent, useEffect, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  buildFavoriteMenuKey,
  createFavorite,
  deleteMenuHistory,
  deleteFavorite,
  type CuisinePreference,
  fetchFavorites,
  type MenuHistoryEntry,
  type MenuSuggestion,
  type FavoriteMenuEntry,
  fetchMenuHistory,
  getFavoriteImageUrl,
  fetchMenuSuggestions,
  isNonFoodRelatedErrorMessage,
  normalizeDishTitleKey,
  parseIngredients,
  parseSuggestedRecipe,
  removeFavoriteImage,
  saveMenuHistory,
  uploadFavoriteImage,
} from "./suggestMenu";
import "./App.css";

function getCurrentUserId(user: unknown): string | null {
  if (!user || typeof user !== "object") {
    return null;
  }

  const authUser = user as {
    userId?: unknown;
    username?: unknown;
    signInDetails?: { loginId?: unknown };
  };

  const candidates = [
    authUser.userId,
    authUser.username,
    authUser.signInDetails?.loginId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function formatHistoryDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

type FavoriteSource = {
  ingredientText: string;
  dishTitle: string;
  estimatedCalories: number | null;
  recipe: string;
  usedIngredients: string[];
  servings: number;
  cuisinePreference: CuisinePreference;
  targetCalories: number | null;
  sourceHistoryId?: string | null;
};

type ResultsView = "suggestions" | "favorites";

type DisplayIngredient = {
  name: string;
  amount: string;
};

const CUISINE_OPTIONS: Array<{ value: CuisinePreference; label: string }> = [
  { value: "default", label: "指定なし" },
  { value: "washoku", label: "和食" },
  { value: "yoshoku", label: "洋食" },
  { value: "chuka", label: "中華" },
  { value: "italian", label: "イタリアン" },
  { value: "french", label: "フレンチ" },
  { value: "ethnic", label: "エスニック" },
];

function createFavoriteSourceFromHistory(entry: MenuHistoryEntry): FavoriteSource {
  return {
    ingredientText: entry.ingredientText,
    dishTitle: entry.dishTitle,
    estimatedCalories: entry.estimatedCalories,
    recipe: entry.recipe,
    usedIngredients: entry.usedIngredients,
    servings: entry.servings,
    cuisinePreference: entry.cuisinePreference,
    targetCalories: entry.targetCalories,
    sourceHistoryId: entry.id,
  };
}

function createFavoriteSourceFromSuggestion(
  suggestion: MenuSuggestion,
  ingredientText: string,
  sourceHistoryId?: string | null
): FavoriteSource {
  return {
    ingredientText,
    dishTitle: suggestion.title,
    estimatedCalories: suggestion.estimatedCalories,
    recipe: suggestion.note,
    usedIngredients: suggestion.uses,
    servings: suggestion.servings,
    cuisinePreference: suggestion.cuisinePreference,
    targetCalories: suggestion.targetCalories,
    sourceHistoryId,
  };
}

function formatServingsLabel(servings: number): string {
  const normalized = Number.isInteger(servings) && servings > 0 ? servings : 1;
  return `${normalized}人前`;
}

function formatCuisineLabel(cuisinePreference: CuisinePreference): string {
  return (
    CUISINE_OPTIONS.find((option) => option.value === cuisinePreference)?.label ??
    "指定なし"
  );
}

function formatTargetCaloriesLabel(targetCalories: number | null | undefined): string | null {
  return typeof targetCalories === "number" && targetCalories > 0
    ? `${targetCalories}kcal前後`
    : null;
}

function formatEstimatedCaloriesLabel(
  estimatedCalories: number | null | undefined
): string | null {
  return typeof estimatedCalories === "number" && estimatedCalories > 0
    ? `${estimatedCalories}kcal`
    : null;
}

function renderRecipeLayout(input: {
  ingredients: DisplayIngredient[];
  steps: string[];
  fallbackRecipe: string;
  keyPrefix: string;
  hideStepDividers?: boolean;
}) {
  const rowCount = Math.max(input.ingredients.length, input.steps.length, 1);
  const tableClassName = input.hideStepDividers
    ? "menu-app__recipe-table menu-app__recipe-table--merged-steps"
    : "menu-app__recipe-table";

  return (
    <div className="menu-app__recipe-layout">
      <table className={tableClassName}>
        <thead>
          <tr>
            <th scope="col">材料名</th>
            <th scope="col">分量</th>
            <th scope="col">レシピ</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, idx) => {
            const ingredient = input.ingredients[idx];
            const step = input.steps[idx];
            const fallbackStep = idx === 0 ? input.fallbackRecipe : "";

            return (
              <tr key={`${input.keyPrefix}-row-${idx}`}>
                <td>{ingredient?.name || (idx === 0 ? "-" : "")}</td>
                <td className="menu-app__recipe-table-amount">
                  {ingredient?.amount || (ingredient ? "-" : idx === 0 ? "-" : "")}
                </td>
                <td>
                  {step ? (
                    <span className="menu-app__recipe-step-text">{`${idx + 1}. ${step}`}</span>
                  ) : (
                    fallbackStep
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const { user, signOut } = useAuthenticator();
  const location = useLocation();
  const [ingredientText, setIngredientText] = useState("");
  const [servingsInput, setServingsInput] = useState("1");
  const [cuisinePreference, setCuisinePreference] =
    useState<CuisinePreference>("default");
  const [targetCaloriesInput, setTargetCaloriesInput] = useState("");
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [history, setHistory] = useState<MenuHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteMenuEntry[]>([]);
  const [hasRequested, setHasRequested] = useState(false);
  const [resultsView, setResultsView] = useState<ResultsView>("suggestions");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favoritePendingKeys, setFavoritePendingKeys] = useState<string[]>([]);
  const [historyDeletePendingIds, setHistoryDeletePendingIds] = useState<string[]>([]);
  const [favoritesNextToken, setFavoritesNextToken] = useState<string | null>(null);
  const [favoriteImageUrls, setFavoriteImageUrls] = useState<Record<string, string>>({});
  const [favoriteImagePendingIds, setFavoriteImagePendingIds] = useState<string[]>([]);
  const [suggestionHistoryIds, setSuggestionHistoryIds] = useState<Record<string, string | null>>({});
  const currentUserId = getCurrentUserId(user);
  const isHistoryPage = location.pathname === "/history";
  const favoriteDishKeySet = new Set(
    favorites.map((entry) => normalizeDishTitleKey(entry.dishTitle))
  );

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!currentUserId) {
        setHistory([]);
        setFavorites([]);
        setHistoryError(null);
        setFavoritesError(null);
        setHistoryLoading(false);
        setFavoritesLoading(false);
        setFavoritesNextToken(null);
        return;
      }

      setHistoryLoading(true);
      setFavoritesLoading(true);
      setHistoryError(null);
      setFavoritesError(null);

      const [historyResult, favoritesResult] = await Promise.allSettled([
        fetchMenuHistory(currentUserId),
        fetchFavorites(currentUserId),
      ]);

      if (cancelled) {
        return;
      }

      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
      } else {
        setHistory([]);
        setHistoryError(
          historyResult.reason instanceof Error
            ? historyResult.reason.message
            : "履歴の取得に失敗しました"
        );
      }

      if (favoritesResult.status === "fulfilled") {
        setFavorites(favoritesResult.value.items);
        setFavoritesNextToken(favoritesResult.value.nextToken);
      } else {
        setFavorites([]);
        setFavoritesNextToken(null);
        setFavoritesError(
          favoritesResult.reason instanceof Error
            ? favoritesResult.reason.message
            : "お気に入りの取得に失敗しました"
        );
      }

      setHistoryLoading(false);
      setFavoritesLoading(false);
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadFavoriteImages() {
      const entries = await Promise.all(
        favorites.map(async (entry) => {
          if (!entry.imagePath) {
            return [entry.id, null] as const;
          }

          try {
            const url = await getFavoriteImageUrl(entry.imagePath);
            return [entry.id, url] as const;
          } catch {
            return [entry.id, null] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setFavoriteImageUrls(
        Object.fromEntries(
          entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
        )
      );
    }

    void loadFavoriteImages();

    return () => {
      cancelled = true;
    };
  }, [favorites]);

  if (location.pathname !== "/" && !isHistoryPage) {
    return <Navigate to="/" replace />;
  }

  function beginFavoriteToggle(favoriteKey: string) {
    setFavoritePendingKeys((prev) =>
      prev.includes(favoriteKey) ? prev : [...prev, favoriteKey]
    );
  }

  function finishFavoriteToggle(favoriteKey: string) {
    setFavoritePendingKeys((prev) => prev.filter((key) => key !== favoriteKey));
  }

  function beginFavoriteImageChange(favoriteId: string) {
    setFavoriteImagePendingIds((prev) =>
      prev.includes(favoriteId) ? prev : [...prev, favoriteId]
    );
  }

  function finishFavoriteImageChange(favoriteId: string) {
    setFavoriteImagePendingIds((prev) => prev.filter((id) => id !== favoriteId));
  }

  function beginHistoryDelete(historyId: string) {
    setHistoryDeletePendingIds((prev) =>
      prev.includes(historyId) ? prev : [...prev, historyId]
    );
  }

  function finishHistoryDelete(historyId: string) {
    setHistoryDeletePendingIds((prev) => prev.filter((id) => id !== historyId));
  }

  async function toggleFavorite(source: FavoriteSource) {
    if (!currentUserId) {
      setFavoritesError("ユーザー情報を確認できないため、お気に入りを更新できませんでした");
      return;
    }

    const favoriteDishKey = normalizeDishTitleKey(source.dishTitle);

    beginFavoriteToggle(favoriteDishKey);
    setFavoritesError(null);

    try {
      if (favoriteDishKeySet.has(favoriteDishKey)) {
        await deleteFavorite(currentUserId, source.dishTitle);
        setFavorites((prev) =>
          prev.filter(
            (entry) => normalizeDishTitleKey(entry.dishTitle) !== favoriteDishKey
          )
        );
      } else {
        const favorite = await createFavorite({
          userId: currentUserId,
          ingredientText: source.ingredientText,
          dishTitle: source.dishTitle,
          estimatedCalories: source.estimatedCalories,
          recipe: source.recipe,
          usedIngredients: source.usedIngredients,
          servings: source.servings,
          cuisinePreference: source.cuisinePreference,
          targetCalories: source.targetCalories,
          sourceHistoryId: source.sourceHistoryId,
        });

        setFavorites((prev) => [
          favorite,
          ...prev.filter(
            (entry) =>
              normalizeDishTitleKey(entry.dishTitle) !== favoriteDishKey
          ),
        ]);
      }
    } catch (e) {
      setFavoritesError(
        e instanceof Error ? e.message : "お気に入りの更新に失敗しました"
      );
    } finally {
      finishFavoriteToggle(favoriteDishKey);
    }
  }

  function handleHistoryFavoriteClick(
    event: MouseEvent<HTMLButtonElement>,
    entry: MenuHistoryEntry
  ) {
    event.preventDefault();
    event.stopPropagation();
    void toggleFavorite(createFavoriteSourceFromHistory(entry));
  }

  function handleFavoriteToggleClick(
    event: MouseEvent<HTMLButtonElement>,
    source: FavoriteSource
  ) {
    event.preventDefault();
    event.stopPropagation();
    void toggleFavorite(source);
  }

  function isFavoritePending(favoriteKey: string): boolean {
    return favoritePendingKeys.includes(favoriteKey);
  }

  function isFavoriteImagePending(favoriteId: string): boolean {
    return favoriteImagePendingIds.includes(favoriteId);
  }

  function isHistoryDeletePending(historyId: string): boolean {
    return historyDeletePendingIds.includes(historyId);
  }

  async function handleFavoriteImageSelection(
    entry: FavoriteMenuEntry,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    beginFavoriteImageChange(entry.id);
    setFavoritesError(null);

    try {
      const updated = await uploadFavoriteImage({
        favoriteId: entry.id,
        imageFile: file,
        existingImagePath: entry.imagePath,
      });
      const nextUrl = updated.imagePath
        ? await getFavoriteImageUrl(updated.imagePath)
        : null;

      setFavorites((prev) =>
        prev.map((favorite) => (favorite.id === entry.id ? updated : favorite))
      );
      setFavoriteImageUrls((prev) =>
        nextUrl
          ? {
              ...prev,
              [entry.id]: nextUrl,
            }
          : omitRecordKey(prev, entry.id)
      );
    } catch (e) {
      setFavoritesError(
        e instanceof Error ? e.message : "お気に入り画像の保存に失敗しました"
      );
    } finally {
      finishFavoriteImageChange(entry.id);
    }
  }

  async function handleFavoriteImageRemove(
    event: MouseEvent<HTMLButtonElement>,
    entry: FavoriteMenuEntry
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (!entry.imagePath) {
      return;
    }

    beginFavoriteImageChange(entry.id);
    setFavoritesError(null);

    try {
      const updated = await removeFavoriteImage({
        favoriteId: entry.id,
        imagePath: entry.imagePath,
      });

      setFavorites((prev) =>
        prev.map((favorite) => (favorite.id === entry.id ? updated : favorite))
      );
      setFavoriteImageUrls((prev) => omitRecordKey(prev, entry.id));
    } catch (e) {
      setFavoritesError(
        e instanceof Error ? e.message : "お気に入り画像の削除に失敗しました"
      );
    } finally {
      finishFavoriteImageChange(entry.id);
    }
  }

  async function handleHistoryDeleteClick(
    event: MouseEvent<HTMLButtonElement>,
    entry: MenuHistoryEntry
  ) {
    event.preventDefault();
    event.stopPropagation();

    beginHistoryDelete(entry.id);
    setHistoryError(null);

    try {
      await deleteMenuHistory(entry.id);
      setHistory((prev) => prev.filter((historyEntry) => historyEntry.id !== entry.id));
      setFavorites((prev) =>
        prev.map((favorite) =>
          favorite.sourceHistoryId === entry.id
            ? { ...favorite, sourceHistoryId: null }
            : favorite
        )
      );
      setSuggestionHistoryIds((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([key, value]) => [
            key,
            value === entry.id ? null : value,
          ])
        )
      );
    } catch (e) {
      setHistoryError(
        e instanceof Error ? e.message : "履歴の削除に失敗しました"
      );
    } finally {
      finishHistoryDelete(entry.id);
    }
  }

  async function handleSuggest() {
    setError(null);

    const text = ingredientText.trim();
    if (!text) {
      setError("食材を入力してください");
      setSuggestions([]);
      setHasRequested(false);
      return;
    }

    const parsedServings = Number(servingsInput);
    if (!Number.isInteger(parsedServings) || parsedServings < 1) {
      setError("人数は1以上の整数で入力してください");
      return;
    }

    const parsedTargetCalories = targetCaloriesInput.trim()
      ? Number(targetCaloriesInput)
      : null;
    if (
      parsedTargetCalories !== null &&
      (!Number.isInteger(parsedTargetCalories) || parsedTargetCalories < 1)
    ) {
      setError("カロリーは1以上の整数で入力してください");
      return;
    }

    setLoading(true);
    setHasRequested(true);
    try {
      const next = await fetchMenuSuggestions(
        text,
        parsedServings,
        cuisinePreference,
        parsedTargetCalories
      );
      setSuggestions(next);
      setResultsView("suggestions");
      setSuggestionHistoryIds(
        Object.fromEntries(
          next.map((suggestion) => [
            buildFavoriteMenuKey({
              dishTitle: suggestion.title,
              recipe: suggestion.note,
              usedIngredients: suggestion.uses,
            }),
            null,
          ])
        )
      );

      if (currentUserId && next.length > 0) {
        try {
          const saved = await saveMenuHistory({
            userId: currentUserId,
            ingredientText: text,
            suggestion: next[0],
          });

          setHistory((prev) =>
            [saved, ...prev.filter((entry) => entry.id !== saved.id)].slice(0, 10)
          );
          setSuggestionHistoryIds((prev) => ({
            ...prev,
            [buildFavoriteMenuKey({
              dishTitle: saved.dishTitle,
              recipe: saved.recipe,
              usedIngredients: saved.usedIngredients,
            })]: saved.id,
          }));
          setHistoryError(null);
        } catch (historySaveError) {
          setHistoryError(
            historySaveError instanceof Error
              ? historySaveError.message
              : "履歴の保存に失敗しました"
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提案に失敗しました");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  function handleClearInput() {
    setIngredientText("");
    setError(null);
  }

  const loginId = user?.signInDetails?.loginId ?? "あなた";
  const historySectionContent = (
    <>
      <div className="menu-app__history-head">
        <h2 className="menu-app__results-heading">履歴</h2>
        <p className="menu-app__history-caption">最新10件を表示</p>
      </div>

      {historyError ? (
        <p className="menu-app__history-message" role="status">
          {historyError}
        </p>
      ) : null}

      {historyLoading ? (
        <p className="menu-app__loading-results" aria-live="polite">
          履歴を読み込んでいます…
        </p>
      ) : history.length === 0 ? (
        <p className="menu-app__empty-body menu-app__empty-body--solo">
          まだ履歴がありません。献立を提案すると、ここに保存されます。
        </p>
      ) : (
        <ol className="menu-app__cards">
          {history.map((entry) => {
            const structured = parseSuggestedRecipe(entry.recipe);
            const favoriteDishKey = normalizeDishTitleKey(entry.dishTitle);
            const displayIngredients =
              structured.ingredients.length > 0
                ? structured.ingredients
                : (entry.usedIngredients.length > 0
                    ? entry.usedIngredients
                    : parseIngredients(entry.ingredientText)
                  ).map((name) => ({ name, amount: "" }));

            return (
              <li key={entry.id} className="menu-app__card">
                <details className="menu-app__history-details">
                  <summary className="menu-app__history-summary">
                    <div className="menu-app__history-meta">
                      <div className="menu-app__history-main">
                        <h3 className="menu-app__card-title">
                          <span className="menu-app__card-title-row">
                            <span>{entry.dishTitle}({formatServingsLabel(entry.servings)})</span>
                            {entry.cuisinePreference !== "default" ? (
                              <span className="menu-app__cuisine-badge">
                                {formatCuisineLabel(entry.cuisinePreference)}
                              </span>
                            ) : null}
                          </span>
                        </h3>
                        {formatEstimatedCaloriesLabel(entry.estimatedCalories) ? (
                          <p className="menu-app__estimated-calories">
                            {formatEstimatedCaloriesLabel(entry.estimatedCalories)}
                          </p>
                        ) : null}
                        <time
                          className="menu-app__history-time"
                          dateTime={entry.savedAt}
                        >
                          {formatHistoryDate(entry.savedAt)}
                        </time>
                        <button
                          type="button"
                          className={
                            favoriteDishKeySet.has(favoriteDishKey)
                              ? "menu-app__favorite-btn menu-app__favorite-btn--active"
                              : "menu-app__favorite-btn"
                          }
                          aria-label={
                            favoriteDishKeySet.has(favoriteDishKey)
                              ? "お気に入りを解除"
                              : "お気に入りに追加"
                          }
                          aria-pressed={favoriteDishKeySet.has(favoriteDishKey)}
                          disabled={isFavoritePending(favoriteDishKey)}
                          onClick={(event) =>
                            handleHistoryFavoriteClick(event, entry)
                          }
                        >
                          {favoriteDishKeySet.has(favoriteDishKey) ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  </summary>
                  <div className="menu-app__card-body menu-app__history-content">
                    <p className="menu-app__history-input">
                      入力食材: {entry.ingredientText}
                    </p>
                    {formatTargetCaloriesLabel(entry.targetCalories) ? (
                      <p className="menu-app__history-meta-text">
                        カロリー条件: {formatTargetCaloriesLabel(entry.targetCalories)}
                      </p>
                    ) : null}
                    {renderRecipeLayout({
                      ingredients: displayIngredients,
                      steps: structured.steps,
                      fallbackRecipe: entry.recipe,
                      keyPrefix: entry.id,
                    })}
                  </div>
                </details>
                <button
                  type="button"
                  className="menu-app__history-delete-btn"
                  disabled={isHistoryDeletePending(entry.id)}
                  onClick={(event) => void handleHistoryDeleteClick(event, entry)}
                >
                  {isHistoryDeletePending(entry.id) ? "削除中…" : "削除"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );

  return (
    <div className="menu-app__shell menu-app__shell--single-page">
      <main
        className={
          isHistoryPage
            ? "menu-app menu-app--history-page"
            : "menu-app"
        }
      >
        <div
          className={
            isHistoryPage
              ? "menu-app__main-inner menu-app__main-inner--history-page"
              : "menu-app__main-inner"
          }
        >
          <header
            className={
              isHistoryPage
                ? "menu-app__header menu-app__header--history-page"
                : "menu-app__header"
            }
          >
            <p className="menu-app__eyebrow">余りもので</p>
            <h1 className="menu-app__title">
              {isHistoryPage ? "履歴一覧" : "献立提案"}
            </h1>
            <p className="menu-app__subtitle">
              <span className="menu-app__subtitle-name">{loginId}</span>
              さんの{isHistoryPage ? "履歴" : "キッチン"}
            </p>
            <div className="menu-app__header-actions">
              {isHistoryPage ? (
                <Link to="/" className="menu-app__secondary-btn">
                  献立提案へ戻る
                </Link>
              ) : (
                <Link to="/history" className="menu-app__secondary-btn">
                  履歴を見る
                </Link>
              )}
            </div>
          </header>

          {isHistoryPage ? (
            <>
              <section
                className="menu-app__panel menu-app__panel--history-page"
                aria-label="提案履歴一覧"
              >
                {historySectionContent}
              </section>

              <footer className="menu-app__footer">
                <button
                  type="button"
                  className="menu-app__signout"
                  onClick={signOut}
                >
                  サインアウト
                </button>
              </footer>
            </>
          ) : (
            <>
          <section
            className="menu-app__panel menu-app__panel--input"
            aria-label="食材の入力"
            aria-busy={loading}
          >
            <div className="menu-app__panel-head">
              {ingredientText.trim().length > 0 ? (
                <button
                  type="button"
                  className="menu-app__text-btn"
                  onClick={handleClearInput}
                >
                  入力をクリア
                </button>
              ) : null}
            </div>
            <div className="menu-app__field-row">
              <label htmlFor="servings" className="menu-app__label">
                量
              </label>
              <div className="menu-app__control-group">
                <span className="menu-app__control-spacer" aria-hidden>
                  1人あたり
                </span>
                <input
                  id="servings"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  className="menu-app__number-input"
                  value={servingsInput}
                  onChange={(event) => setServingsInput(event.target.value)}
                  disabled={loading}
                />
                <span className="menu-app__number-unit">人分</span>
              </div>
            </div>
            <div className="menu-app__field-row">
              <label htmlFor="cuisine-preference" className="menu-app__label">
                ジャンル
              </label>
              <div className="menu-app__control-group">
                <span className="menu-app__control-spacer" aria-hidden>
                  1人あたり
                </span>
                <select
                  id="cuisine-preference"
                  className="menu-app__select-input"
                  value={cuisinePreference}
                  onChange={(event) =>
                    setCuisinePreference(event.target.value as CuisinePreference)
                  }
                  disabled={loading}
                >
                  {CUISINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="menu-app__control-spacer" aria-hidden>
                  kcal前後
                </span>
              </div>
            </div>
            <div className="menu-app__field-row">
              <label htmlFor="target-calories" className="menu-app__label">
                カロリー
              </label>
              <div className="menu-app__control-group">
                <span className="menu-app__number-prefix">1人あたり</span>
                <input
                  id="target-calories"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  className="menu-app__number-input"
                  placeholder="指定なし"
                  value={targetCaloriesInput}
                  onChange={(event) => setTargetCaloriesInput(event.target.value)}
                  disabled={loading}
                />
                <span className="menu-app__number-unit">kcal前後</span>
              </div>
            </div>
            <label htmlFor="ingredients" className="menu-app__label">
              余りもの・使いたい食材
            </label>
            <textarea
              id="ingredients"
              className="menu-app__textarea"
              rows={5}
              placeholder={
                "例: 卵、玉ねぎ、しめじ、ベーコン\n（カンマ・読点・改行で区切れます）"
              }
              value={ingredientText}
              onChange={(e) => setIngredientText(e.target.value)}
            />
            <div className="menu-app__actions">
              <button
                type="button"
                className={
                  loading
                    ? "menu-app__primary menu-app__primary--loading"
                    : "menu-app__primary"
                }
                onClick={handleSuggest}
                disabled={loading}
              >
                <span className="menu-app__primary-label">
                  {loading ? "考え中…" : "献立を提案"}
                </span>
              </button>
            </div>
          </section>

          {error ? (
            <div
              className={
                isNonFoodRelatedErrorMessage(error)
                  ? "menu-app__error menu-app__error--non-food"
                  : "menu-app__error"
              }
              role="alert"
            >
              <span className="menu-app__error-icon" aria-hidden>
                !
              </span>
              {isNonFoodRelatedErrorMessage(error) ? (
                <p className="menu-app__error-text">
                  <span className="menu-app__error-non-food">食べ物以外</span>
                  の内容が含まれています。食材・献立・料理に関連する内容を入力してください。
                </p>
              ) : (
                <p className="menu-app__error-text">{error}</p>
              )}
            </div>
          ) : null}

          <section
            className="menu-app__panel menu-app__panel--results"
            aria-label="献立の提案"
          >
            <div className="menu-app__results-top">
              <div>
                <h2 className="menu-app__results-heading">
                  {resultsView === "suggestions" ? "提案メニュー" : "お気に入り"}
                </h2>
                {favoritesNextToken ? (
                  <p className="menu-app__results-caption">
                    さらにお気に入りがあります
                  </p>
                ) : null}
              </div>
              <div className="menu-app__view-toggle" role="tablist" aria-label="表示切り替え">
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultsView === "suggestions"}
                  className={
                    resultsView === "suggestions"
                      ? "menu-app__view-btn menu-app__view-btn--active"
                      : "menu-app__view-btn"
                  }
                  onClick={() => setResultsView("suggestions")}
                >
                  提案
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultsView === "favorites"}
                  className={
                    resultsView === "favorites"
                      ? "menu-app__view-btn menu-app__view-btn--active"
                      : "menu-app__view-btn"
                  }
                  onClick={() => setResultsView("favorites")}
                >
                  お気に入り {favorites.length}
                </button>
              </div>
            </div>
            {favoritesError ? (
              <p className="menu-app__history-message" role="status">
                {favoritesError}
              </p>
            ) : null}
            {resultsView === "suggestions" && !hasRequested ? (
              <div className="menu-app__empty">
                <span className="menu-app__empty-icon" aria-hidden>
                  🍳
                </span>
                <p className="menu-app__empty-title">まだ提案がありません</p>
                <p className="menu-app__empty-body">
                  食材を入力して「献立を提案」を押すと、ここに AI の提案が表示されます。
                </p>
              </div>
            ) : resultsView === "suggestions" && loading && suggestions.length === 0 ? (
              <p className="menu-app__loading-results" aria-live="polite">
                献立を考えています…
              </p>
            ) : resultsView === "suggestions" && suggestions.length === 0 ? (
              <p className="menu-app__empty-body menu-app__empty-body--solo">
                候補を取得できませんでした。入力内容を変えて再度お試しください。
              </p>
            ) : resultsView === "suggestions" ? (
              <ol className="menu-app__cards">
                {suggestions.map((s, i) => {
                  const favoriteKey = buildFavoriteMenuKey({
                    dishTitle: s.title,
                    recipe: s.note,
                    usedIngredients: s.uses,
                  });
                  const favoriteDishKey = normalizeDishTitleKey(s.title);
                  const isFavorited = favoriteDishKeySet.has(favoriteDishKey);

                  return (
                  (() => {
                    const structured = parseSuggestedRecipe(s.note);
                    const ingredients =
                      structured.ingredients.length > 0
                        ? structured.ingredients
                        : s.uses.map((name) => ({ name, amount: "" }));

                    return (
                      <li key={`${s.title}-${i}`} className="menu-app__card">
                        <details className="menu-app__history-details">
                          <summary className="menu-app__history-summary">
                            <div className="menu-app__card-head menu-app__card-head--summary">
                              <div className="menu-app__favorite-headline">
                                <h3 className="menu-app__card-title">
                                  <span className="menu-app__card-title-row">
                                    <span>{s.title}({formatServingsLabel(s.servings)})</span>
                                    {s.cuisinePreference !== "default" ? (
                                      <span className="menu-app__cuisine-badge">
                                        {formatCuisineLabel(s.cuisinePreference)}
                                      </span>
                                    ) : null}
                                  </span>
                                </h3>
                                {formatEstimatedCaloriesLabel(s.estimatedCalories) ? (
                                  <p className="menu-app__estimated-calories">
                                    {formatEstimatedCaloriesLabel(s.estimatedCalories)}
                                  </p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className={
                                  isFavorited
                                    ? "menu-app__favorite-btn menu-app__favorite-btn--active"
                                    : "menu-app__favorite-btn"
                                }
                                aria-label={
                                  isFavorited
                                    ? "お気に入りを解除"
                                    : "お気に入りに追加"
                                }
                                aria-pressed={isFavorited}
                                disabled={isFavoritePending(favoriteDishKey)}
                                onClick={(event) =>
                                  handleFavoriteToggleClick(
                                    event,
                                    createFavoriteSourceFromSuggestion(
                                      s,
                                      ingredientText.trim(),
                                      suggestionHistoryIds[favoriteKey]
                                    )
                                  )
                                }
                              >
                                {isFavorited ? "★" : "☆"}
                              </button>
                            </div>
                          </summary>
                          <div className="menu-app__card-body menu-app__history-content">
                            <p className="menu-app__history-input">
                              入力食材: {ingredientText.trim()}
                            </p>
                            {formatTargetCaloriesLabel(s.targetCalories) ? (
                              <p className="menu-app__history-meta-text">
                                カロリー条件: {formatTargetCaloriesLabel(s.targetCalories)}
                              </p>
                            ) : null}
                            {renderRecipeLayout({
                              ingredients,
                              steps: structured.steps,
                              fallbackRecipe: s.note,
                              keyPrefix: `${s.title}-${i}`,
                              hideStepDividers: true,
                            })}
                          </div>
                        </details>
                      </li>
                    );
                  })()
                  );
                })}
              </ol>
            ) : favoritesLoading ? (
              <p className="menu-app__loading-results" aria-live="polite">
                お気に入りを読み込んでいます…
              </p>
            ) : favorites.length === 0 ? (
              <div className="menu-app__empty">
                <span className="menu-app__empty-icon" aria-hidden>
                  ☆
                </span>
                <p className="menu-app__empty-title">お気に入りはまだありません</p>
                <p className="menu-app__empty-body">
                  提案や履歴のカードから、また作りたい献立を保存できます。
                </p>
              </div>
            ) : (
              <ol className="menu-app__cards">
                {favorites.map((entry) => {
                  const structured = parseSuggestedRecipe(entry.recipe);
                  const ingredients =
                    structured.ingredients.length > 0
                      ? structured.ingredients
                      : entry.usedIngredients.map((name) => ({ name, amount: "" }));
                  const imageUrl = favoriteImageUrls[entry.id];
                  const imagePending = isFavoriteImagePending(entry.id);

                  return (
                    <li key={entry.id} className="menu-app__card">
                      <details className="menu-app__history-details">
                        <summary className="menu-app__history-summary">
                          <div className="menu-app__history-meta">
                            <div className="menu-app__favorite-headline">
                              <h3 className="menu-app__card-title">
                                <span className="menu-app__card-title-row">
                                  <span>{entry.dishTitle}({formatServingsLabel(entry.servings)})</span>
                                  {entry.cuisinePreference !== "default" ? (
                                    <span className="menu-app__cuisine-badge">
                                      {formatCuisineLabel(entry.cuisinePreference)}
                                    </span>
                                  ) : null}
                                </span>
                              </h3>
                              {formatEstimatedCaloriesLabel(entry.estimatedCalories) ? (
                                <p className="menu-app__estimated-calories">
                                  {formatEstimatedCaloriesLabel(entry.estimatedCalories)}
                                </p>
                              ) : null}
                              <time
                                className="menu-app__history-time"
                                dateTime={entry.favoritedAt}
                              >
                                {formatHistoryDate(entry.favoritedAt)}
                              </time>
                              <button
                                type="button"
                                className="menu-app__favorite-btn menu-app__favorite-btn--active"
                                aria-label="お気に入りを解除"
                                aria-pressed
                                disabled={isFavoritePending(
                                  normalizeDishTitleKey(entry.dishTitle)
                                )}
                                onClick={(event) =>
                                  handleFavoriteToggleClick(event, {
                                    ingredientText: entry.ingredientText,
                                    dishTitle: entry.dishTitle,
                                    estimatedCalories: entry.estimatedCalories,
                                    recipe: entry.recipe,
                                    usedIngredients: entry.usedIngredients,
                                    servings: entry.servings,
                                    cuisinePreference: entry.cuisinePreference,
                                    targetCalories: entry.targetCalories,
                                    sourceHistoryId: entry.sourceHistoryId,
                                  })
                                }
                              >
                                ★
                              </button>
                            </div>
                          </div>
                        </summary>
                        <div className="menu-app__card-body menu-app__history-content">
                          <p className="menu-app__history-input">
                            入力食材: {entry.ingredientText}
                          </p>
                          {formatTargetCaloriesLabel(entry.targetCalories) ? (
                            <p className="menu-app__history-meta-text">
                              カロリー条件: {formatTargetCaloriesLabel(entry.targetCalories)}
                            </p>
                          ) : null}
                          <section className="menu-app__favorite-image-section">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={`${entry.dishTitle} のお気に入り画像`}
                                className="menu-app__favorite-image"
                              />
                            ) : (
                              <div className="menu-app__favorite-image-placeholder">
                                画像はまだありません
                              </div>
                            )}
                            <div className="menu-app__favorite-image-actions">
                              <label
                                className={
                                  imagePending
                                    ? "menu-app__secondary-btn menu-app__secondary-btn--disabled"
                                    : "menu-app__secondary-btn"
                                }
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="menu-app__file-input"
                                  disabled={imagePending}
                                  onChange={(event) =>
                                    void handleFavoriteImageSelection(entry, event)
                                  }
                                />
                                {imagePending
                                  ? "保存中…"
                                  : imageUrl
                                    ? "画像を変更"
                                    : "画像を追加"}
                              </label>
                              {entry.imagePath ? (
                                <button
                                  type="button"
                                  className="menu-app__text-btn"
                                  disabled={imagePending}
                                  onClick={(event) =>
                                    void handleFavoriteImageRemove(event, entry)
                                  }
                                >
                                  画像を削除
                                </button>
                              ) : null}
                            </div>
                          </section>
                          {renderRecipeLayout({
                            ingredients,
                            steps: structured.steps,
                            fallbackRecipe: entry.recipe,
                            keyPrefix: entry.id,
                            hideStepDividers: true,
                          })}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <footer className="menu-app__footer">
            <button type="button" className="menu-app__signout" onClick={signOut}>
              サインアウト
            </button>
          </footer>
            </>
          )}
        </div>
      </main>

    </div>
  );
}

export default App;
