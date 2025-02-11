import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { config } from "./src/config";
import * as sqlite3 from "sqlite3";
import {open} from "sqlite";

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

async function getCurrentProfit(): Promise<number> {
    // Open database connection
    const db = await open({
        filename: config.swap.db_name_tracker_holdings,
        driver: sqlite3.Database,
    });
  
    try {
      const row = await db.get<{ totalProfit: number }>(
        "SELECT SUM(ProfitUSDC) as totalProfit FROM sold_holdings"
      );
  
      return row?.totalProfit || 0;
    } catch (error) {
      console.error("Error fetching profit:", error);
      return 0;
    } finally {
      await db.close();
    }
  }

// Command /profit
bot.command("profit", async (ctx) => {
  const profit = await getCurrentProfit();
  ctx.reply(`📊 Realized Profit: ${profit.toFixed(2)} USDC`);
});

// Start bot
bot.launch().then(() => {
  console.log("🤖 Bot is running...");
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
