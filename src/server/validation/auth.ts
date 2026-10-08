import { z } from "zod";

// Entrada das rotas /api/auth/* (D1, D3, premissa a).

export const PASSWORD_MIN_LENGTH = 8;
// Teto para não gastar argon2 com entradas gigantes.
export const PASSWORD_MAX_LENGTH = 128;

// E-mail normalizado: sem espaços nas pontas e em minúsculas (premissa a).
export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .max(254, { error: "E-mail longo demais." })
  .pipe(z.email({ error: "E-mail inválido." }));

export const newPasswordSchema = z
  .string({ error: "Informe a senha." })
  .min(PASSWORD_MIN_LENGTH, { error: `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  .max(PASSWORD_MAX_LENGTH, { error: `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.` });

export const registerSchema = z.object({
  businessName: z
    .string({ error: "Informe o nome do negócio." })
    .trim()
    .min(2, { error: "O nome do negócio precisa ter pelo menos 2 caracteres." })
    .max(80, { error: "O nome do negócio pode ter no máximo 80 caracteres." }),
  email: emailSchema,
  password: newPasswordSchema,
});

// No login a senha não passa pela regra de força: só precisa existir.
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Informe a senha." })
    .min(1, { error: "Informe a senha." })
    .max(PASSWORD_MAX_LENGTH, { error: "E-mail ou senha incorretos." }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
