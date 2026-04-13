export type MenuSuggestion = {
  title: string;
  uses: string[];
  note: string;
};

export function parseIngredients(text: string): string[] {
  return text
    .split(/[,、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** デモ用。後で AI / Lambda 呼び出しに置き換える。 */
export async function suggestMenuDummy(
  ingredients: string[]
): Promise<MenuSuggestion[]> {
  await new Promise((r) => setTimeout(r, 450));
  if (ingredients.length === 0) {
    return [
      {
        title: "まずは食材を入れよう",
        uses: [],
        note: "例: 卵、玉ねぎ、しめじ（カンマまたは改行で区切れます）",
      },
    ];
  }
  const primary = ingredients.slice(0, 3);
  return [
    {
      title: `${primary[0]}を使ったあえもの`,
      uses: primary,
      note: "（デモ）後で AI がレシピを提案します。",
    },
    {
      title: "具だくさんスープ",
      uses: ingredients,
      note: "（デモ）煮込み時間は具材の大きさで調整。",
    },
    {
      title: "フライパンひとつで仕上げる一品",
      uses: ingredients.slice(0, 2),
      note: "（デモ）調味料はお好みで。",
    },
  ];
}
