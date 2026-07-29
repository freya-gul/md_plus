import Anthropic from "@anthropic-ai/sdk";
import { ACOG_CONTENT } from "../shared/acogContent.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    onTopic: { type: "boolean", description: "False if the question falls outside this topic's scope." },
    answer: { type: "string", description: "3-5 sentences, plain language, addressed directly to the patient." },
  },
  required: ["onTopic", "answer"],
  additionalProperties: false,
};

function buildSystemPrompt(subject) {
  return `You are a patient-education assistant embedded in a pregnancy/postpartum monitoring app. You answer questions ONLY about: ${subject.scope}.

Below is reference text taken directly from ACOG's own patient FAQ pages on this topic. Treat it as your primary, authoritative source — answer from it whenever it covers the question, and prefer its exact numbers and wording over your own general knowledge.

--- ACOG REFERENCE TEXT (${subject.label}) ---
${subject.excerpt}
--- END REFERENCE TEXT ---

Rules:
- If the reference text above answers the question, base your answer on it directly. If it doesn't cover the question but the question is still within scope, you may supplement with well-established guidance from ACOG and other major validated clinical bodies (CDC, WHO, AAP, Academy of Breastfeeding Medicine, Cleveland Clinic, Mayo Clinic) — but never invent specific numbers, citations, or URLs you're not confident about.
- If the question is unrelated to this topic (${subject.label}), set onTopic to false and write a brief, warm answer that says this falls outside this topic and suggests checking the relevant topic in the Education section, or contacting their care team — do not attempt to answer the off-topic question.
- If the question asks for a personal diagnosis, a medication dose, or anything specific to this one patient's situation, give general educational information only and clearly recommend they contact their care team for anything specific to them. Still set onTopic to true if the underlying subject matches.
- If the question describes a possible emergency (e.g. chest pain, heavy bleeding, thoughts of self-harm, trouble breathing, severe headache with vision changes, no fetal movement), tell them to contact their care team immediately or seek emergency care / call 911, and set onTopic to true.
- Keep answers concise (3-5 sentences), plain language, warm tone.
- Never contradict ACOG guidance.

Respond only with the structured fields requested.`;
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

  const { subject: subjectKey, question } = req.body || {};
  const subject = ACOG_CONTENT[subjectKey];
  if (!subject) {
    res.status(400).json({ error: "Unknown or missing subject" });
    return;
  }
  if (!question || !question.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 512,
      system: buildSystemPrompt(subject),
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      messages: [{ role: "user", content: question.trim() }],
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
    if (typeof parsed.answer !== "string") {
      res.status(502).json({ error: "Model returned an invalid response" });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message || "Education Q&A failed" });
  }
}
