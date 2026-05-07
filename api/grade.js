// Vercel Serverless Function - CommonJS format
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Grader-Version", "2026-05-07.1");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server misconfigured: missing DEEPSEEK_API_KEY" });
    return;
  }

  try {
    let gradingRequest = req.body;

    // Some runtimes may pass body as a raw string or not parse JSON automatically.
    if (typeof gradingRequest === "string") {
      gradingRequest = JSON.parse(gradingRequest);
    }

    if (!gradingRequest || typeof gradingRequest !== "object") {
      // Fallback: manually read raw body
      const raw = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });

      gradingRequest = raw ? JSON.parse(raw) : null;
    }

    const missing = [];
    const hasReasoning = !!(gradingRequest && typeof gradingRequest.student_reasoning === "string" && gradingRequest.student_reasoning.trim().length > 0);
    const hasAnswer = !!(gradingRequest && typeof gradingRequest.student_answer === "string" && gradingRequest.student_answer.trim().length > 0);
    const hasReference = !!(
      gradingRequest &&
      typeof gradingRequest.reference_solution === "string" &&
      gradingRequest.reference_solution.trim().length > 0
    );

    // Require at least one of reasoning/answer, and always require reference_solution.
    if (!hasReasoning && !hasAnswer) missing.push("student_reasoning_or_student_answer");
    if (!hasReference) missing.push("reference_solution");

    if (missing.length > 0) {
      res.status(400).json({
        error: "Missing required fields",
        missing,
      });
      return;
    }

    const result = await gradeWithDeepseek(gradingRequest, apiKey);
    res.status(200).json(result);
  } catch (error) {
    console.error("Grading error:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message || "Unknown error"
    });
  }
};

async function gradeWithDeepseek(request, apiKey) {
  const prompt = buildGradingPrompt(request);

  const deepseekRequest = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: `You are an expert mathematics professor grading student submissions.
Be rigorous but fair. Evaluate based on the provided rubric.
Return your evaluation in the exact JSON format specified.

IMPORTANT: All feedback, suggestions, and explanations must be written in Chinese (中文).`,
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

  const data = await response.json();
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

function buildGradingPrompt(request) {
  return `
Please grade the following mathematics submission according to the rubric below.
Provide all feedback and suggestions in Chinese (中文).

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
