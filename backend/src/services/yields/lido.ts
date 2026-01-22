/**
 * Lido stETH API Service
 * Fetches staking APR for stETH
 */

const LIDO_API_BASE = "https://eth-api.lido.fi/v1/protocol/steth";

export interface LidoAPRResponse {
    apr: number;
    symbol: string;
    timestamp: number;
}

/**
 * Get Lido stETH 7-day Simple Moving Average APR
 */
export async function getLidoAPR(): Promise<LidoAPRResponse | null> {
    try {
        console.log("[Lido] Fetching stETH APR...");

        const response = await fetch(`${LIDO_API_BASE}/apr/sma`);

        if (!response.ok) {
            console.error(`[Lido] API error: ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Response format: { data: { smaApr: 2.51, aprs: [...] }, meta: { symbol: "stETH" } }
        const result: LidoAPRResponse = {
            apr: data.data?.smaApr || 0,
            symbol: data.meta?.symbol || "stETH",
            timestamp: Date.now()
        };

        console.log(`[Lido] stETH APR: ${result.apr.toFixed(2)}%`);
        return result;
    } catch (error) {
        console.error("[Lido] Failed to fetch APR:", error);
        return null;
    }
}

/**
 * Get Lido stETH last recorded APR
 */
export async function getLidoLastAPR(): Promise<LidoAPRResponse | null> {
    try {
        const response = await fetch(`${LIDO_API_BASE}/apr/last`);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        return {
            apr: data.data?.apr || 0,
            symbol: "stETH",
            timestamp: Date.now()
        };
    } catch (error) {
        console.error("[Lido] Failed to fetch last APR:", error);
        return null;
    }
}
