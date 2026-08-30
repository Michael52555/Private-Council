import OpenAI from "openai";
import { NextResponse } from "next/server";

type DistanceInterpretationResult = {
  status: "success" | "needs_clarification";
  summary: string;
  maxMiles: number | null;
  clarificationQuestion: string | null;
};

function isValidResult(
  value: unknown,
): value is DistanceInterpretationResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Record<string, unknown>;

  if (
    result.status !== "success" &&
    result.status !== "needs_clarification"
  ) {
    return false;
  }

  if (
    typeof result.summary !== "string" ||
    result.summary.trim() === ""
  ) {
    return false;
  }

  if (result.status === "success") {
    return (
      typeof result.maxMiles === "number" &&
      Number.isFinite(result.maxMiles) &&
      result.maxMiles > 0 &&
      result.clarificationQuestion === null
    );
  }

  return (
    result.maxMiles === null &&
    typeof result.clarificationQuestion === "string" &&
    result.clarificationQuestion.trim() !== ""
  );
}

export async function POST(request: Request) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const body: unknown = await request.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const { statement } = body as {
      statement?: unknown;
    };

    if (
      typeof statement !== "string" ||
      statement.trim() === ""
    ) {
      return NextResponse.json(
        { error: "A preference statement is required." },
        { status: 400 },
      );
    }

    const response = await openai.responses.create({
      model: "gpt-5-mini",

      // Do not retain the response as API application state.
      store: false,

      instructions: [
        "Interpret a user's distance preference.",
        "The preference category is already known to be distance.",
        "Extract only an explicit maximum distance measured in miles.",
        "A bare statement such as '5 miles' means a maximum of 5 miles.",
        "if they include words like 'minimum' or 'least', if there is no maximum then ask. otherwise, just interpret the maximum distance information",
        "Accept phrases such as within, under, at most, maximum, no more than, and do not want to travel more than.",
        "Return success only when there is an explicit positive number of miles.",
        "accept anything like mi, mil",
        "Do not convert kilometers or time into miles.",
        "Do not guess when the statement is vague.",
        "When clarification is needed, ask one concise question.",
      ].join(" "),

      input: statement.trim(),

      text: {
        format: {
          type: "json_schema",
          name: "distance_interpretation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["success", "needs_clarification"],
              },
              summary: {
                type: "string",
              },
              maxMiles: {
                anyOf: [
                  { type: "number" },
                  { type: "null" },
                ],
              },
              clarificationQuestion: {
                anyOf: [
                  { type: "string" },
                  { type: "null" },
                ],
              },
            },
            required: [
              "status",
              "summary",
              "maxMiles",
              "clarificationQuestion",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    if (!response.output_text) {
      throw new Error("The model returned no output.");
    }

    const result: unknown = JSON.parse(response.output_text);

    if (!isValidResult(result)) {
      throw new Error(
        "The model returned an invalid interpretation.",
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Distance interpretation failed:", error);

    return NextResponse.json(
      {
        error: "Could not interpret this distance preference.",
      },
      { status: 500 },
    );
  }
}
