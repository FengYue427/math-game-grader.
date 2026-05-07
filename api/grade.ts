import type { IncomingMessage, ServerResponse } from "http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Server misconfigured: missing DEEPSEEK_API_KEY" }));
    return;
  }

  try {
    // Read request body
    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    const gradingRequest = JSON.parse(body);

    if (!gradingRequest?.student_reasoning || !gradingRequest?.reference_solution) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    const result = await gradeWithDeepseek(gradingRequest, apiKey);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("Grading error:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ 
      error: "Internal server error", 
      message: error instanceof Error ? error.message : "Unknown error" 
    }));
  }
}

async function gradeWithDeepseek(request: any, apiKey: string) {
  const prompt = buildGradingPrompt(request);

  const deepseekRequest = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: `You are an expert mathematics professor grading student submissions.
Be rigorous but fair. Evaluate based on the provided rubric.
Return your evaluation in the exact JSON format specified.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  };

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(deepseekRequest),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Deepseek API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Deepseek API");
  }

  try {
    const parsed = JSON.parse(content);

    if (typeof parsed.total_score !== "number" || typeof parsed.passed !== "boolean" || !parsed.breakdown) {
      throw new Error("Invalid response structure from AI");
    }

    return parsed;
  } catch (_e) {
    console.error("Failed to parse AI response:", content);
    throw new Error("Failed to parse grading result");
  }
}

function buildGradingPrompt(request: any): string {
  return `
Please grade the following mathematics submission according to the rubric below.

## Question
Title: ${request.question_title}
Description: ${request.question_description}

## Reference Solution
${request.reference_solution}

## Student Submission
Reasoning: ${request.student_reasoning}
Final Answer: ${request.student_answer}

## Rubric (Maximum 100 points)
- Reasoning Completeness (${request.rubric.reasoning_completeness}%): Are all steps present? Is the logic flow clear?
- Mathematical Rigor (${request.rubric.mathematical_rigor}%): Are proofs/explanations mathematically sound?
- Answer Correctness (${request.rubric.answer_correctness}%): Is the final answer correct?
- Clarity (${request.rubric.clarity}%): Is the explanation clear and well-organized?
- Depth (${request.rubric.depth}%): Does it show deep understanding or novel insights?

## Pass Threshold
The student needs ${request.pass_threshold} points to pass.

## Output Format
Return ONLY a JSON object with this exact structure:
{
  "total_score": <number 0-100>,
  "passed": <boolean>,
  "breakdown": {
    "reasoning_completeness": { "score": <0-${request.rubric.reasoning_completeness}>, "feedback": "<specific feedback>" },
    "mathematical_rigor": { "score": <0-${request.rubric.mathematical_rigor}>, "feedback": "<specific feedback>" },
    "answer_correctness": { "score": <0-${request.rubric.answer_correctness}>, "feedback": "<specific feedback>" },
    "clarity": { "score": <0-${request.rubric.clarity}>, "feedback": "<specific feedback>" },
    "depth": { "score": <0-${request.rubric.depth}>, "feedback": "<specific feedback>" }
  },
  "overall_feedback": "<2-3 sentences summarizing the submission quality>",
  "suggestions": ["<specific improvement suggestion 1>", "<suggestion 2>", "<suggestion 3>"]
}

IMPORTANT:
1. Return ONLY the JSON object, no markdown formatting
2. Be rigorous - a submission with significant errors should not pass
3. Provide constructive, specific feedback in each category
`;
}
