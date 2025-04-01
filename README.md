# Mastra Weather Agent Example

> [!WARNING]
> This example uses runtime dependency injection and dynamic instruction builders based on [PR #3033](https://github.com/mastra-ai/mastra/pull/3033/). These features are not finalized and may change significantly. Use at your own risk.

This example demonstrates:

- Using Mastra for building AI agents with runtime dependency injection
- Creating a weather service with Hono for HTTP handling
- Passing context from HTTP headers to agent dependencies

## Installation

```bash
bun i
```

## Running

```bash
bun run dev
```

## Testing

Then use curl to test:

```bash
curl -X POST http://localhost:3000/weather \
  -H "Content-Type: application/json" \
  -H "X-User-Name: Alice" \
  -H "X-User-Role: admin" \
  -d '{"location": "San Francisco"}'
```

## Requirements

This project requires the following environment variables:

- `WEATHER_API_KEY` from [OpenWeatherMap](https://openweathermap.org/)
- `OPENAI_API_KEY` from [OpenAI](https://platform.openai.com/)
