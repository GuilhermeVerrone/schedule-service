import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createAuthRepository, type Profile } from "@/server/repositories/auth-repository";
import { getAuthContext } from "./context";
import { LOGIN_PATH } from "./redirects";

// Dono e tenant da sessão para Server Components do painel. O proxy já barra /painel sem sessão;
// isto é a segunda checagem, perto dos dados (tenantId só dos cabeçalhos injetados pelo proxy).
// cache() divide a leitura entre o layout e a página na mesma requisição.
export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const context = getAuthContext(await headers());
  if (!context) redirect(LOGIN_PATH);
  const profile = await createAuthRepository().findProfile(context.tenantId, context.userId);
  if (!profile) redirect(LOGIN_PATH);
  return profile;
});
