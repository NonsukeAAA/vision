import { describeError, logError, logInfo } from "./diagnostics";

export const GROK_MODELS = [
  { id: "grok-3-mini", label: "Grok 3 Mini（速い・安い）" },
  { id: "grok-3", label: "Grok 3" },
  { id: "grok-4", label: "Grok 4" },
  { id: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast" },
] as const;

export type GrokModelId = (typeof GROK_MODELS)[number]["id"];

export function isGrokModelId(value: unknown): value is GrokModelId {
  return (
    typeof value === "string" &&
    GROK_MODELS.some((m) => m.id === value)
  );
}

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

const SYSTEM_PROMPT = `You write Stable Diffusion prompts for anime / illustration checkpoints (Illustrious, NoobAI, Pony, SDXL anime).

Rules:
- Output ONLY the final prompt text. No quotes, no markdown, no explanation.
- Prefer Danbooru-style English tags separated by commas.
- Keep quality tokens near the front when present (masterpiece, best quality, absurdres, highres, uncensored).
- Preserve erotic / night / cinematic / depth-of-field mood tags when given; keep them soft and intimate, never theatrical or "dramatic lighting".
- Expand sparse tag lists into a coherent subject → appearance → clothing → pose → setting → lighting → camera order.
- Do not invent named characters or copyrights the tags do not support.
- Do not add censorship, mosaic, monochrome, comic, or speech-bubble tags.
- Keep the prompt under ~120 tags / ~1500 characters unless the input is already longer.`;

export type GrokPromptInput = {
  apiKey: string;
  model: string;
  tags: string[];
  currentPrompt?: string;
  caption?: string | null;
  /** Extra user direction, e.g. "more intimate night scene". */
  direction?: string;
  signal?: AbortSignal;
};

export type GrokPromptResult = {
  prompt: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

function scrubKey(key: string): string {
  return key.trim();
}

/** Turn analysis tags into an SD prompt via the xAI Grok API (BYOK in the browser). */
export async function generateSdPromptWithGrok(
  input: GrokPromptInput,
): Promise<GrokPromptResult> {
  const apiKey = scrubKey(input.apiKey);
  if (!apiKey) {
    throw new Error(
      "xAI API キーが未設定です。設定でキーを入力してください（https://console.x.ai）",
    );
  }

  const tagLine =
    input.tags.length > 0
      ? input.tags.join(", ")
      : "(no tags — invent a tasteful illustration prompt from any caption)";
  const parts = [
    "Create one Stable Diffusion prompt from this analysis.",
    `Tags: ${tagLine}`,
  ];
  if (input.currentPrompt?.trim()) {
    parts.push(`Current prompt draft: ${input.currentPrompt.trim()}`);
  }
  if (input.caption?.trim()) {
    parts.push(`Caption: ${input.caption.trim()}`);
  }
  if (input.direction?.trim()) {
    parts.push(`User direction: ${input.direction.trim()}`);
  }

  logInfo("grok prompt start", {
    model: input.model,
    tags: input.tags.length,
    hasDraft: !!input.currentPrompt?.trim(),
  });

  let res: Response;
  try {
    res = await fetch(XAI_CHAT_URL, {
      method: "POST",
      signal: input.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.7,
        max_tokens: 900,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: parts.join("\n") },
        ],
      }),
    });
  } catch (err) {
    logError("grok prompt network", describeError(err));
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("プロンプト生成を中断しました");
    }
    throw new Error(
      "xAI API に接続できませんでした。通信環境を確認してください",
    );
  }

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 200);
    try {
      const parsed = JSON.parse(raw) as { error?: string | { message?: string } };
      if (typeof parsed.error === "string") detail = parsed.error;
      else if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // keep raw slice
    }
    logError("grok prompt http error", {
      status: res.status,
      detail: detail.slice(0, 160),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("xAI API キーが無効です。設定のキーを確認してください");
    }
    if (res.status === 429) {
      throw new Error("xAI の利用上限に達しました。しばらくして再試行してください");
    }
    throw new Error(`Grok 呼び出しに失敗しました（${res.status}: ${detail}）`);
  }

  let data: {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = JSON.parse(raw);
  } catch (err) {
    logError("grok prompt bad json", describeError(err));
    throw new Error("Grok の応答を解釈できませんでした");
  }

  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  const prompt = cleanPromptOutput(text);
  if (!prompt) {
    throw new Error("Grok が空のプロンプトを返しました。再試行してください");
  }

  logInfo("grok prompt done", {
    model: data.model ?? input.model,
    chars: prompt.length,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  });

  return {
    prompt,
    model: data.model ?? input.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    },
  };
}

function cleanPromptOutput(text: string): string {
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  // Drop a leading label if the model ignored instructions.
  out = out.replace(/^(?:prompt|final prompt)\s*[:：]\s*/i, "");
  return out.replace(/\s+\n/g, "\n").trim();
}
