import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Schema } from "../../data/resource";

const DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const ALLOWED_CALORIE_DEVIATION = 200;
const CUISINE_LABELS = {
  default: "デフォルト",
  washoku: "和食",
  yoshoku: "洋食",
  chuka: "中華",
  italian: "イタリアン",
  french: "フレンチ",
  ethnic: "エスニック",
} as const;

/** モデルが「食べ物・献立と無関係」と判断したときの料理名（Lambda で検知してエラーにする） */
const NOT_FOOD_TITLE = "__NOT_FOOD__";
const CALORIE_UNAVAILABLE_TITLE = "__CALORIE_UNAVAILABLE__";
const CALORIE_UNAVAILABLE_MESSAGE =
  "指定したカロリー条件では献立を提案できませんでした。カロリー条件を見直して再度お試しください。";

type CuisinePreference = keyof typeof CUISINE_LABELS;

function normalizeCuisinePreference(value: string | null | undefined): CuisinePreference {
  switch (value) {
    case "washoku":
    case "yoshoku":
    case "chuka":
    case "italian":
    case "french":
    case "ethnic":
      return value;
    default:
      return "default";
  }
}

function buildCuisineInstruction(cuisinePreference: CuisinePreference): string {
  if (cuisinePreference === "default") {
    return "料理ジャンルはデフォルト指定です。入力された食材や要望に最も合うジャンルで自然に提案してください。";
  }

  return `料理ジャンルは${CUISINE_LABELS[cuisinePreference]}指定です。料理名、味付け、使用する調味料、調理の方向性をこのジャンルに合わせて提案してください。`;
}

