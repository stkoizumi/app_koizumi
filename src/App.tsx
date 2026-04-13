import { useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  type MenuSuggestion,
  parseIngredients,
  suggestMenuDummy,
} from "./suggestMenu";
import "./App.css";

function App() {
  const { user, signOut } = useAuthenticator();
  const [ingredientText, setIngredientText] = useState("");
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setError(null);
    setLoading(true);
    try {
      const items = parseIngredients(ingredientText);
      const next = await suggestMenuDummy(items);
      setSuggestions(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提案に失敗しました");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  const loginId = user?.signInDetails?.loginId ?? "あなた";

  return (
    <main className="menu-app">
      <header className="menu-app__header">
        <h1 className="menu-app__title">余りもの献立</h1>
        <p className="menu-app__subtitle">{loginId} さんのキッチン</p>
      </header>

      <section className="menu-app__panel" aria-label="食材の入力">
        <label htmlFor="ingredients" className="menu-app__label">
          余りもの・使いたい食材
        </label>
        <textarea
          id="ingredients"
          className="menu-app__textarea"
          rows={5}
          placeholder={"例: 卵、玉ねぎ、しめじ\n（カンマ・読点・改行で区切れます）"}
          value={ingredientText}
          onChange={(e) => setIngredientText(e.target.value)}
        />
        <button
          type="button"
          className="menu-app__primary"
          onClick={handleSuggest}
          disabled={loading}
        >
          {loading ? "考え中…" : "献立を提案"}
        </button>
      </section>

      {error ? (
        <p className="menu-app__error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="menu-app__results" aria-label="献立の提案">
        <h2 className="menu-app__results-heading">提案</h2>
        {suggestions.length === 0 ? (
          <p className="menu-app__empty">
            食材を入れて「献立を提案」を押すと、ここに候補が表示されます（いまはデモ表示です）。
          </p>
        ) : (
          <ul className="menu-app__cards">
            {suggestions.map((s, i) => (
              <li key={`${s.title}-${i}`} className="menu-app__card">
                <h3 className="menu-app__card-title">{s.title}</h3>
                {s.uses.length > 0 ? (
                  <p className="menu-app__card-uses">
                    <span className="menu-app__card-label">使う食材: </span>
                    {s.uses.join("、")}
                  </p>
                ) : null}
                <p className="menu-app__card-note">{s.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="menu-app__footer">
        <button type="button" className="menu-app__signout" onClick={signOut}>
          サインアウト
        </button>
      </footer>
    </main>
  );
}

export default App;
