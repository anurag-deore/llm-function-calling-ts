import { Ollama } from "ollama";

// Add two numbers function
function addTwoNumbers(args: { a: number; b: number }): number {
  return args.a + args.b;
}

// Subtract two numbers function
function subtractTwoNumbers(args: { a: number; b: number }): number {
  return args.a - args.b;
}

// Tool definition for add function
const addTwoNumbersTool = {
  type: "function",
  function: {
    name: "addTwoNumbers",
    description: "Add two numbers together",
    parameters: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: { type: "number", description: "The first number" },
        b: { type: "number", description: "The second number" },
      },
    },
  },
};

// Tool definition for subtract function
const subtractTwoNumbersTool = {
  type: "function",
  function: {
    name: "subtractTwoNumbers",
    description: "Subtract two numbers",
    parameters: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: { type: "number", description: "The first number" },
        b: { type: "number", description: "The second number" },
      },
    },
  },
};

async function run(model: string) {
  const ollama = new Ollama({ host: "http://192.168.29.73:8080" });

  const messages = [{ role: "user", content: "What is three minus one?" }];
  console.log("Prompt:", messages[0].content);

  const availableFunctions = {
    addTwoNumbers: addTwoNumbers,
    subtractTwoNumbers: subtractTwoNumbers,
  };

  const response = await ollama.chat({
    model: model,
    messages: messages,
    tools: [addTwoNumbersTool, subtractTwoNumbersTool],
  });

  let output: number;
  console.log(response);
  if (response.message.tool_calls) {
    // Process tool calls from the response
    for (const tool of response.message.tool_calls) {
      const functionToCall =
        availableFunctions[
          tool.function.name as keyof typeof availableFunctions
        ];
      if (functionToCall) {
        console.log("Calling function:", tool.function.name);
        console.log("Arguments:", tool.function.arguments);
        output = functionToCall(tool.function.arguments as unknown as any);
        console.log("Function output:", output);

        // Add the function response to messages for the model to use
        messages.push(response.message);
        messages.push({
          role: "tool",
          content: output.toString(),
        });
      } else {
        console.log("Function", tool.function.name, "not found");
      }
    }

    // Get final response from model with function outputs
    const finalResponse = await ollama.chat({
      model: model,
      messages: messages,
    });
    console.log("Final response:", finalResponse.message.content);
  } else {
    console.log("No tool calls returned from model");
  }
}
run("qwen2.5:3b").catch((error) => console.error("An error occurred:", error));
