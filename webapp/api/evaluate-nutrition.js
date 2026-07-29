import Anthropic from "@anthropic-ai/sdk";

const TIERS = ["normal", "monitor", "urgent"];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tier: { type: "string", enum: TIERS },
    note: { type: "string", description: "One or two sentences, plain language, addressed directly to the patient." },
    providerNote: { type: "string", description: "One or two sentences of clinical reasoning for the care team." },
  },
  required: ["tier", "note", "providerNote"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You review a single free-text diet entry from a pregnancy/postpartum monitoring app and decide whether it needs a care team's attention.

Flag "monitor" or "urgent" only for content that is clinically meaningful — signs of not eating enough, an eating-disorder pattern, a diet change driven by nausea/vomiting/pain rather than preference, a restriction that could cause a nutrient deficiency given the patient's context (anemia, breastfeeding), or anything that reads as a safety concern. Reserve "urgent" for language suggesting an acute or severe problem (e.g. unable to keep food down, not eating for days, suicidal/self-harm content). A harmless substitution, a normal appetite change, or routine variation in meals is "normal" — do not flag wording changes alone.

Respond only with the structured fields requested.`;

function buildUserPrompt(payload) {
  const {
    dietDescription = "",
    previousDietDescription = "",
    dietRestrictions = [],
    supplements = [],
    anemia = false,
    breastfeeding = false,
    phase = "pre-term",
  } = payload;

  const lines = [
    `Patient phase: ${phase === "post-term" ? "postpartum" : "pregnant"}`,
    `Reported anemia: ${anemia ? "yes" : "no"}`,
    `Breastfeeding: ${breastfeeding ? "yes" : "no"}`,
    `Current dietary restrictions: ${dietRestrictions.length ? dietRestrictions.join(", ") : "none reported"}`,
    `Current supplements: ${supplements.length ? supplements.join(", ") : "none reported"}`,
    `Current diet description: "${dietDescription.trim() || "(not provided)"}"`,
  ];
  if (previousDietDescription.trim()) {
    lines.push(`Previous check-in's diet description: "${previousDietDescription.trim()}"`);
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured" });
    return;
  }

  const payload = req.body || {};
  if (!payload.dietDescription || !payload.dietDescription.trim()) {
    res.status(400).json({ error: "dietDescription is required" });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      messages: [{ role: "user", content: buildUserPrompt(payload) }],
    });

    if (response.stop_reason === "refusal") {
      res.status(200).json({ error: "refusal" });
      return;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No text content in model response" });
      return;
    }

    const parsed = JSON.parse(textBlock.text);
    if (!TIERS.includes(parsed.tier)) {
      res.status(502).json({ error: "Model returned an invalid tier" });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message || "Nutrition review failed" });
  }
}
