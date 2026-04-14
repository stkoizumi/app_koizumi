import { useMemo, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  type MenuSuggestion,
  fetchMenuSuggestions,
  isNonFoodRelatedErrorMessage,
  parseIngredients,
} from "./suggestMenu";
import "./App.css";

const CHIP_PREVIEW_MAX = 10;

function App() {
  const { user, signOut } = useAuthenticator();
  const [ingredientText, setIngredientText] = useState("");
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [hasRequested, setHasRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedItems = useMemo(
    () => parseIngredients(ingredientText),
    [ingredientText]
  );

  async function handleSuggest() {
    setError(null);
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
  const chipOverflow = Math.max(0, parsedItems.length - CHIP_PREVIEW_MAX);
  const chips = parsedItems.slice(0, CHIP_PREVIEW_MAX);

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
          {chips.length > 0 ? (
            <div className="menu-app__chips" aria-label="認識した食材">
              {chips.map((name, idx) => (
                <span key={`${name}-${idx}`} className="menu-app__chip">
                  {name}
                </span>
              ))}
              {chipOverflow > 0 ? (
                <span className="menu-app__chip menu-app__chip--more">
                  ほか {chipOverflow} 件
                </span>
              ) : null}
            </div>
          ) : (
            <p className="menu-app__hint">
              入力すると、ここに食材がタグ表示されます。
            </p>
          )}
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
                の内容のようです。食材・献立・料理に関連する内容を入力してください。
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
                <li key={`${s.title}-${i}`} className="menu-app__card">
                  <span className="menu-app__card-index" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="menu-app__card-body">
                    <h3 className="menu-app__card-title">{s.title}</h3>
                    {s.uses.length > 0 ? (
                      <ul className="menu-app__tag-list">
                        {s.uses.map((u, idx) => (
                          <li key={`${u}-${idx}`} className="menu-app__tag">
                            {u}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="menu-app__card-note">{s.note}</p>
                  </div>
                </li>
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
