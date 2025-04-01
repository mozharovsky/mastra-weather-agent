import { openai } from "@ai-sdk/openai";
import { serve } from "@hono/node-server";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { config } from "dotenv";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";

config();

// =====================================================================
// SECTION 1: Types and Schemas
// =====================================================================

interface UserContext {
  userName: string;
  userRole: string;
}

type Variables = {
  userContext: UserContext;
};

const depsSchema = z.object({
  weatherApiKey: z.string(),
  temperatureUnit: z.enum(["celsius", "fahrenheit"]),
  userName: z.string(),
  userRole: z.string(),
});

type DependenciesType = z.infer<typeof depsSchema>;

// =====================================================================
// SECTION 2: Weather Service Implementation
// =====================================================================

async function fetchWeather(
  location: string,
  { weatherApiKey, temperatureUnit }: { weatherApiKey: string; temperatureUnit: "celsius" | "fahrenheit" },
) {
  const units = temperatureUnit === "celsius" ? "metric" : "imperial";
  const loc = encodeURIComponent(location);
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${loc}&appid=${weatherApiKey}&units=${units}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error fetching weather: ${response.statusText}`);
  }

  const dataSchema = z.object({
    name: z.string(),
    main: z.object({
      temp: z.number(),
      humidity: z.number(),
    }),
    weather: z.array(
      z.object({
        description: z.string(),
      }),
    ),
  });

  const data = dataSchema.parse(await response.json());

  return {
    location: data.name,
    temperature: data.main.temp,
    conditions: data.weather[0]?.description ?? "unknown",
    humidity: `${data.main.humidity}%`,
    unit: temperatureUnit,
  };
}

// =====================================================================
// SECTION 3: Mastra Agent Setup
// =====================================================================

const weatherTool = createTool({
  id: "getWeatherForecast",
  description: "Get the current weather forecast for a location",
  inputSchema: z.object({
    location: z.string().describe("The city or location to get weather for"),
  }),
  dependenciesSchema: depsSchema,
  execute: async ({ context, dependencies }) => {
    return await fetchWeather(context.location, {
      weatherApiKey: dependencies.weatherApiKey,
      temperatureUnit: dependencies.temperatureUnit,
    });
  },
});

function buildInstructions(context: { dependencies: DependenciesType }) {
  return `You are an agent that can fetch weather information. 

<user_context>
  <name>${context.dependencies.userName}</name>
  <role>${context.dependencies.userRole}</role>
  <preferences>
    <temperature_unit>${context.dependencies.temperatureUnit}</temperature_unit>
  </preferences>
</user_context>

<instructions>
  1. Always start with a personalized greeting that includes the user's name and role
  2. Use the getWeatherForecast tool to fetch current weather data
  3. Format your response with temperature in ${context.dependencies.temperatureUnit}
  4. Include all available data: temperature, conditions, and humidity
  5. Keep responses friendly but concise
</instructions>

<examples>
  <example>
    <user_query>What is the weather in New York?</user_query>
    <response>
      Hello Alice (admin)! I'd be happy to check the weather in New York for you.
      
      Current conditions in New York:
      🌡️ Temperature: 72°F
      🌤️ Conditions: partly cloudy
      💧 Humidity: 65%
      
      Is there anything else you'd like to know about the weather?
    </response>
  </example>
  
  <example>
    <user_query>How's the weather in Tokyo?</user_query>
    <response>
      Hi John (guest)! Let me get the current weather information for Tokyo.
      
      Current conditions in Tokyo:
      🌡️ Temperature: 26°C
      ☀️ Conditions: clear sky
      💧 Humidity: 48%
      
      Would you like weather information for any other location?
    </response>
  </example>
</examples>`;
}

const agent = new Agent({
  name: "WeatherAgent",
  instructions: buildInstructions,
  model: openai("gpt-4o"),
  dependenciesSchema: depsSchema,
  tools: { weatherTool },
});

// =====================================================================
// SECTION 4: Hono Web Server Setup
// =====================================================================

const app = new Hono<{ Variables: Variables }>();

app.use("*", logger());

// =====================================================================
// SECTION 5: Context Middleware
// =====================================================================

app.use("*", async (context, next) => {
  const userContext: UserContext = {
    userName: context.req.header("X-User-Name") ?? "Anonymous",
    userRole: context.req.header("X-User-Role") ?? "guest",
  };

  context.set("userContext", userContext);
  await next();
});

// =====================================================================
// SECTION 6: Weather API Endpoint
// =====================================================================

app.post("/weather", async context => {
  const body = await context.req.json<unknown>();
  const querySchema = z.object({ location: z.string() });

  try {
    const { location } = querySchema.parse(body);
    const userContext = context.get("userContext");

    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      throw new Error("Missing WEATHER_API_KEY environment variable");
    }

    const dependencies: DependenciesType = {
      weatherApiKey: apiKey,
      temperatureUnit: "fahrenheit",
      userName: userContext.userName,
      userRole: userContext.userRole,
    };

    const result = await agent.generate(`What is the weather in ${location}?`, {
      dependencies,
    });

    return context.json({
      success: true,
      message: result.text,
    });
  } catch (error) {
    console.error("Error:", error);
    return context.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400,
    );
  }
});

// =====================================================================
// SECTION 7: Start Server
// =====================================================================

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

serve({ fetch: app.fetch, port }, info => {
  console.log(`Server is running on http://localhost:${info.port}`);
  console.log(`Try it out:`);
  console.log(`curl -X POST http://localhost:${info.port}/weather \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "X-User-Name: Alice" \\`);
  console.log(`  -H "X-User-Role: admin" \\`);
  console.log(`  -d '{"location": "San Francisco"}'`);
});
