import { type MouseEvent, useEffect, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  buildFavoriteMenuKey,
  createFavorite,
  deleteFavorite,
  fetchFavorites,
  type MenuHistoryEntry,
  type MenuSuggestion,
  type FavoriteMenuEntry,
  fetchMenuHistory,
  fetchMenuSuggestions,
  isNonFoodRelatedErrorMessage,
  normalizeDishTitleKey,
  parseIngredients,
  parseSuggestedRecipe,
  saveMenuHistory,
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

type FavoriteSource = {
  ingredientText: string;
  dishTitle: string;
  recipe: string;
  usedIngredients: string[];
  sourceHistoryId?: string | null;
};

type ResultsView = "suggestions" | "favorites";

function createFavoriteSourceFromHistory(entry: MenuHistoryEntry): FavoriteSource {
  return {
    ingredientText: entry.ingredientText,
    dishTitle: entry.dishTitle,
    recipe: entry.recipe,
    usedIngredients: entry.usedIngredients,
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
    recipe: suggestion.note,
    usedIngredients: suggestion.uses,
    sourceHistoryId,
  };
}

function App() {
  const { user, signOut } = useAuthenticator();
  const [ingredientText, setIngredientText] = useState("");
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
  const [favoritesNextToken, setFavoritesNextToken] = useState<string | null>(null);
  const [suggestionHistoryIds, setSuggestionHistoryIds] = useState<Record<string, string | null>>({});
  const currentUserId = getCurrentUserId(user);
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

  function beginFavoriteToggle(favoriteKey: string) {
    setFavoritePendingKeys((prev) =>
      prev.includes(favoriteKey) ? prev : [...prev, favoriteKey]
    );
  }

  function finishFavoriteToggle(favoriteKey: string) {
    setFavoritePendingKeys((prev) => prev.filter((key) => key !== favoriteKey));
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
          recipe: source.recipe,
          usedIngredients: source.usedIngredients,
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

  async function handleSuggest() {
    setError(null);

    const text = ingredientText.trim();
    if (!text) {
      setError("食材を入力してください");
      setSuggestions([]);
      setHasRequested(false);
      return;
    }

    setLoading(true);
    setHasRequested(true);
    try {
      const next = await fetchMenuSuggestions(text);
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

  return (
    <div className="menu-app__shell">
      <aside className="menu-app__sidebar" aria-label="提案履歴">
        <div className="menu-app__sidebar-inner">
          <section className="menu-app__sidebar-section">
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
                                {entry.dishTitle}(1人前)
                              </h3>
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
                          <div className="menu-app__recipe-layout">
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">材料名</h4>
                              {displayIngredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {displayIngredients.map((ingredient, idx) => (
                                    <li
                                      key={`${entry.id}-${ingredient.name}-${idx}`}
                                      className="menu-app__recipe-item"
                                    >
                                      {ingredient.name}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">分量</h4>
                              {displayIngredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {displayIngredients.map((ingredient, idx) => (
                                    <li
                                      key={`${entry.id}-amount-${ingredient.name}-${idx}`}
                                      className="menu-app__recipe-item menu-app__recipe-item--amount"
                                    >
                                      {ingredient.amount || "-"}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column menu-app__recipe-column--steps">
                              <h4 className="menu-app__recipe-heading">レシピ</h4>
                              {structured.steps.length > 0 ? (
                                <ol className="menu-app__step-list">
                                  {structured.steps.map((step, idx) => (
                                    <li
                                      key={`${entry.id}-step-${idx}`}
                                      className="menu-app__step"
                                    >
                                      {step}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="menu-app__recipe-empty">
                                  {entry.recipe}
                                </p>
                              )}
                            </section>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>

      <main className="menu-app">
        <div className="menu-app__main-inner">
          <header className="menu-app__header">
            <p className="menu-app__eyebrow">面倒くさがりのあなたに</p>
            <h1 className="menu-app__title">献立提案</h1>
            <p className="menu-app__subtitle">
              <span className="menu-app__subtitle-name">{loginId}</span>
              さんのキッチン
            </p>
          </header>

          <section
            className="menu-app__panel menu-app__panel--input"
            aria-label="食材の入力"
            aria-busy={loading}
          >
            <div className="menu-app__panel-head">
              <label htmlFor="ingredients" className="menu-app__label">
                余りもの・使いたい食材
              </label>
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
                        <div className="menu-app__card-body">
                          <div className="menu-app__card-head">
                            <h3 className="menu-app__card-title">
                              {s.title}(1人前)
                            </h3>
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
                              onClick={() =>
                                void toggleFavorite(
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
                          <div className="menu-app__recipe-layout">
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">材料名</h4>
                              {ingredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {ingredients.map((ingredient, idx) => (
                                    <li
                                      key={`${ingredient.name}-${idx}`}
                                      className="menu-app__recipe-item"
                                    >
                                      {ingredient.name}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">分量</h4>
                              {ingredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {ingredients.map((ingredient, idx) => (
                                    <li
                                      key={`${ingredient.name}-amount-${idx}`}
                                      className="menu-app__recipe-item menu-app__recipe-item--amount"
                                    >
                                      {ingredient.amount || "-"}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column menu-app__recipe-column--steps">
                              <h4 className="menu-app__recipe-heading">レシピ</h4>
                              {structured.steps.length > 0 ? (
                                <ol className="menu-app__step-list">
                                  {structured.steps.map((step, idx) => (
                                    <li
                                      key={`${s.title}-step-${idx}`}
                                      className="menu-app__step"
                                    >
                                      {step}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="menu-app__recipe-empty">{s.note}</p>
                              )}
                            </section>
                          </div>
                        </div>
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

                  return (
                    <li key={entry.id} className="menu-app__card">
                      <details className="menu-app__history-details">
                        <summary className="menu-app__history-summary">
                          <div className="menu-app__history-meta">
                            <div className="menu-app__favorite-headline">
                              <h3 className="menu-app__card-title">
                                {entry.dishTitle}(1人前)
                              </h3>
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
                                    recipe: entry.recipe,
                                    usedIngredients: entry.usedIngredients,
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
                          <div className="menu-app__recipe-layout">
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">材料名</h4>
                              {ingredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {ingredients.map((ingredient, idx) => (
                                    <li
                                      key={`${entry.id}-${ingredient.name}-${idx}`}
                                      className="menu-app__recipe-item"
                                    >
                                      {ingredient.name}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column">
                              <h4 className="menu-app__recipe-heading">分量</h4>
                              {ingredients.length > 0 ? (
                                <ul className="menu-app__recipe-items">
                                  {ingredients.map((ingredient, idx) => (
                                    <li
                                      key={`${entry.id}-amount-${ingredient.name}-${idx}`}
                                      className="menu-app__recipe-item menu-app__recipe-item--amount"
                                    >
                                      {ingredient.amount || "-"}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="menu-app__recipe-empty">-</p>
                              )}
                            </section>
                            <section className="menu-app__recipe-column menu-app__recipe-column--steps">
                              <h4 className="menu-app__recipe-heading">レシピ</h4>
                              {structured.steps.length > 0 ? (
                                <ol className="menu-app__step-list">
                                  {structured.steps.map((step, idx) => (
                                    <li
                                      key={`${entry.id}-step-${idx}`}
                                      className="menu-app__step"
                                    >
                                      {step}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="menu-app__recipe-empty">{entry.recipe}</p>
                              )}
                            </section>
                          </div>
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
        </div>
      </main>
    </div>
  );
}

export default App;
