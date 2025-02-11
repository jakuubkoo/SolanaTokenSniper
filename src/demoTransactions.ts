import dotenv from "dotenv";
import {config} from "./config";
import axios from "axios";
import {createSellTransactionResponse, HoldingRecord, LastPriceDexReponse, NewTokenRecord, SoldHoldingRecord, SwapEventDetailsResponse} from "./types";
import * as sqlite3 from "sqlite3";
import {open} from "sqlite";
import {createTableSoldHoldings, insertHolding, insertSoldHolding, removeHolding, selectHoldingByMint, selectTokenByMint} from "./tracker/db";

// Load environment variables from the .env file
dotenv.config();

// Function to send a message to a Telegram bot
async function sendTelegramMessage(message: string) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!config.swap.telegram_log) {
        return;
    }

    if (!botToken || !chatId) {
        console.error("⛔ Telegram bot token or chat ID is missing!");
        return;
    }

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    await axios.post(telegramUrl, {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
    }).catch((err) => console.error("⛔ Telegram Error:", err));
}

export async function simulateBuyTransaction(tokenMint: string): Promise<void> {

    const priceUrl = process.env.JUP_HTTPS_PRICE_URI || "";

    // Open database connection
    const db = await open({
        filename: config.swap.db_name_demo_holdings,
        driver: sqlite3.Database,
    });

    //Get SOL price in USDC
    const solMint = config.liquidity_pool.wsol_pc_mint;
    const priceResponse = await axios.get<any>(priceUrl, {
        params: {
            ids: solMint,
        },
        timeout: config.tx.get_timeout,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Get token price in USDC
    const priceResponseToken = await axios.get<any>(priceUrl, {
        params: {
            ids: tokenMint,
        },
        timeout: config.tx.get_timeout,
    });

    const tokenData = priceResponseToken.data.data[tokenMint];
    const solData = priceResponse.data.data[solMint];

    // Calculate paid price in USDC
    const paidUSDC = solData.price * 1000000000 / 1_000_000_000;

    // Calculate token price in USDC
    const tokenPriceUSDC = tokenData.price ? tokenData.price : await fetchPrice(tokenMint);

    let swapTransactionData: SwapEventDetailsResponse;

    // Fake Transaction Data for Simulation
    swapTransactionData = {
        programInfo: {
            source: "Simulation source",
            account: "Simulation account",
            programName: "Simulation programmName",
            instructionName: "SwapEvent",
        },
        tokenInputs: [{
            fromTokenAccount: "Simulation fromTokenAccount",
            toTokenAccount: "Simulation toTokenAccount",
            fromUserAccount: "Simulation fromUserAccount",
            toUserAccount: "Simulation toUserAccount",
            tokenAmount: 1000000000 / 1_000_000_000, // Solana paid
            mint: "So11111111111111111111111111111111111111112",
            tokenStandard: "Fungible",
        }],
        tokenOutputs: [{
            fromTokenAccount: "Simulation fromTokenAccount",
            toTokenAccount: "Simulation toTokenAccount",
            fromUserAccount: "Simulation fromUserAccount",
            toUserAccount: "Simulation toUserAccount",
            tokenAmount: paidUSDC / tokenPriceUSDC, // Token recieved
            mint: tokenMint, // The actual mint
            tokenStandard: "Fungible",
        }],
        fee: 1004999, //Some fee, TBD: Better estimation instead of fixed
        slot: 1337,
        timestamp: Date.now(),
        description: "Simulated a swap",
    }

    // Verify if we received the price response data
    if (!priceResponse.data.data[solMint]?.price) return;

    // Calculate estimated price paid in sol
    const solUsdcPrice = priceResponse.data.data[solMint]?.price;

    const solPaidUsdc = swapTransactionData.tokenInputs[0].tokenAmount * solUsdcPrice;
    const solFeePaidUsdc = (swapTransactionData.fee / 1_000_000_000) * solUsdcPrice;
    const perTokenUsdcPrice = solPaidUsdc / swapTransactionData.tokenOutputs[0].tokenAmount;

    // Get token meta data
    let tokenName = "N/A";
    const tokenDataa: NewTokenRecord[] = await selectTokenByMint(swapTransactionData.tokenOutputs[0].mint);
    if (tokenDataa) {
        tokenName = tokenDataa[0].name;
    }

    // Add holding to db
    const newHolding: HoldingRecord = {
        Time: swapTransactionData.timestamp,
        Token: swapTransactionData.tokenOutputs[0].mint,
        TokenName: tokenName,
        Balance: swapTransactionData.tokenOutputs[0].tokenAmount,
        SolPaid: swapTransactionData.tokenInputs[0].tokenAmount,
        SolFeePaid: swapTransactionData.fee,
        SolPaidUSDC: solPaidUsdc,
        SolFeePaidUSDC: solFeePaidUsdc,
        PerTokenPaidUSDC: perTokenUsdcPrice,
        Slot: swapTransactionData.slot,
        Program: swapTransactionData.programInfo ? swapTransactionData.programInfo.source : "N/A",
    };

    await insertHolding(newHolding).catch((err) => {
        console.log("⛔ Database Error: " + err);
        return false;
    });

    // Format and send the Telegram message
    const message = `📢 *New Swap Transaction (Simulated)*\n\n` +
        `🪙 *Token:* ${tokenName} (${swapTransactionData.tokenOutputs[0].mint})\n` +
        `📥 *Received:* \`${swapTransactionData.tokenOutputs[0].tokenAmount.toFixed(4)}\`\n` +
        `💰 *Paid in SOL:* \`${swapTransactionData.tokenInputs[0].tokenAmount.toFixed(4)}\`\n` +
        // `💰 *Market Cap:* \`${await fetchMarketCap(swapTransactionData.tokenOutputs[0].mint)}\`\n` +
        `🔍 *Source:* ${swapTransactionData.programInfo.source}`;

    await sendTelegramMessage(message);

}

export async function simulateSellTransaction(solMint: string, tokenMint: string, amount: string): Promise<createSellTransactionResponse> {
    const priceUrl = process.env.JUP_HTTPS_PRICE_URI || "";

    // Open database connection
    const db = await open({
        filename: config.swap.db_name_tracker_holdings,
        driver: sqlite3.Database,
    });

    // Create Table if not exists
    const holdingsTableExist = await createTableSoldHoldings(db);
    if (!holdingsTableExist) {
        console.log("Holdings table not present.");
        // Close the database connection when done
        await db.close();
    }
    
    if (holdingsTableExist) {
        // Get latest price of token in USDC
        const priceResponseToken = await axios.get<any>(priceUrl, {
            params: { ids: tokenMint },
            timeout: config.tx.get_timeout,
        });

        const tokenData = priceResponseToken.data.data[tokenMint];
        //if (!tokenData || !tokenData.price) return; // Exit if price data is missing

        const tokenPriceUSDC = tokenData.price; // Current market price in USDC

        // Fetch holding data from DB
        const existingHoldings: HoldingRecord[] = await selectHoldingByMint(tokenMint);
        if (!existingHoldings || existingHoldings.length === 0) {
            console.log("⚠️ No holdings found for this token.");
            return {
                success: false,
                msg: "Simulated transaction not executed.",
                tx: "",
            };
        }

        const holding = existingHoldings[0]; // Assume first matching holding for simplicity
        const { Balance, SolPaidUSDC, PerTokenPaidUSDC } = holding;

        // Calculate sell values
        const estimatedSellAmountUSDC = Balance * tokenPriceUSDC; // How much we'll receive in USDC
        const estimatedProfitUSDC = estimatedSellAmountUSDC - SolPaidUSDC;
        const soldPerTokenUSDC = tokenPriceUSDC;

        let swapTransactionData: SwapEventDetailsResponse;

        // Fake Transaction Data for Simulation
        swapTransactionData = {
            programInfo: {
                source: "Simulation source",
                account: "Simulation account",
                programName: "Simulation programmName",
                instructionName: "SwapEvent",
            },
            tokenInputs: [{
                fromTokenAccount: "Simulation fromTokenAccount",
                toTokenAccount: "Simulation toTokenAccount",
                fromUserAccount: "Simulation fromUserAccount",
                toUserAccount: "Simulation toUserAccount",
                tokenAmount: Balance, // Selling entire balance
                mint: tokenMint, // The token being sold
                tokenStandard: "Fungible",
            }],
            tokenOutputs: [{
                fromTokenAccount: "Simulation fromTokenAccount",
                toTokenAccount: "Simulation toTokenAccount",
                fromUserAccount: "Simulation fromUserAccount",
                toUserAccount: "Simulation toUserAccount",
                tokenAmount: estimatedSellAmountUSDC, // Receiving USDC
                mint: "USDC", // The stablecoin received
                tokenStandard: "Fungible",
            }],
            fee: 1004999, // Some fixed fee, TBD for accuracy
            slot: 1337,
            timestamp: Date.now(),
            description: "Simulated a swap",
        }

        // Remove holding from database
        await removeHolding(tokenMint);

        // Insert into sold_holdings table
        const soldHolding: SoldHoldingRecord = {
            Time: swapTransactionData.timestamp,
            Token: tokenMint,
            TokenName: holding.TokenName,
            Balance: Balance,
            SolPaid: holding.SolPaid,
            SolFeePaid: holding.SolFeePaid,
            SolPaidUSDC: SolPaidUSDC,
            SolFeePaidUSDC: holding.SolFeePaidUSDC,
            PerTokenPaidUSDC: PerTokenPaidUSDC,
            Slot: swapTransactionData.slot,
            Program: swapTransactionData.programInfo.source || "N/A",
            SoldPriceUSDC: estimatedSellAmountUSDC,
            SoldPerTokenUSDC: soldPerTokenUSDC,
            ProfitUSDC: estimatedProfitUSDC
        };

        await insertSoldHolding(soldHolding).catch((err) => {
            console.log("⛔ Database Error: " + err);
        });

        // Format and send the Telegram message
        const message = `📢 *Simulated Sell Transaction*\n\n` +
            `🪙 *Token:* ${holding.TokenName} (${tokenMint})\n` +
            `📤 *Sold:* \`${Balance.toFixed(4)}\`\n` +
            `💰 *Received USDC:* \`${estimatedSellAmountUSDC.toFixed(4)}\`\n` +
            `📈 *Profit:* \`${estimatedProfitUSDC.toFixed(4)}\`\n` +
            `🔍 *Source:* ${swapTransactionData.programInfo.source}`;

        await sendTelegramMessage(message);

        // Simulate a transaction ID
        const simulatedTxId = `SIMULATED_TX_${Date.now()}`;

        return {
            success: true,
            msg: "Simulated transaction executed successfully.",
            tx: simulatedTxId,
        };
    }
    return {
        success: false,
        msg: "Simulated transaction error.",
        tx: "",
    };
}


// export async function simulateBuyTransaction(tokenMint: string): Promise<void> {
//     // Open database connection
//     const db = await open({
//         filename: config.swap.db_name_demo_holdings,
//         driver: sqlite3.Database,
//     });
//
//     try {
//         // Create table if it does not exist
//         const holdingsTableExist = await createTable(db);
//         if (!holdingsTableExist) {
//             throw new Error("Failed to ensure holdings table exists");
//         }
//
//         const simulatedAmount = "2"; // Amount in base currency (e.g., SOL, USDC)
//
//         // Fetch market cap and price per token
//         const { tokenName, marketCap, pricePerToken } = await fetchMarketCap(tokenMint);
//         if (!pricePerToken || pricePerToken <= 0) {
//             throw new Error("Invalid token price");
//         }
//
//         const tokensReceived = parseFloat(simulatedAmount) / pricePerToken;
//         const timeBought = new Date().toISOString();
//
//         // Insert transaction into SQLite
//         const stmt = await db.prepare(`
//             INSERT INTO transactions (tokenName, tokenMint, marketCap, pricePerToken, amountBought, timeBought)
//             VALUES (?, ?, ?, ?, ?, ?)
//         `);
//
//         await stmt.run(tokenName, tokenMint, marketCap, pricePerToken, tokensReceived, timeBought);
//         await stmt.finalize(); // Close statement to prevent memory leaks
//
//         console.log("✅ Token simulated bought");
//     } catch (error) {
//         console.error("❌ Error processing transaction:", error);
//     } finally {
//         // Ensure database connection is always closed
//         await db.close();
//     }
// }

export async function createTable(database: any): Promise<boolean> {
    try {
        await database.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tokenName TEXT NOT NULL,
                tokenMint TEXT NOT NULL,
                marketCap REAL NOT NULL,
                pricePerToken REAL NOT NULL,
                amountBought REAL NOT NULL,
                timeBought TEXT NOT NULL
            );
        `);
        return true;
    } catch (error: any) {
        return false;
    }
}

async function fetchMarketCap(tokenMint: string): Promise<number> {
    const dexPriceUrl = process.env.DEX_HTTPS_LATEST_TOKENS || "";

    if (!dexPriceUrl) {
        throw new Error("DEX_HTTPS_LATEST_TOKENS environment variable is not set");
    }

    try {
        const response = await axios.get<LastPriceDexReponse>(`${dexPriceUrl}/${tokenMint}`, {
            timeout: config.tx.get_timeout,
        });

        const currentPricesDex: LastPriceDexReponse = response.data;

        return currentPricesDex.pairs[0].marketCap;
    } catch (error) {
        console.error("Error fetching market cap:", error);
        throw new Error("Failed to fetch market cap");
    }
}

async function fetchPrice(tokenMint: string): Promise<number> {
    const dexPriceUrl = process.env.DEX_HTTPS_LATEST_TOKENS || "";

    if (!dexPriceUrl) {
        throw new Error("DEX_HTTPS_LATEST_TOKENS environment variable is not set");
    }

    try {
        const response = await axios.get<LastPriceDexReponse>(`${dexPriceUrl}/${tokenMint}`, {
            timeout: config.tx.get_timeout,
        });

        const currentPricesDex: LastPriceDexReponse = response.data;

        return currentPricesDex.pairs !== null ? parseFloat(currentPricesDex.pairs[0].priceUsd) : 0;
    } catch (error) {
        console.error("Error fetching market cap:", error);
        throw new Error("Failed to fetch market cap");
    }
}