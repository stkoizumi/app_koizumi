import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Schema } from "../../data/resource";

const DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";

/** モデルが「食べ物・献立と無関係」と判断したときの料理名（Lambda で検知してエラーにする） */
const NOT_FOOD_TITLE = "__NOT_FOOD__";

const SYSTEM_PROMPT = `あなたはプロの料理研究家です。ユーザーの入力（手持ちの食材や要望の文章）を材料にし、次の条件をすべて満たす献立を「1つだけ」提案してください。

まず入力内容を判断すること:
- 入力が食材・献立・料理・調理にまったく関係しない単語（例: プログラムコード、計算式、天気や雑談のみ、仕事用の文書のみ、個人情報の羅列のみなど）が含まれる場合は、献立を提案してはならない。
- その場合は次の形式「だけ」を返すこと（料理名の行は一字一句このまま）:

【料理名】
${NOT_FOOD_TITLE}

【レシピ】
食材・献立・料理に関連する内容を入力してください。

関係する入力のときだけ、通常どおり献立を1つ提案すること。

条件:
- 足りない材料はなるべく少なくすること
- 初心者でも20分以内で作れる手順にすること
- 指定された食材をできるだけ活用すること。足りない場合は一般的な調味料やよくある食材の追記を簡潔に含めてよい

出力は次のフォーマットに厳密に従い、前置き・挨拶・解説は書かないこと。

【料理名】
（料理名のみ1行。献立と無関係な入力のときは必ず ${NOT_FOOD_TITLE} のみ）

【レシピ】
（材料と手順を読みやすく。分量の目安を含める。献立と無関係な入力のときは上記の固定文のみ）`;

function parseMenuResponse(text: string): { title: string; recipe: string } {
  const titleMatch = text.match(/【料理名】\s*([\s\S]*?)(?=【レシピ】|$)/);
  const recipeMatch = text.match(/【レシピ】\s*([\s\S]*)/);
  const title = titleMatch?.[1]?.trim() ?? "";
  const recipe = recipeMatch?.[1]?.trim() ?? "";
  if (!title && !recipe) {
    return { title: "（解析できませんでした）", recipe: text.trim() };
  }
  return {
    title: title || "（タイトルなし）",
    recipe: recipe || text.trim(),
  };
}

export const handler: Schema["suggestMenu"]["functionHandler"] = async (
  event
) => {
  const ingredientText = (event.arguments.ingredientText ?? "").trim();
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

  const userMessage = `以下を踏まえて献立を1つだけ提案してください。\n\n${ingredientText}`;

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2048,
    temperature: 0.6,
    system: SYSTEM_PROMPT,
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

  return menu;
};
