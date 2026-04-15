import { useEffect, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  type MenuHistoryEntry,
  type MenuSuggestion,
  fetchMenuHistory,
  fetchMenuSuggestions,
  isNonFoodRelatedErrorMessage,
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

function App() {
  const { user, signOut } = useAuthenticator();
  const [ingredientText, setIngredientText] = useState("");
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [history, setHistory] = useState<MenuHistoryEntry[]>([]);
  const [hasRequested, setHasRequested] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = getCurrentUserId(user);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!currentUserId) {
        setHistory([]);
        setHistoryError(null);
        setHistoryLoading(false);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const nextHistory = await fetchMenuHistory(currentUserId);
        if (!cancelled) {
          setHistory(nextHistory);
        }
      } catch (e) {
        if (!cancelled) {
          setHistory([]);
          setHistoryError(
            e instanceof Error ? e.message : "履歴の取得に失敗しました"
          );
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

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
      <main className="menu-app">
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
          <h2 className="menu-app__results-heading">提案メニュー</h2>
          {!hasRequested ? (
            <div className="menu-app__empty">
              <span className="menu-app__empty-icon" aria-hidden>
                🍳
              </span>
              <p className="menu-app__empty-title">まだ提案がありません</p>
              <p className="menu-app__empty-body">
                食材を入力して「献立を提案」を押すと、ここに AI の提案が表示されます。
              </p>
            </div>
          ) : loading && suggestions.length === 0 ? (
            <p className="menu-app__loading-results" aria-live="polite">
              献立を考えています…
            </p>
          ) : suggestions.length === 0 ? (
            <p className="menu-app__empty-body menu-app__empty-body--solo">
              候補を取得できませんでした。入力内容を変えて再度お試しください。
            </p>
          ) : (
            <ol className="menu-app__cards">
              {suggestions.map((s, i) => (
                (() => {
                  const structured = parseSuggestedRecipe(s.note);
                  const ingredients =
                    structured.ingredients.length > 0
                      ? structured.ingredients
                      : s.uses.map((name) => ({ name, amount: "" }));

                  return (
                    <li key={`${s.title}-${i}`} className="menu-app__card">
                      <div className="menu-app__card-body">
                        <h3 className="menu-app__card-title">
                          {s.title}(1人前)
                        </h3>
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
              ))}
            </ol>
          )}
        </section>

        <section
          className="menu-app__panel menu-app__panel--history"
          aria-label="提案履歴"
        >
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
                const displayIngredients =
                  structured.ingredients.length > 0
                    ? structured.ingredients
                    : (entry.usedIngredients.length > 0
                        ? entry.usedIngredients
                        : parseIngredients(entry.ingredientText)
                      ).map((name) => ({ name, amount: "" }));

                return (
                  <li key={entry.id} className="menu-app__card">
                    <div className="menu-app__card-body">
                      <div className="menu-app__history-meta">
                        <h3 className="menu-app__card-title">
                          {entry.dishTitle}(1人前)
                        </h3>
                        <time
                          className="menu-app__history-time"
                          dateTime={entry.savedAt}
                        >
                          {formatHistoryDate(entry.savedAt)}
                        </time>
                      </div>
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
      </main>
    </div>
  );
}

export default App;
