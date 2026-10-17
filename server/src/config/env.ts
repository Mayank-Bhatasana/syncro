import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT || 4000),
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://syncro:syncro_password@localhost:5433/syncro_db?schema=public",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6380",
  JWT_SECRET:
    process.env.JWT_SECRET || "syncro_super_secret_jwt_key_2026_production_grade",
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",
  NODE_ENV: process.env.NODE_ENV || "development",
};
