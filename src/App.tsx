import { useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  type MenuSuggestion,
  fetchMenuSuggestions,
  isNonFoodRelatedErrorMessage,
  parseSuggestedRecipe,
} from "./suggestMenu";
import "./App.css";

function App() {
  const { user, signOut } = useAuthenticator();
  const [ingredientText, setIngredientText] = useState("");
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [hasRequested, setHasRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setError(null);

    if (!ingredientText.trim()) {
      setError("食材を入力してください");
      setSuggestions([]);
      setHasRequested(false);
      return;
    }

    setLoading(true);
    setHasRequested(true);
    try {
      const next = await fetchMenuSuggestions(ingredientText);
      setSuggestions(next);
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
