import { completionDeEventosSse } from "./openrouter_stream.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const sse = [
  `data: ${JSON.stringify({ model: "x-ai/grok-4.7", choices: [{ delta: { role: "assistant", content: "" } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_campaign_detail", arguments: "" } }] } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"id\":1}" } }] } }] })}`,
  `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}`,
  "data: [DONE]",
].join("\n");

const j = completionDeEventosSse(sse) as {
  model: string;
  usage: { prompt_tokens: number };
  choices: { finish_reason: string; message: { content: string; tool_calls: { id: string; function: { name: string; arguments: string } }[] } }[];
};
assert(j.model === "x-ai/grok-4.7", "model");
assert(j.usage.prompt_tokens === 10, "usage");
assert(j.choices[0].finish_reason === "tool_calls", "finish");
assert(j.choices[0].message.tool_calls[0].id === "call_1", "id");
assert(j.choices[0].message.tool_calls[0].function.name === "get_campaign_detail", "nome");
assert(j.choices[0].message.tool_calls[0].function.arguments === "{\"id\":1}", "args");

const prosa = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Gasto " } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: "R$ 10" }, finish_reason: "stop" }] })}`,
  "data: [DONE]",
].join("\n");
const p = completionDeEventosSse(prosa) as { choices: { message: { content: string; tool_calls: unknown[] } }[] };
assert(p.choices[0].message.content === "Gasto R$ 10", "prosa");
assert(p.choices[0].message.tool_calls.length === 0, "sem tool");

console.log("openrouter_stream ok");
