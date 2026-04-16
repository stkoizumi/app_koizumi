import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Schema } from "../../data/resource";

const DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const MAX_RECOMMENDATIONS = 3;

const SYSTEM_PROMPT = `あなたは家庭料理に詳しい料理研究家です。一般的で親しみやすいおすすめ料理を3つ提案してください。

条件:
- 日本の家庭で作りやすい料理を選ぶこと
- 20分前後で作りやすい料理を優先すること
- 料理名は重複させないこと
- 分量は1人前の目安で書くこと
- 出力は必ず3件ちょうどにすること
- 各レシピは必ず「材料」と「手順」を分けること
- 材料は1行につき1品目で、「材料名 | 分量」の形式にすること
- 手順には材料を書かないこと

出力は次のフォーマットに厳密に従い、前置き・挨拶・補足は書かないこと。

【おすすめ1 料理名】
（料理名）

【おすすめ1 レシピ】
【材料】
材料名 | 分量
材料名 | 分量

【手順】
1. 手順
2. 手順

【おすすめ2 料理名】
（料理名）

【おすすめ2 レシピ】
【材料】
材料名 | 分量
材料名 | 分量

【手順】
1. 手順
2. 手順

【おすすめ3 料理名】
（料理名）

【おすすめ3 レシピ】
【材料】
材料名 | 分量
材料名 | 分量

【手順】
1. 手順
2. 手順`;

function parseRecommendedMenusResponse(
  text: string
): Array<{ title: string; recipe: string }> {
  const items: Array<{ title: string; recipe: string }> = [];

  for (let index = 1; index <= MAX_RECOMMENDATIONS; index += 1) {
    const titleMatch = text.match(
      new RegExp(
        `【おすすめ${index} 料理名】\\s*([\\s\\S]*?)(?=【おすすめ${index} レシピ】|$)`
      )
    );
    const recipeMatch = text.match(
      new RegExp(
        `【おすすめ${index} レシピ】\\s*([\\s\\S]*?)(?=【おすすめ${index + 1} 料理名】|$)`
      )
    );

    const title = titleMatch?.[1]?.trim() ?? "";
    const recipe = recipeMatch?.[1]?.trim() ?? "";

    if (!title && !recipe) {
      continue;
    }

    items.push({
      title: title || `おすすめ料理${index}`,
      recipe,
    });
  }

  return items;
}

export const handler: Schema["recommendMenus"]["functionHandler"] = async () => {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません。");
  }

  const modelId = process.env.MENU_SUGGEST_MODEL_ID ?? DEFAULT_MODEL_ID;
  const client = new BedrockRuntimeClient({ region });

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 3072,
    temperature: 0.7,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "今日のおすすめ料理を3件提案してください。",
          },
        ],
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
  const textBlock = parsed.content?.find((content) => content.type === "text" && content.text);
  const text = textBlock?.text?.trim() ?? "";
  if (!text) {
    throw new Error("モデルからテキストを取得できませんでした。");
  }

  const items = parseRecommendedMenusResponse(text).slice(0, MAX_RECOMMENDATIONS);
  if (items.length === 0) {
    throw new Error("おすすめ料理データを取得できませんでした。");
  }

  return items;
};
