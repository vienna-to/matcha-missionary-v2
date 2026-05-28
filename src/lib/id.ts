import { customAlphabet, nanoid } from "nanoid";

export function newId(prefix?: string): string {
  const id = nanoid(10);
  return prefix ? `${prefix}_${id}` : id;
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeGen = customAlphabet(codeAlphabet, 6);

export function newWorkspaceCode(): string {
  return codeGen();
}

export function formatWorkspaceCode(c: string): string {
  return `MATCHA-${c}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
