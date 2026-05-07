// Cloudflare Worker: Math Game AI Grading Proxy
// Hides Deepseek API Key from Godot client

export interface Env {
  DEEPSEEK_API_KEY: string;
}

// CORS headers for Godot HTTP requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Grading request from Godot client
interface GradingRequest {
  question_id: string;
  question_title: string;
  question_description: string;
  student_reasoning: string;
  student_answer: string;
  reference_solution: string;
  rubric: {
    reasoning_completeness: number;
    mathematical_rigor: number;
    answer_correctness: number;
    clarity: number;
    depth: number;
  };
  pass_threshold: number;
}

// Deepseek API request format
interface DeepseekRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  temperature: number;
  max_tokens: number;
  response_format: { type: 'json_object' };
}

// Expected response from Deepseek
interface GradingResult {
  total_score: number;
  passed: boolean;
  breakdown: {
    reasoning_completeness: { score: number; feedback: string };
    mathematical_rigor: { score: number; feedback: string };
    answer_correctness: { score: number; feedback: string };
    clarity: { score: number; feedback: string };
    depth: { score: number; feedback: string };
  };
  overall_feedback: string;
  suggestions: string[];
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      const gradingRequest: GradingRequest = await request.json();
      
      // Validate request
      if (!gradingRequest.student_reasoning || !gradingRequest.reference_solution) {
        return jsonResponse({ error: 'Missing required fields' }, 400);
      }

      // Call Deepseek API for grading
      const result = await gradeWithDeepseek(gradingRequest, env.DEEPSEEK_API_KEY);
      
      return jsonResponse(result);
      
    } catch (error) {
      console.error('Grading error:', error);
      return jsonResponse({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }
};

async function gradeWithDeepseek(
  request: GradingRequest, 
  apiKey: string
): Promise<GradingResult> {
  
  const prompt = buildGradingPrompt(request);
  
  const deepseekRequest: DeepseekRequest = {
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: `You are an expert mathematics professor grading student submissions. 
Be rigorous but fair. Evaluate based on the provided rubric.
Return your evaluation in the exact JSON format specified.`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(deepseekRequest)
  });

  if (!response.ok) {
    throw new Error(`Deepseek API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('Empty response from Deepseek API');
  }

  try {
    const parsed = JSON.parse(content) as GradingResult;
    
    // Validate the response structure
    if (typeof parsed.total_score !== 'number' || 
        typeof parsed.passed !== 'boolean' ||
        !parsed.breakdown) {
      throw new Error('Invalid response structure from AI');
    }
    
    return parsed;
    
  } catch (e) {
    console.error('Failed to parse AI response:', content);
    throw new Error('Failed to parse grading result');
  }
}

function buildGradingPrompt(request: GradingRequest): string {
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

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}
