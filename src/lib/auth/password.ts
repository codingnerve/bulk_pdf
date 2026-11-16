import bcrypt from "bcryptjs";

const COST = process.env.NODE_ENV === "test" ? 4 : 12;

export { passwordSchema } from "@/lib/validators/password-rule";

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Defence against user enumeration through response timing.
let dummy: string | null = null;
export async function burnPasswordCheck(plain: string) {
  dummy ??= await bcrypt.hash("pdflinker-dummy-password", COST);
  await bcrypt.compare(plain, dummy);
}