function normalizeTargetCalories(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function buildCalorieInstruction(targetCalories: number | null): string {
  if (targetCalories === null) {
    return "カロリー条件は未指定です。材料と他の条件を優先して自然な献立を提案してください。";
  }

  return `目標カロリーは1人前あたり約${targetCalories}kcalです。材料を最優先にしつつ、この目標にできるだけ近づけてください。1人前あたりの推定カロリーを必ず整数のkcalで出力してください。目標との差が${ALLOWED_CALORIE_DEVIATION}kcalを超える場合や、入力条件では実現が難しい場合は通常の献立を提案してはならず、後述の不成立フォーマットだけを返してください。`;
}

function buildSystemPrompt(
  servings: number,
  cuisinePreference: CuisinePreference,
  targetCalories: number | null
): string {
  return `あなたはプロの料理研究家です。ユーザーの入力（手持ちの食材や要望の文章）を材料にし、次の条件をすべて満たす献立を「1つだけ」提案してください。

まず入力内容を判断すること:
- 入力に食材・献立・料理・調理にまったく関係しない単語（例: プログラムコード、計算式、天気や雑談のみ、仕事用の文書のみ、個人情報の羅列のみなど）が1つでも含まれる場合は、献立を提案してはならない。
- その場合は次の形式「だけ」を返すこと（料理名の行は一字一句このまま）:
 - カロリー条件が厳しすぎて実現困難な場合も、通常の献立は返さず、後述の不成立フォーマットだけを返すこと:

【料理名】
${NOT_FOOD_TITLE}

【レシピ】
食材・献立・料理に関連する内容を入力してください。

また、カロリー条件が成立しない場合は次の形式「だけ」を返すこと:

【料理名】
${CALORIE_UNAVAILABLE_TITLE}

【推定カロリー】
unavailable

【レシピ】
${CALORIE_UNAVAILABLE_MESSAGE}

関係する入力のときだけ、通常どおり献立を1つ提案すること。

条件:
- 足りない材料はなるべく少なくすること
- 初心者でも20分以内で作れる手順にすること
- 指定された食材をできるだけ活用すること。足りない場合は一般的な調味料やよくある食材の追記を簡潔に含めてよい
- 分量は${servings}人前であること
- ${buildCuisineInstruction(cuisinePreference)}
- ${buildCalorieInstruction(targetCalories)}

出力は次のフォーマットに厳密に従い、前置き・挨拶・解説は書かないこと。
- 材料は必ず「材料名 | 分量」の形式で1行ずつ書くこと
- 分量は省略しないこと
- 手順は「1.」「2.」のように番号付きで書くこと

【料理名】
（料理名のみ1行。献立と無関係な入力のときは必ず ${NOT_FOOD_TITLE} のみ）

【推定カロリー】
（1人前あたりの推定カロリーを整数の数値のみで1行。例: 520）

【レシピ】
【材料】
材料名 | 分量
材料名 | 分量

【手順】
1. 手順
2. 手順

（献立と無関係な入力のときは上記の固定文のみ）`;
}

function parseEstimatedCalories(text: string): number | null {
  const calorieMatch = text.match(/【推定カロリー】\s*([^\r\n]+)/);
  const rawValue = calorieMatch?.[1]?.trim() ?? "";
  const parsed = Number(rawValue.replace(/[^\d]/g, ""));

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseMenuResponse(text: string): {
  title: string;
  estimatedCalories: number | null;
  recipe: string;
} {
  const titleMatch = text.match(
    /【料理名】\s*([\s\S]*?)(?=【推定カロリー】|【レシピ】|$)/
  );
  const recipeMatch = text.match(/【レシピ】\s*([\s\S]*)/);
  const title = titleMatch?.[1]?.trim() ?? "";
  const recipe = recipeMatch?.[1]?.trim() ?? "";
  const estimatedCalories = parseEstimatedCalories(text);
  if (!title && !recipe) {
    return {
      title: "（解析できませんでした）",
      estimatedCalories,
      recipe: text.trim(),
    };
  }
  return {
    title: title || "（タイトルなし）",
    estimatedCalories,
    recipe: recipe || text.trim(),
  };
}

export const handler: Schema["suggestMenu"]["functionHandler"] = async (
  event
) => {
  const ingredientText = (event.arguments.ingredientText ?? "").trim();
  const requestedServings =
    typeof event.arguments.servings === "number" &&
    Number.isInteger(event.arguments.servings) &&
    event.arguments.servings > 0
      ? event.arguments.servings
      : 1;
  const cuisinePreference = normalizeCuisinePreference(
    typeof event.arguments.cuisinePreference === "string"
      ? event.arguments.cuisinePreference
      : undefined
  );
  const targetCalories = normalizeTargetCalories(
    typeof event.arguments.targetCalories === "number"
      ? event.arguments.targetCalories
      : undefined
  );
  if (!ingredientText) {
    return {
      title: "食材を入力してください",
      recipe: "献立を提案するには、テキストボックスに食材や要望を入力してください。",
    };
  }

  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません。");
  }

  const modelId = process.env.MENU_SUGGEST_MODEL_ID ?? DEFAULT_MODEL_ID;
  const client = new BedrockRuntimeClient({ region });

  const userMessage =
    cuisinePreference === "default"
      ? targetCalories === null
        ? `以下を踏まえて${requestedServings}人前の献立を1つだけ提案してください。\n\n${ingredientText}`
        : `以下を踏まえて${requestedServings}人前で、1人前あたり約${targetCalories}kcalを目安にした献立を1つだけ提案してください。\n\n${ingredientText}`
      : targetCalories === null
        ? `以下を踏まえて${requestedServings}人前で、${CUISINE_LABELS[cuisinePreference]}寄りの献立を1つだけ提案してください。\n\n${ingredientText}`
        : `以下を踏まえて${requestedServings}人前で、${CUISINE_LABELS[cuisinePreference]}寄りかつ1人前あたり約${targetCalories}kcalを目安にした献立を1つだけ提案してください。\n\n${ingredientText}`;

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2048,
    temperature: 0.6,
    system: buildSystemPrompt(
      requestedServings,
      cuisinePreference,
      targetCalories
    ),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userMessage }],
      },
    ],
  });

  const response = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    })
  );

  const raw = response.body
    ? new TextDecoder("utf-8").decode(response.body)
    : "";
  if (!raw) {
    throw new Error("Bedrock から空の応答が返りました。");
  }

  const parsed = JSON.parse(raw) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textBlock = parsed.content?.find((c) => c.type === "text" && c.text);
  const text = textBlock?.text?.trim() ?? "";
  if (!text) {
    throw new Error("モデルからテキストを取得できませんでした。");
  }

  const menu = parseMenuResponse(text);
  const titleNorm = menu.title.trim();
  if (
    titleNorm === NOT_FOOD_TITLE ||
    text.includes(NOT_FOOD_TITLE)
  ) {
    throw new Error(
      "食材・献立・料理に関連する内容を入力してください。"
    );
  }

  if (
    titleNorm === CALORIE_UNAVAILABLE_TITLE ||
    text.includes(CALORIE_UNAVAILABLE_TITLE)
  ) {
    throw new Error(CALORIE_UNAVAILABLE_MESSAGE);
  }

  if (targetCalories !== null) {
    if (menu.estimatedCalories === null) {
      throw new Error(
        "カロリー条件に基づく提案を取得できませんでした。再度お試しください。"
      );
    }

    if (
      Math.abs(menu.estimatedCalories - targetCalories) >
      ALLOWED_CALORIE_DEVIATION
    ) {
      throw new Error(CALORIE_UNAVAILABLE_MESSAGE);
    }
  }

  return {
    title: menu.title,
    estimatedCalories: menu.estimatedCalories,
    recipe: menu.recipe,
  };
};
