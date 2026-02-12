
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env relative to this file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const GROQ_API_KEY = process.env.GROQ_API_KEY;

export interface SearchResult {
    query: string;
    answer: string;
    results: Array<{
        title: string;
        url: string;
        content: string;
    }>;
}

/**
 * Search the web using Groq Compound system.
 * Compound uses /chat/completions endpoint with built-in web search.
 */
export async function searchWeb(query: string): Promise<SearchResult | null> {
    if (!GROQ_API_KEY) {
        console.error("GROQ_API_KEY is not set");
        return null;
    }

    try {
        console.log(`[Groq] 🔍 Searching web for: "${query}"...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        // Compound uses /chat/completions, not /responses
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "groq/compound",
                messages: [{
                    role: "user",
                    content: query
                }]
                // Compound automatically uses web search when needed
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq API Error: ${response.status} ${response.statusText} - ${errText}`);
        }

        const data = await response.json();
        const info = data.choices?.[0]?.message?.content || "";

        return {
            query: query,
            answer: info,
            results: [{
                title: "Groq Compound Search",
                url: "https://groq.com",
                content: info
            }]
        };

    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error("[Groq] Search request timed out after 15s");
        } else {
            console.error("[Groq] Search error:", error.message);
        }
        return null;
    }
}
