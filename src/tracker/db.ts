import * as sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "./../config";
import { HoldingRecord, NewTokenRecord, SoldHoldingRecord } from "../types";

// Tracker
export async function createTableHoldings(database: any): Promise<boolean> {
  try {
    await database.exec(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      Time INTEGER NOT NULL,
      Token TEXT NOT NULL,
      TokenName TEXT NOT NULL,
      Balance REAL NOT NULL,
      SolPaid REAL NOT NULL,
      SolFeePaid REAL NOT NULL,
      SolPaidUSDC REAL NOT NULL,
      SolFeePaidUSDC REAL NOT NULL,
      PerTokenPaidUSDC REAL NOT NULL,
      Slot INTEGER NOT NULL,
      Program TEXT NOT NULL
    );
  `);
    return true;
  } catch (error: any) {
    return false;
  }
}

export async function createTableSoldHoldings(database: any): Promise<boolean> {
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS sold_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Time INTEGER NOT NULL, -- Time of sale
        Token TEXT NOT NULL,
        TokenName TEXT NOT NULL,
        Balance REAL NOT NULL,
        SolPaid REAL NOT NULL, -- Original cost in SOL
        SolFeePaid REAL NOT NULL, -- Fees paid in SOL
        SolPaidUSDC REAL NOT NULL, -- Original cost in USDC
        SolFeePaidUSDC REAL NOT NULL, -- Fees paid in USDC
        PerTokenPaidUSDC REAL NOT NULL, -- Original cost per token in USDC
        Slot INTEGER NOT NULL,
        Program TEXT NOT NULL,
        SoldPriceUSDC REAL NOT NULL, -- Total sold price in USDC
        SoldPerTokenUSDC REAL NOT NULL, -- Sold price per token in USDC
        ProfitUSDC REAL NOT NULL -- Profit/loss in USDC
      );
    `);
    return true;
  } catch (error: any) {
    return false;
  }
}

export async function insertSoldHolding(soldHolding: SoldHoldingRecord) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const soldHoldingsTableExist = await createTableSoldHoldings(db);
  if (!soldHoldingsTableExist) {
    await db.close();
  }

  // Proceed with adding sold holding
  if (soldHoldingsTableExist) {
    const { Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program, SoldPriceUSDC, SoldPerTokenUSDC, ProfitUSDC } = soldHolding;
    
    await db.run(
      `
      INSERT INTO sold_holdings (Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program, SoldPriceUSDC, SoldPerTokenUSDC, ProfitUSDC)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program, SoldPriceUSDC, SoldPerTokenUSDC, ProfitUSDC]
    );

    await db.close();
  }
}

export async function removeSoldHolding(tokenMint: string) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Proceed with deleting the sold holding
  await db.run(
    `
    DELETE FROM sold_holdings
    WHERE Token = ?;
    `,
    [tokenMint]
  );

  await db.close();
}


export async function insertHolding(holding: HoldingRecord) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const holdingsTableExist = await createTableHoldings(db);
  if (!holdingsTableExist) {
    await db.close();
  }

  // Proceed with adding holding
  if (holdingsTableExist) {
    const { Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program } = holding;
    await db.run(
      `
    INSERT INTO holdings (Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `,
      [Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program]
    );

    await db.close();
  }
}

export async function removeHolding(tokenMint: string) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Proceed with deleting the holding
  await db.run(
    `
    DELETE FROM holdings
    WHERE Token = ?;
    `,
    [tokenMint]
  );

  await db.close();
}

// New token duplicates tracker
export async function createTableNewTokens(database: any): Promise<boolean> {
  try {
    await database.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER NOT NULL,
      name TEXT NOT NULL,
      mint TEXT NOT NULL,
      creator TEXT NOT NULL
    );
  `);
    return true;
  } catch (error: any) {
    return false;
  }
}

export async function insertNewToken(newToken: NewTokenRecord) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const newTokensTableExist = await createTableNewTokens(db);
  if (!newTokensTableExist) {
    await db.close();
  }

  // Proceed with adding holding
  if (newTokensTableExist) {
    const { time, name, mint, creator } = newToken;

    await db.run(
      `
    INSERT INTO tokens (time, name, mint, creator)
    VALUES (?, ?, ?, ?);
  `,
      [time, name, mint, creator]
    );

    await db.close();
  }
}

export async function selectTokenByNameAndCreator(name: string, creator: string): Promise<NewTokenRecord[]> {
  // Open the database
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const newTokensTableExist = await createTableNewTokens(db);
  if (!newTokensTableExist) {
    await db.close();
    return [];
  }

  // Query the database for matching tokens
  const tokens = await db.all(
    `
    SELECT * 
    FROM tokens
    WHERE name = ? OR creator = ?;
  `,
    [name, creator]
  );

  // Close the database
  await db.close();

  // Return the results
  return tokens;
}

export async function selectTokenByMint(mint: string): Promise<NewTokenRecord[]> {
  // Open the database
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const newTokensTableExist = await createTableNewTokens(db);
  if (!newTokensTableExist) {
    await db.close();
    return [];
  }

  // Query the database for matching tokens
  const tokens = await db.all(
    `
    SELECT * 
    FROM tokens
    WHERE mint = ?;
  `,
    [mint]
  );

  // Close the database
  await db.close();

  // Return the results
  return tokens;
}

export async function selectAllTokens(): Promise<NewTokenRecord[]> {
  // Open the database
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const newTokensTableExist = await createTableNewTokens(db);
  if (!newTokensTableExist) {
    await db.close();
    return [];
  }

  // Query the database for matching tokens
  const tokens = await db.all(
    `
    SELECT * 
    FROM tokens;
  `
  );

  // Close the database
  await db.close();

  // Return the results
  return tokens;
}

export async function selectHoldingByMint(tokenMint: string): Promise<HoldingRecord[]> {
  const db = await open({
      filename: config.swap.db_name_tracker_holdings,
      driver: sqlite3.Database,
  });

  const query = `SELECT * FROM holdings WHERE Token = ?`;
  const rows: HoldingRecord[] = await db.all(query, [tokenMint]);

  await db.close();
  return rows;
}