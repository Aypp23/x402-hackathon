/**
 * Wallet Analysis Script
 * Uses Alchemy APIs to get comprehensive wallet data
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getWalletAnalytics } from "../src/services/alchemy.js";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const WALLET_ADDRESS = "0x34676Ff553357C1B2887c6FBaaFa6f9270D6ee92";

async function main() {
    console.log("=".repeat(80));
    console.log("COMPREHENSIVE WALLET ANALYSIS");
    console.log("=".repeat(80));
    console.log(`Wallet: ${WALLET_ADDRESS}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log("=".repeat(80));
    console.log("");

    try {
        console.log("Fetching data from Alchemy across multiple chains...\n");
        const analytics = await getWalletAnalytics(WALLET_ADDRESS);

        if (!analytics) {
            console.log("❌ Failed to fetch wallet analytics");
            return;
        }

        // Build report
        let report = "";
        report += "=".repeat(80) + "\n";
        report += "COMPREHENSIVE WALLET ANALYSIS REPORT\n";
        report += "=".repeat(80) + "\n";
        report += `Wallet Address: ${WALLET_ADDRESS}\n`;
        report += `ENS Name: ${analytics.ensName || "None"}\n`;
        report += `Report Generated: ${new Date().toISOString()}\n`;
        report += "=".repeat(80) + "\n\n";

        // Portfolio Summary
        report += "--- PORTFOLIO SUMMARY ---\n\n";
        report += `Total Portfolio Value: $${analytics.portfolio.totalValueUsd.toFixed(2)}\n`;
        report += `Total Tokens: ${analytics.portfolio.tokens.length}\n`;
        report += `Total NFTs: ${analytics.portfolio.nfts.length}\n\n`;

        // Wallet Stats
        report += "--- WALLET STATISTICS ---\n\n";
        report += `Transaction Count: ${analytics.stats.txCount}\n`;
        report += `Wallet Age: ${analytics.stats.ageDays} days\n`;
        report += `Total Gas Spent: ${analytics.stats.totalGasSpentEth.toFixed(6)} ETH\n\n`;

        // Token Holdings
        report += "--- TOKEN HOLDINGS ---\n\n";
        if (analytics.portfolio.tokens.length > 0) {
            report += "| Network | Token | Balance | Value (USD) |\n";
            report += "|---------|-------|---------|-------------|\n";
            for (const token of analytics.portfolio.tokens.sort((a, b) => b.valueUsd - a.valueUsd)) {
                if (token.valueUsd > 0.01) { // Only show tokens worth more than $0.01
                    report += `| ${token.network} | ${token.symbol} | ${token.balance.toFixed(6)} | $${token.valueUsd.toFixed(2)} |\n`;
                }
            }
        } else {
            report += "No tokens found.\n";
        }
        report += "\n";

        // NFT Holdings
        report += "--- NFT HOLDINGS ---\n\n";
        if (analytics.portfolio.nfts.length > 0) {
            for (const nft of analytics.portfolio.nfts.slice(0, 10)) {
                report += `- ${nft.collectionName || "Unknown"} #${nft.tokenId} (${nft.network})\n`;
                if (nft.floorPriceEth) {
                    report += `  Floor: ${nft.floorPriceEth} ETH\n`;
                }
            }
            if (analytics.portfolio.nfts.length > 10) {
                report += `... and ${analytics.portfolio.nfts.length - 10} more NFTs\n`;
            }
        } else {
            report += "No NFTs found.\n";
        }
        report += "\n";

        // Recent Transactions
        report += "--- RECENT TRANSACTIONS ---\n\n";
        if (analytics.history.length > 0) {
            report += "| Network | Type | Asset | Amount | Counterparty |\n";
            report += "|---------|------|-------|--------|-------------|\n";
            for (const tx of analytics.history.slice(0, 15)) {
                const counterparty = tx.counterparty ? `${tx.counterparty.slice(0, 10)}...` : "N/A";
                report += `| ${tx.network} | ${tx.type} | ${tx.asset} | ${tx.amount.toFixed(4)} | ${counterparty} |\n`;
            }
            if (analytics.history.length > 15) {
                report += `\n... and ${analytics.history.length - 15} more transactions\n`;
            }
        } else {
            report += "No recent transactions found.\n";
        }
        report += "\n";

        report += "=".repeat(80) + "\n";
        report += "END OF REPORT\n";
        report += "=".repeat(80) + "\n";

        // Print to console
        console.log(report);

        // Save to file
        const outputPath = path.join(__dirname, "../../wallet_analysis_0x34676Ff553357C1B2887c6FBaaFa6f9270D6ee92.txt");
        fs.writeFileSync(outputPath, report);
        console.log(`\n✅ Report saved to: ${outputPath}`);

    } catch (error) {
        console.error("Error:", error);
    }
}

main();
