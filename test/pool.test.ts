import { describe, expect, it } from "vitest";
import { strictSsl } from "../src/db/pool.js";

describe("database connection string", () => {
  it("says verify-full outright, which pg already does for require, so it stops warning", () => {
    expect(strictSsl("postgres://u:p@h/db?sslmode=require")).toBe("postgres://u:p@h/db?sslmode=verify-full");
    expect(strictSsl("postgres://u:p@h/db?a=1&sslmode=prefer&b=2")).toBe("postgres://u:p@h/db?a=1&sslmode=verify-full&b=2");
    expect(strictSsl("postgres://u:p@h/db?sslmode=verify-full")).toBe("postgres://u:p@h/db?sslmode=verify-full");
    expect(strictSsl("postgres://u:p@h/db?sslmode=disable")).toBe("postgres://u:p@h/db?sslmode=disable");
    expect(strictSsl("postgres://u:p@h/db")).toBe("postgres://u:p@h/db");
    expect(strictSsl("postgres://u:p@h/db?uselibpqcompat=true&sslmode=require")).toBe("postgres://u:p@h/db?uselibpqcompat=true&sslmode=require");
  });
});
