import OpenAI from "openai";
import { NextResponse } from "next/server";

type InterpretBudgetRequest = {
  statement?: unknown;
};

type BudgetInterpretation = {
  status: "success" | "needs_clarification";
  summary: string;
  maxPriceDollarsPerPerson: number | null;
  minPriceDollarsPerPerson: number | null;
  clarificationQuestion: string | null;
};

export async function POST(request: Request) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const body =
      (await request.json()) as InterpretBudgetRequest;

    const statement =
      typeof body.statement === "string"
        ? body.statement.trim()
        : "";

    if (!statement) {
      return NextResponse.json(
        {
          error:
            "A budget preference statement is required.",
        },
        { status: 400 },
      );
    }

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      store: false,

      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `
You interpret restaurant budget preferences.

Extract the user's preferred restaurant spending level in US dollars per person.

The user may express:
- a minimum amount,
- a preferred target,
- a maximum amount,
- or a preferred range.

Examples:
- "At most $40 per person"
  means maxPriceDollarsPerPerson = 40.

- "At least $25 per person"
  means minPriceDollarsPerPerson = 25.

- "Between $25 and $45 per person"
  means minPriceDollarsPerPerson = 25
  and maxPriceDollarsPerPerson = 45.

- "Around $35 per person"
  means preferredDollarsPerPerson = 35.

- "No more than $120 total for four people"
  means maxPriceDollarsPerPerson = 30.

- "$$ is fine"
  is ambiguous because it does not provide exact dollar values.

- "Somewhere cheap"
  is ambiguous.

If a total group budget is given without the number of people,
ask for clarification.

Return status "success" when at least one valid positive numeric
budget value per person can be determined.

When successful:
- At least one of minPriceDollarsPerPerson,
  preferredDollarsPerPerson,
  or maxPriceDollarsPerPerson must be a positive number.
- clarificationQuestion must be null.

When clarification is required:
- all three numeric fields must be null.
- clarificationQuestion must contain one concise question.

Do not assume that cheaper is always better.
Do not invent numeric values.
.trim(),

Examples:
- "At most $30 per person" means 30.
- "Around $25 each" means 25.
- "$$ is fine" is ambiguous because it does not provide an exact dollar amount.
- "Cheap" is ambiguous.
- "No more than 100 dollars total for four people" means 25 per person.
- If the number of people is missing for a total group budget, ask for clarification.

Return success only when a clear numeric maximum budget per person can be determined.

Do not invent a number.
              `.trim(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: statement,
            },
          ],
        },
      ],

      text: {
        format: {
          type: "json_schema",
          name: "budget_interpretation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              status: {
                type: "string",
                enum: [
                  "success",
                  "needs_clarification",
                ],
              },
              summary: {
                type: "string",
              },
              maxPriceDollarsPerPerson: {
                type: ["number", "null"],
              },
              minPriceDollarsPerPerson: {
                type: ["number", "null"],
              },
              clarificationQuestion: {
                type: ["string", "null"],
              },
            },
            required: [
              "status",
              "summary",
              "maxPriceDollarsPerPerson",
              "minPriceDollarsPerPerson",
              "clarificationQuestion",
            ],
          },
        },
      },
    });

    const result = JSON.parse(
      response.output_text,
    ) as BudgetInterpretation;

    if (
      result.status === "success" &&
      (
        typeof result.maxPriceDollarsPerPerson !==
          "number" ||
        result.maxPriceDollarsPerPerson <= 0
      )
    ) {
      return NextResponse.json(
        {
          error:
            "The budget interpretation returned an invalid amount.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "Budget interpretation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not interpret the budget preference.",
      },
      { status: 500 },
    );
  }
}
