require("dotenv").config();
const apiKey = process.env.GOOGLE_API_KEY;

import {
  GoogleGenerativeAI,
  FunctionDeclaration,
  SchemaType,
} from "@google/generative-ai";
import { Langfuse } from "langfuse";

// Initialize Langfuse client
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY || "sk-lf-...", // Replace with your secret key
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || "pk-lf-...", // Replace with your public key
  baseUrl: process.env.LANGFUSE_URL, // Or your self-hosted URL
});

// Define the stock price function declaration
const stockPriceFunction: FunctionDeclaration = {
  name: "getStockPrice",
  description: "Get the current stock price for a given company symbol",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      symbol: {
        type: SchemaType.STRING,
        description: "The stock symbol (e.g., AAPL for Apple)",
      },
    },
    required: ["symbol"],
  },
};
// Mock stock price function with static response
async function getStockPrice({ symbol }: { symbol: string }): Promise<any> {
  const span = langfuse.span({
    name: "getStockPrice",
    input: { symbol },
  });

  try {
    const result = {
      symbol: symbol.toUpperCase(),
      price: 150.25,
      currency: "USD",
      timestamp: new Date().toISOString(),
    };
    span.update({ output: result });
    span.end();
    return result;
  } catch (error) {
    span.update({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
    });
    span.end();
    throw error;
  }
}
// Main class to handle Gemini API interactions with Langfuse observability
class StockPriceBot {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(apiKey!);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [{ functionDeclarations: [stockPriceFunction] }],
    });
  }
  async processQuery(userQuery: string): Promise<string> {
    const trace = langfuse.trace({
      name: "processQuery",
      input: { query: userQuery },
      metadata: { environment: "development" },
    });

    try {
      // Enhanced chat span with payload and response details
      const chatSpan = trace.span({
        name: "startChat",
        input: { history: [] }, // Initial payload (empty history in this case)
      });
      const chat = this.model.startChat({ history: [] });
      chatSpan.update({
        output: { chatSessionStarted: true },
      });
      chatSpan.end();

      const sendMessageSpan = trace.span({
        name: "sendMessage",
        input: { message: userQuery }, // Payload sent to the model
      });
      const result = await chat.sendMessage(userQuery);
      const response = result.response;
      const functionCalls = response.functionCalls();
      sendMessageSpan.update({
        output: {
          rawResponse: response,
          responseText: response.text(),
          hasFunctionCalls: !!functionCalls,
          functionCalls: functionCalls
            ? functionCalls.map((fc: any) => ({
                name: fc.name,
                args: fc.args,
              }))
            : [],
        },
      });
      sendMessageSpan.end();

      if (functionCalls && functionCalls.length > 0) {
        trace.update({
          metadata: { functionCallsDetected: functionCalls.length },
        });
        for (const functionCall of functionCalls) {
          if (functionCall.name === "getStockPrice") {
            trace.event({
              name: "functionCallDetected",
              input: { functionName: "getStockPrice", args: functionCall.args },
            });

            const stockData = await getStockPrice({
              symbol: functionCall.args.symbol,
            });

            const responseSpan = trace.span({
              name: "sendFunctionResponse",
              input: {
                functionResponse: {
                  name: "getStockPrice",
                  response: stockData,
                },
              },
            });
            const functionResponse = await chat.sendMessage([
              {
                functionResponse: {
                  name: "getStockPrice",
                  response: stockData,
                },
              },
            ]);
            const finalResponse = functionResponse.response.text();
            responseSpan.update({ output: { response: finalResponse } });
            responseSpan.end();

            trace.update({ output: { finalResponse } });
            return finalResponse;
          }
        }
      }

      const textResponse = response.text();
      trace.update({ output: { response: textResponse } });
      return textResponse;
    } catch (error) {
      trace.event({
        name: "error",
        input: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}
// Usage example
async function main() {
  const bot = new StockPriceBot();

  const queries = ["What's the current stock price of Apple?"];

  for (const query of queries) {
    try {
      const response = await bot.processQuery(query);
      console.log(`Query: ${query}`);
      console.log(`Response: ${response}\n`);
    } catch (error) {
      console.error(`Error for query "${query}":`, error);
    }
  }

  // Ensure all events are sent before exiting
  await langfuse.shutdownAsync();
}

main().catch(console.error);
